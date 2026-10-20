"""A citable span of a source document.

Lives here rather than with retrieval because a passage is a fact about a
document, not a fact about searching. `compass.ai.retrieval` imports it.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Passage:
    """A span of a source document, with character offsets into the whole text.

    ``start``/``end`` make a citation render as the exact quote rather than a
    paraphrase. That is the difference between "scientific validity" as a claim
    and as a check.
    """

    key: str
    source_id: str
    source_title: str
    locator: str
    text: str
    start: int = 0
    end: int = 0

    @property
    def citation(self) -> str:
        return f"{self.source_title} · {self.locator}"


__all__ = ["Passage"]
