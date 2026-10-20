"""Instrument definitions: versioned, hashable, data-not-code.

A psychometric instrument is a JSON document. Adding a scale must never require
a code change — that is technical metric 10 in the case brief.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence


class DefinitionError(ValueError):
    """Raised when an instrument definition is structurally invalid."""


_ALLOWED_TOP = {
    "code",
    "version",
    "title",
    "respondent",
    "language",
    "instruction",
    "recall",
    "scale",
    "items",
    "scoring",
    "safety",
    "validation",
}


def _require(cond: bool, message: str) -> None:
    if not cond:
        raise DefinitionError(message)


def _text(value: Any, label: str, *, max_len: int = 4000, required: bool = True) -> str:
    if not isinstance(value, str):
        raise DefinitionError(f"{label}: expected a string")
    if len(value) > max_len:
        raise DefinitionError(f"{label}: longer than {max_len} characters")
    if required and not value.strip():
        raise DefinitionError(f"{label}: must not be empty")
    return value


@dataclass(frozen=True)
class Option:
    label: str
    points: int


@dataclass(frozen=True)
class Item:
    key: str
    text: str
    options: tuple[Option, ...]


@dataclass(frozen=True)
class Band:
    maximum: int
    label: str
    severity: str


@dataclass(frozen=True)
class Subscale:
    key: str
    label: str
    items: tuple[str, ...] | None  # None => every item
    bands: tuple[Band, ...]


@dataclass(frozen=True)
class SafetySignal:
    item: str
    operator: str  # "gt" | "gte" | "eq" | "missing"
    threshold: int | None
    signal: str
    reason: str


@dataclass(frozen=True)
class Validation:
    source: str
    usage_rights: str
    licensor: str | None = None


@dataclass(frozen=True)
class Instrument:
    code: str
    version: str
    title: str
    respondent: str  # "patient" | "clinician"
    language: str
    instruction: str
    recall_days: int | None
    items: tuple[Item, ...]
    subscales: tuple[Subscale, ...]
    safety: tuple[SafetySignal, ...]
    validation: Validation
    raw: Mapping[str, Any] = field(repr=False, compare=False, default_factory=dict)

    # -- identity ---------------------------------------------------------

    @property
    def canonical_json(self) -> str:
        """Stable serialisation: the hash that a stored assessment pins."""
        return json.dumps(self.raw, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.canonical_json.encode("utf-8")).hexdigest()

    @property
    def item_keys(self) -> tuple[str, ...]:
        return tuple(item.key for item in self.items)

    # -- parsing ----------------------------------------------------------

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Instrument:
        _require(isinstance(data, Mapping), "definition: expected an object")
        extra = set(data) - _ALLOWED_TOP
        _require(not extra, f"definition: unknown keys {sorted(extra)}")
        missing = _ALLOWED_TOP - set(data)
        _require(not missing, f"definition: missing keys {sorted(missing)}")

        code = _text(data["code"], "code", max_len=40)
        version = _text(data["version"], "version", max_len=100)
        respondent = _text(data["respondent"], "respondent", max_len=20)
        _require(respondent in {"patient", "clinician"}, "respondent: patient or clinician")

        scale = data["scale"]
        _require(isinstance(scale, Mapping), "scale: expected an object")
        default_options = tuple(
            Option(_text(o.get("label"), "scale.options.label"), _points(o.get("points"), "scale.options.points"))
            for o in scale.get("options", [])
        )

        items_raw = data["items"]
        _require(isinstance(items_raw, list) and items_raw, "items: expected a non-empty list")
        items: list[Item] = []
        seen: set[str] = set()
        for index, item in enumerate(items_raw):
            _require(isinstance(item, Mapping), f"items[{index}]: expected an object")
            key = _text(item.get("key"), f"items[{index}].key", max_len=40)
            _require(key not in seen, f"items[{index}].key: duplicate {key!r}")
            seen.add(key)
            raw_options = item.get("options")
            if raw_options is None:
                _require(bool(default_options), f"items[{index}]: no options and no scale default")
                options = default_options
            else:
                _require(isinstance(raw_options, list) and raw_options, f"items[{index}].options: expected a list")
                options = tuple(
                    Option(_text(o.get("label"), f"items[{index}].options.label"), _points(o.get("points"), f"items[{index}].options.points"))
                    for o in raw_options
                )
            points = [o.points for o in options]
            _require(len(set(points)) == len(points), f"items[{index}]: duplicate point values")
            # Presentation order is preserved on purpose: on HADS several items run
            # low-to-high, and the UI should mirror the validated paper form.
            items.append(Item(key=key, text=_text(item.get("text"), f"items[{index}].text"), options=options))

        subscales = _subscales(data["scoring"], {i.key for i in items})
        safety = _safety(data.get("safety", []), {i.key for i in items})
        validation = data["validation"]
        _require(isinstance(validation, Mapping), "validation: expected an object")

        recall = data.get("recall") or {}

        return cls(
            code=code,
            version=version,
            title=_text(data["title"], "title", max_len=250),
            respondent=respondent,
            language=_text(data["language"], "language", max_len=20),
            instruction=_text(data["instruction"], "instruction", max_len=4000),
            recall_days=recall.get("days"),
            items=tuple(items),
            subscales=subscales,
            safety=safety,
            validation=Validation(
                source=_text(validation.get("source"), "validation.source", max_len=1000),
                usage_rights=_text(validation.get("usage_rights"), "validation.usage_rights", max_len=1000),
                licensor=validation.get("licensor"),
            ),
            raw=dict(data),
        )

    # -- convenience ------------------------------------------------------

    def options_for(self, key: str) -> tuple[Option, ...]:
        for item in self.items:
            if item.key == key:
                return item.options
        raise KeyError(key)


def _points(value: Any, label: str) -> int:
    _require(isinstance(value, int) and not isinstance(value, bool), f"{label}: expected an int")
    _require(0 <= value <= 3, f"{label}: must be within 0..3")
    return value


def _subscales(scoring: Mapping[str, Any], item_keys: set[str]) -> tuple[Subscale, ...]:
    _require(isinstance(scoring, Mapping), "scoring: expected an object")
    _require(scoring.get("kind") == "sum", "scoring.kind: only 'sum' is implemented")
    raw = scoring.get("subscales")
    _require(isinstance(raw, list) and raw, "scoring.subscales: expected a non-empty list")
    result: list[Subscale] = []
    for index, sub in enumerate(raw):
        _require(isinstance(sub, Mapping), f"scoring.subscales[{index}]: expected an object")
        keys = sub.get("items")
        if keys == "*":
            selected = None
        else:
            _require(isinstance(keys, list) and keys, f"scoring.subscales[{index}].items: expected '*' or a list")
            unknown = set(keys) - item_keys
            _require(not unknown, f"scoring.subscales[{index}].items: unknown items {sorted(unknown)}")
            selected = tuple(keys)
        bands_raw = sub.get("bands")
        _require(isinstance(bands_raw, list) and bands_raw, f"scoring.subscales[{index}].bands: expected a list")
        bands = tuple(
            Band(
                maximum=_non_negative(b.get("maximum"), f"scoring.subscales[{index}].bands.maximum"),
                label=_text(b.get("label"), f"scoring.subscales[{index}].bands.label", max_len=200),
                severity=_text(b.get("severity"), f"scoring.subscales[{index}].bands.severity", max_len=40),
            )
            for b in bands_raw
        )
        maxima = [b.maximum for b in bands]
        _require(maxima == sorted(maxima), f"scoring.subscales[{index}].bands: maximum must ascend")
        _require(len(set(maxima)) == len(maxima), f"scoring.subscales[{index}].bands: duplicate maximum")
        result.append(
            Subscale(
                key=_text(sub.get("key"), f"scoring.subscales[{index}].key", max_len=40),
                label=_text(sub.get("label"), f"scoring.subscales[{index}].label", max_len=200),
                items=selected,
                bands=bands,
            )
        )
    return tuple(result)


def _non_negative(value: Any, label: str) -> int:
    _require(isinstance(value, int) and not isinstance(value, bool), f"{label}: expected an int")
    _require(value >= 0, f"{label}: must be >= 0")
    return value


def _safety(raw: Any, item_keys: set[str]) -> tuple[SafetySignal, ...]:
    if raw is None:
        return ()
    _require(isinstance(raw, list), "safety: expected a list")
    result: list[SafetySignal] = []
    for index, rule in enumerate(raw):
        _require(isinstance(rule, Mapping), f"safety[{index}]: expected an object")
        key = _text(rule.get("item"), f"safety[{index}].item", max_len=40)
        _require(key in item_keys, f"safety[{index}].item: unknown item {key!r}")
        operator = rule.get("operator")
        _require(operator in {"gt", "gte", "eq", "missing"}, f"safety[{index}].operator: gt|gte|eq|missing")
        threshold = rule.get("threshold")
        if operator != "missing":
            threshold = _non_negative(threshold, f"safety[{index}].threshold")
        result.append(
            SafetySignal(
                item=key,
                operator=operator,
                threshold=threshold,
                signal=_text(rule.get("signal"), f"safety[{index}].signal", max_len=60),
                reason=_text(rule.get("reason"), f"safety[{index}].reason", max_len=500),
            )
        )
    return tuple(result)


def load_many(documents: Iterable[Mapping[str, Any]]) -> list[Instrument]:
    return [Instrument.from_dict(d) for d in documents]


__all__ = [
    "Band",
    "DefinitionError",
    "Instrument",
    "Item",
    "Option",
    "SafetySignal",
    "Subscale",
    "Validation",
    "load_many",
]
