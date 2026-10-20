"""Versioned psychometric instruments: definitions, scoring, registry.

Public surface::

    from instruments import load_strict, score

    registry = load_strict()
    instrument = registry.get("PHQ9-RU")
    result = score(instrument, answers)

Everything here is pure — no network, no database, no model. Scoring must stay
deterministic so that the clinical layer never depends on an LLM being up.
"""

from .definition import (
    Band,
    DefinitionError,
    Instrument,
    Item,
    Option,
    SafetySignal,
    Subscale,
    Validation,
)
from .registry import LoadReport, Registry, load, load_strict
from .scoring import SafetyFinding, Score, SubscaleResult, score

__all__ = [
    "Band",
    "DefinitionError",
    "Instrument",
    "Item",
    "LoadReport",
    "Option",
    "Registry",
    "SafetyFinding",
    "SafetySignal",
    "Score",
    "Subscale",
    "SubscaleResult",
    "Validation",
    "load",
    "load_strict",
    "score",
]
