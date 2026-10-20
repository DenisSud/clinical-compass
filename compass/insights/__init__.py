"""Deterministic insight over a series of answers. No model, no network.

The point of this module is that a doctor can be told something useful without a
language model: a sum against a published band, a change against a stated
threshold, a count of missed days. Every finding carries the provenance of its
number, because a threshold invented by two engineers must not be quoted as if it
came out of a guideline.

What this module deliberately does not do:

* it does not decide urgency — that is ``compass.ai.triage``, which owns severity
  and the two-axis ordering;
* it does not interpret a ``daily_check`` as depression. A daily tick has a total
  and no band, and this module does not invent one.
"""

from .series import (
    RELIABLE_CHANGE,
    maximum_of,
    points_word,
    Adherence,
    Finding,
    Point,
    Series,
    adherence,
    analyse,
    build,
)

__all__ = [
    "RELIABLE_CHANGE",
    "maximum_of",
    "points_word",
    "Adherence",
    "Finding",
    "Point",
    "Series",
    "adherence",
    "analyse",
    "build",
]
