"""The closed set of reasons a caller can be refused.

A refusal carries a *reason*, not a status code, because the signature gate has to
show the doctor why the button is dead. Infrastructure failures are not refusals:
they propagate and become 5xx.
"""

from __future__ import annotations

from enum import Enum


class ErrorKind(str, Enum):
    ROLE = "role"  # this actor cannot perform this kind of call at all
    NOT_YOUR_PATIENT = "not_your_patient"  # no live link between actor and patient
    NOT_FOUND = "not_found"
    UNSIGNED = "unsigned"  # a clinical write without a signature
    INCOMPLETE = "incomplete"
    #: A field arrived with a value the domain cannot accept: a point value that
    #: is not on the scale, a field name that is not publishable, a time without
    #: a zone. Distinct from INCOMPLETE, which means "something is missing".
    INVALID = "invalid"  # answers do not name every item exactly once
    UNKNOWN_DRUG = "unknown_drug"
    DOSE_NOT_IN_LABEL = "dose_not_in_label"
    CONTRAINDICATED = "contraindicated"
    NEEDS_ACKNOWLEDGEMENT = "needs_acknowledgement"  # a finding must be seen first
    OBLIGATION_DOWNGRADED = "obligation_downgraded"  # lowering needs a reason
    STALE = "stale"  # expected_revision no longer matches
    CONFLICT = "conflict"  # same idempotency key, different content
    DEFINITION_CHANGED = "definition_changed"


class Rejected(Exception):
    """Raised when the caller was wrong. Never raised for infrastructure."""

    def __init__(self, kind: ErrorKind, message: str = "", field: str = "") -> None:
        super().__init__(message or kind.value)
        self.kind = kind
        self.message = message or kind.value
        self.field = field


__all__ = ["ErrorKind", "Rejected"]
