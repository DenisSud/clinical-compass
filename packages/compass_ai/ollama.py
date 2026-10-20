"""Thin Ollama client: the only place that talks to a model server.

Deliberately small and dependency-light. Two transports, because Ollama exposes
two different things:

* HTTP  — ``/api/chat`` and ``/api/embed``. Used for the reasoning and
  embedding roles.
* CLI   — ``ollama run <model> --ask``. The decision model (d1) has
  ``capabilities: ["decision"]`` and is **not** reachable over HTTP in Ollama
  0.40.4: both ``/api/chat`` and ``/api/generate`` return
  ``does not support chat``. Shelling out is the only available path today, so
  it is isolated here behind :func:`decide` and can be deleted the day an
  endpoint appears.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

import httpx

from .models import ModelRoles

_ANSI = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]")
# "yes  92%"  |  "adherence  85%"  |  "Immediate  81%  1.7 / 2"
_DECISION = re.compile(
    r"^(?P<label>.+?)\s{2,}(?P<confidence>\d+)%(?:\s+(?P<score>\d+(?:\.\d+)?)\s*/\s*(?P<maximum>\d+(?:\.\d+)?))?$"
)


class OllamaError(RuntimeError):
    """The model server rejected us, was unreachable, or answered nonsense."""


@dataclass(frozen=True)
class Decision:
    """One answer from the decision model.

    ``confidence`` is the model's own percentage. It is **not** a calibrated
    probability and must never be the sole trigger for a clinical action — see
    :mod:`compass_ai.triage`.
    """

    label: str
    confidence: int
    ordinal: float | None = None
    raw: str = ""

    @property
    def is_yes(self) -> bool:
        return self.label.strip().lower() in {"yes", "да", "true"}


def _clean(text: str) -> str:
    return _ANSI.sub("", text).replace("\r", "")


class Ollama:
    """Client bound to one host and one set of model roles."""

    def __init__(self, roles: ModelRoles | None = None, *, timeout: float = 120.0) -> None:
        self.roles = roles or ModelRoles.from_env()
        self.timeout = timeout

    # -- liveness ---------------------------------------------------------

    def installed(self) -> set[str]:
        """Model names exactly as the server reports them (tags included)."""
        try:
            response = httpx.get(f"{self.roles.host}/api/tags", timeout=5.0)
            response.raise_for_status()
        except httpx.HTTPError:
            return set()
        payload = response.json()
        return {entry["name"] for entry in payload.get("models", [])}

    def resolve(self, name: str) -> str | None:
        """The installed name for ``name``, or ``None``.

        Ollama lists ``nomic-embed-text-v2-moe`` as ``nomic-embed-text-v2-moe:latest``,
        so a bare name has to be matched with its implicit tag.
        """
        have = self.installed()
        if name in have:
            return name
        with_tag = name if ":" in name else f"{name}:latest"
        if with_tag in have:
            return with_tag
        without_tag = name.split(":", 1)[0]
        for candidate in have:
            if candidate.split(":", 1)[0] == without_tag:
                return candidate
        return None

    def require_installed(self, *names: str) -> None:
        have = self.installed()
        if not have:
            raise OllamaError(f"Ollama is not reachable at {self.roles.host}")
        missing = [name for name in names if self.resolve(name) is None]
        if missing:
            raise OllamaError(f"model(s) not installed: {missing}; have: {sorted(have)}")

    # -- reasoning --------------------------------------------------------

    def chat(self, messages: Sequence[Mapping[str, str]], *, model: str | None = None, temperature: float = 0.0, max_tokens: int | None = None) -> str:
        payload: dict[str, Any] = {
            "model": model or self.roles.reasoning,
            "messages": list(messages),
            "stream": False,
            "think": self.roles.thinking,
            "options": {"temperature": temperature},
        }
        if max_tokens is not None:
            payload["options"]["num_predict"] = max_tokens
        body = self._post("/api/chat", payload)
        message = body.get("message") or {}
        content = (message.get("content") or "").strip()
        if not content:
            thinking = (message.get("thinking") or "")[:200]
            raise OllamaError(f"empty completion from {payload['model']!r}; thinking={thinking!r}")
        return content

    def json_chat(self, messages: Sequence[Mapping[str, str]], *, schema: Mapping[str, Any], model: str | None = None) -> Any:
        """Ask for JSON conforming to ``schema`` (Ollama structured outputs)."""
        payload = {
            "model": model or self.roles.reasoning,
            "messages": list(messages),
            "stream": False,
            "think": self.roles.thinking,
            "format": schema,
            "options": {"temperature": 0.0},
        }
        body = self._post("/api/chat", payload)
        content = ((body.get("message") or {}).get("content") or "").strip()
        try:
            return json.loads(content)
        except json.JSONDecodeError as exc:
            raise OllamaError(f"model did not return JSON: {content[:200]!r}") from exc

    # -- embeddings -------------------------------------------------------

    def embed(self, texts: Sequence[str], *, model: str | None = None) -> list[list[float]]:
        payload = {"model": model or self.roles.embedding, "input": list(texts)}
        body = self._post("/api/embed", payload)
        vectors = body.get("embeddings")
        if not isinstance(vectors, list) or len(vectors) != len(texts):
            raise OllamaError("embedding count does not match input count")
        return vectors

    # -- decision ---------------------------------------------------------

    def decide(
        self,
        question: str,
        text: str,
        *,
        choices: Mapping[str, str] | None = None,
        levels: Sequence[str] | None = None,
        model: str | None = None,
        timeout: float = 90.0,
    ) -> Decision:
        """One decision-model answer about ``text``.

        Exactly one of ``choices`` / ``levels`` may be given; neither means
        yes/no. Runs the CLI because there is no HTTP endpoint for
        ``capabilities: ["decision"]`` in Ollama 0.40.4.
        """
        if choices and levels:
            raise ValueError("pass either choices or levels, not both")
        binary = shutil.which("ollama")
        if binary is None:
            raise OllamaError("the ollama CLI is not on PATH; the decision model needs it")

        argv = [binary, "run", model or self.roles.decision, "--ask", question]
        for key, description in (choices or {}).items():
            argv += ["--choice", f'{key}="{description}"']
        for level in levels or ():
            argv += ["--level", level]

        try:
            completed = subprocess.run(
                argv,
                input=text,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise OllamaError(f"decision model timed out after {timeout}s") from exc

        if completed.returncode != 0:
            raise OllamaError(f"decision model failed: {(completed.stderr or completed.stdout).strip()[:300]}")

        lines = [ln for ln in _clean(completed.stdout).splitlines() if ln.strip()]
        if not lines:
            raise OllamaError("decision model produced no output")
        last = lines[-1].strip()
        match = _DECISION.match(last)
        if not match:
            raise OllamaError(f"could not parse decision output: {last!r}")
        score = match.group("score")
        return Decision(
            label=match.group("label").strip(),
            confidence=int(match.group("confidence")),
            ordinal=float(score) if score is not None else None,
            raw=last,
        )

    # -- internals --------------------------------------------------------

    def _post(self, path: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        try:
            response = httpx.post(f"{self.roles.host}{path}", json=payload, timeout=self.timeout)
        except httpx.HTTPError as exc:
            raise OllamaError(f"{path}: {exc}") from exc
        if response.status_code >= 400:
            raise OllamaError(f"{path}: {response.status_code} {response.text[:300]}")
        try:
            return response.json()
        except json.JSONDecodeError as exc:
            raise OllamaError(f"{path}: non-JSON response") from exc


__all__ = ["Decision", "Ollama", "OllamaError"]
