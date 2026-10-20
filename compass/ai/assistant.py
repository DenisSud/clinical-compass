"""The seam between the clinical app and whatever provides the intelligence.

Everything the app needs from "AI" goes through :class:`Assistant`. Today it is
:class:`LocalAssistant` — Ollama on localhost, no network egress.

Tomorrow, if a single stateful agent is wanted (persistent conversation with the
doctor, proactive runs, retries that survive a restart), that becomes a second
implementation of the same Protocol backed by a pi-durable service, and the
clinical app does not change a line. That is the whole reason this Protocol
exists rather than the app importing ``Ollama`` directly.

Nothing here may raise on a model failure. A clinical application must not lose
a patient's message because a 4B model hallucinated a token.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence

from compass.instruments import Score

from .drafting import Draft, DraftRejected, draft
from .models import ModelRoles
from .ollama import Decision, Ollama, OllamaError
from .retrieval import Hit, Index, Passage
from .triage import Candidate, categorise, from_instrument, merge, screen_text, urgency


@dataclass(frozen=True)
class Extraction:
    """Structured facts pulled out of a free-text document."""

    fields: dict[str, str]
    missing: tuple[str, ...]
    source_text_sha256: str | None = None


class Assistant(Protocol):
    """What the clinical app is allowed to ask for."""

    def available(self) -> bool: ...

    def screen(self, text: str) -> list[Candidate]: ...

    def urgency(self, text: str) -> Decision | None: ...

    def categorise(self, text: str) -> Decision | None: ...

    def retrieve(self, query: str, *, limit: int = 5) -> list[Hit]: ...

    def draft(self, *, question: str, hits: Sequence[Hit], context: str = "") -> Draft | None: ...

    def extract(self, document: str, fields: Sequence[str]) -> Extraction | None: ...


class LocalAssistant:
    """Ollama-backed implementation. Degrades to nothing rather than raising."""

    def __init__(self, roles: ModelRoles | None = None, *, ollama: Ollama | None = None) -> None:
        self.ollama = ollama or Ollama(roles)
        self.index = Index([])

    # -- corpus -----------------------------------------------------------

    def load_corpus(self, passages: Sequence[Passage], *, embed: bool = True) -> None:
        self.index = Index(passages)
        if embed and passages and self.available():
            try:
                self.index.embed(self.ollama)
            except OllamaError:
                pass  # lexical-only search still works

    # -- assistant surface ------------------------------------------------

    def available(self) -> bool:
        try:
            self.ollama.require_installed(self.ollama.roles.reasoning)
        except OllamaError:
            return False
        return True

    def screen(self, text: str) -> list[Candidate]:
        return screen_text(self.ollama, text)

    def urgency(self, text: str) -> Decision | None:
        return urgency(self.ollama, text)

    def categorise(self, text: str) -> Decision | None:
        return categorise(self.ollama, text)

    def retrieve(self, query: str, *, limit: int = 5) -> list[Hit]:
        return self.index.search(query, ollama=self.ollama if self.index.dense_ready else None, limit=limit)

    def draft(self, *, question: str, hits: Sequence[Hit], context: str = "") -> Draft | None:
        try:
            return draft(self.ollama, question=question, hits=hits, context=context)
        except (OllamaError, DraftRejected):
            return None

    def extract(self, document: str, fields: Sequence[str]) -> Extraction | None:
        schema = {
            "type": "object",
            "properties": {name: {"type": "string"} for name in fields},
            "required": list(fields),
        }
        messages = [
            {
                "role": "system",
                "content": (
                    "Извлеки перечисленные поля из текста медицинского документа. "
                    "Если значение не указано в тексте, верни пустую строку. "
                    "Не придумывай значения и не выводи ничего, чего нет в документе."
                ),
            },
            {"role": "user", "content": f"Поля: {', '.join(fields)}\n\nДокумент:\n{document}"},
        ]
        try:
            raw = self.ollama.json_chat(messages, schema=schema)
        except OllamaError:
            return None
        if not isinstance(raw, dict):
            return None
        values = {name: str(raw.get(name) or "").strip() for name in fields}
        return Extraction(
            fields={k: v for k, v in values.items() if v},
            missing=tuple(k for k, v in values.items() if not v),
        )

    def triage(self, *, score: Score | None = None, text: str = "") -> list[Candidate]:
        """Merge deterministic instrument findings with model screens."""
        groups: list[list[Candidate]] = []
        if score is not None:
            groups.append(from_instrument(score))
        groups.append(self.screen(text))
        return merge(*groups)


__all__ = ["Assistant", "Extraction", "LocalAssistant"]
