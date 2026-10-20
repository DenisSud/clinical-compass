"""Source corpus: bundles of a document plus its citable passages.

The bundle format is Anton's, kept deliberately so that the corpus he already
extracted (124 passages of the Russian depression guideline, including the scale
appendices) imports without rework::

    {
      "schema_version": 1,
      "document": { "title", "version", "kind", "publisher", "usage_rights", ... },
      "text": "<the whole document>",
      "text_sha256": "<sha256 of text>",
      "passages": [ { "key", "locator", "start", "end" } ]
    }

A passage stores character offsets, not a copy, so a citation can always be
rendered as the exact quote from the source. That is the difference between
"scientific validity" as a claim and as a check.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping

from .passage import Passage

DEFAULT_DIR = Path(__file__).parent / "bundles"


class BundleError(ValueError):
    """Raised when a bundle is structurally invalid or internally inconsistent."""


@dataclass(frozen=True)
class SourceDocument:
    title: str
    version: str
    kind: str  # guideline | label | scale | synthetic
    publisher: str = ""
    url: str = ""
    language: str = "ru"
    usage_rights: str = ""
    applicability: str = ""
    retrieved_on: str = ""

    @property
    def citable(self) -> bool:
        return self.kind in {"guideline", "label"} and bool(self.title)


@dataclass(frozen=True)
class Bundle:
    document: SourceDocument
    text: str
    passages: tuple[Passage, ...]
    text_sha256: str

    @property
    def id(self) -> str:
        return hashlib.sha256(f"{self.document.title}@{self.document.version}".encode()).hexdigest()[:16]

    def quote(self, passage: Passage) -> str:
        """The exact source text behind a passage."""
        return self.text[passage.start : passage.end]


def _require(cond: bool, message: str) -> None:
    if not cond:
        raise BundleError(message)


def load_bundle(path: Path) -> Bundle:
    try:
        data: Mapping[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BundleError(f"{path.name}: {exc}") from exc

    _require(data.get("schema_version") == 1, f"{path.name}: schema_version must be 1")
    document_raw = data.get("document")
    _require(isinstance(document_raw, Mapping), f"{path.name}: document must be an object")
    text = data.get("text")
    _require(isinstance(text, str), f"{path.name}: text must be a string")

    actual = hashlib.sha256(text.encode("utf-8")).hexdigest()
    _require(actual == data.get("text_sha256"), f"{path.name}: text_sha256 mismatch")
    _require(text.strip(), f"{path.name}: empty text")

    document = SourceDocument(
        title=str(document_raw.get("title") or ""),
        version=str(document_raw.get("version") or ""),
        kind=str(document_raw.get("kind") or ""),
        publisher=str(document_raw.get("publisher") or ""),
        url=str(document_raw.get("url") or ""),
        language=str(document_raw.get("language") or "ru"),
        usage_rights=str(document_raw.get("usage_rights") or ""),
        applicability=str(document_raw.get("applicability") or ""),
        retrieved_on=str(document_raw.get("retrieved_on") or ""),
    )
    _require(document.title and document.version, f"{path.name}: document needs title and version")
    _require(document.kind in {"guideline", "label", "scale", "synthetic"}, f"{path.name}: unknown kind {document.kind!r}")

    bundle_id = hashlib.sha256(f"{document.title}@{document.version}".encode()).hexdigest()[:16]
    raw_passages = data.get("passages")
    _require(isinstance(raw_passages, list) and raw_passages, f"{path.name}: passages must be a non-empty list")

    passages: list[Passage] = []
    seen: set[str] = set()
    for index, entry in enumerate(raw_passages):
        _require(isinstance(entry, Mapping), f"{path.name}: passages[{index}] must be an object")
        key = str(entry.get("key") or "")
        _require(key and key not in seen, f"{path.name}: passages[{index}] key missing or duplicate")
        seen.add(key)
        start, end = entry.get("start"), entry.get("end")
        _require(
            isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= len(text),
            f"{path.name}: passages[{index}] offsets {start}..{end} out of range",
        )
        _require(text[start:end].strip(), f"{path.name}: passages[{index}] is empty")
        passages.append(
            Passage(
                key=key,
                source_id=bundle_id,
                source_title=document.title,
                locator=str(entry.get("locator") or ""),
                text=text[start:end],
                start=start,
                end=end,
            )
        )

    return Bundle(document=document, text=text, passages=tuple(passages), text_sha256=actual)


def load_dir(directory: Path | None = None) -> tuple[list[Bundle], dict[str, str]]:
    """Load every bundle in ``directory``. Returns (bundles, errors-by-filename)."""
    directory = directory or DEFAULT_DIR
    bundles: list[Bundle] = []
    errors: dict[str, str] = {}
    for path in sorted(directory.glob("*.json")):
        try:
            bundles.append(load_bundle(path))
        except BundleError as exc:
            errors[path.name] = str(exc)
    return bundles, errors


def passages(bundles: Iterable[Bundle]) -> list[Passage]:
    return [p for bundle in bundles for p in bundle.passages]


__all__ = ["Bundle", "BundleError", "DEFAULT_DIR", "SourceDocument", "load_bundle", "load_dir", "passages"]
