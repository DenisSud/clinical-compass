"""Instrument registry: every definition on disk, loaded and validated once.

Adding a scale means dropping a JSON file in ``definitions/``. No code change.
That is the whole point — see technical metric 10 in the case brief.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Iterator, Mapping

from .definition import DefinitionError, Instrument

DEFAULT_DIR = Path(__file__).parent / "definitions"


@dataclass(frozen=True)
class Registry:
    _by_code: Mapping[str, Instrument]

    def __iter__(self) -> Iterator[Instrument]:
        return iter(self._by_code.values())

    def __len__(self) -> int:
        return len(self._by_code)

    def __contains__(self, code: object) -> bool:
        return code in self._by_code

    def get(self, code: str) -> Instrument:
        try:
            return self._by_code[code]
        except KeyError:
            known = ", ".join(sorted(self._by_code)) or "none"
            raise KeyError(f"unknown instrument {code!r}; loaded: {known}") from None

    def codes(self) -> tuple[str, ...]:
        return tuple(sorted(self._by_code))

    def for_respondent(self, respondent: str) -> tuple[Instrument, ...]:
        return tuple(i for i in self._by_code.values() if i.respondent == respondent)

    def fingerprint(self) -> str:
        """One hash over every definition, for a deployment banner or a test."""
        import hashlib

        joined = "|".join(f"{i.code}@{i.version}={i.sha256}" for i in sorted(self._by_code.values(), key=lambda i: i.code))
        return hashlib.sha256(joined.encode()).hexdigest()


@dataclass(frozen=True)
class LoadReport:
    registry: Registry
    errors: Mapping[str, str]

    @property
    def ok(self) -> bool:
        return not self.errors


def load(directory: Path | None = None) -> LoadReport:
    """Load every ``*.json`` in ``directory``. Errors are collected, not raised."""
    directory = directory or DEFAULT_DIR
    by_code: dict[str, Instrument] = {}
    errors: dict[str, str] = {}
    for path in sorted(directory.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            instrument = Instrument.from_dict(data)
        except (OSError, json.JSONDecodeError, DefinitionError) as exc:
            errors[path.name] = str(exc)
            continue
        if instrument.code in by_code:
            errors[path.name] = f"duplicate code {instrument.code!r} (also in {by_code[instrument.code].version})"
            continue
        by_code[instrument.code] = instrument
    return LoadReport(Registry(MappingProxyType(by_code)), MappingProxyType(errors))


def load_strict(directory: Path | None = None) -> Registry:
    report = load(directory)
    if report.errors:
        detail = "; ".join(f"{name}: {msg}" for name, msg in report.errors.items())
        raise DefinitionError(f"invalid instrument definitions: {detail}")
    return report.registry


__all__ = ["DEFAULT_DIR", "LoadReport", "Registry", "load", "load_strict"]
