"""How often each instrument is offered.

Cadence is **policy, not inference**. A weekly PHQ-9 and a fourteen-day recall
window are different facts: one says when we ask, the other says what the answer
means. Deriving the first from the second would be clever and wrong — it would
silently turn the daily check into a daily PHQ-9 the first time someone edits a
recall field.

Kept as JSON so a clinician can change how often a patient is asked without a
code change, and so a new instrument brings its own schedule with it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

DEFAULT_PATH = Path(__file__).with_name("cadences.json")


@dataclass(frozen=True)
class Cadence:
    every_days: int
    label: str

    def is_due(self, last: "date | None", today: "date") -> bool:  # noqa: F821
        if last is None:
            return True
        return (today - last).days >= self.every_days


def load_cadences(path: Path | None = None) -> Mapping[str, Cadence]:
    raw = json.loads((path or DEFAULT_PATH).read_text(encoding="utf-8"))
    return {
        code: Cadence(int(spec["every_days"]), str(spec["label"]))
        for code, spec in raw.items()
        if not code.startswith("_")
    }


__all__ = ["Cadence", "DEFAULT_PATH", "load_cadences"]
