"""Retrieval over source passages: BM25 plus dense vectors.

Why hybrid: clinical queries are full of rare exact tokens (МКБ codes, drug
names, "Чайлд-Пью", "СКФ") where lexical matching wins, and of paraphrases
("пациент плохо спит" vs "инсомния") where dense matching wins. Neither alone is
good enough for a citation-gated product.

No numpy, no vector database. A few hundred passages fit in memory, and the
scoring loop is microseconds. Technical metric 5 is about citations being
*correct*, not about being fast.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Iterable, Sequence

from compass.knowledge.passage import Passage

from .ollama import Ollama

_WORD = re.compile(r"\w+", re.UNICODE)


def tokenize(text: str) -> list[str]:
    """Lowercase word tokens. No stemming: Russian morphology here is a project
    of its own, and BM25 over stems would be a lie about how it was tuned."""
    return _WORD.findall(text.lower())


@dataclass(frozen=True)
class Hit:
    passage: Passage
    score: float
    lexical: float
    dense: float

    @property
    def citation(self) -> str:
        return self.passage.citation


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


class Index:
    """In-memory hybrid index. Build once, query many times."""

    def __init__(self, passages: Iterable[Passage], *, k1: float = 1.5, b: float = 0.75) -> None:
        self.passages = list(passages)
        self.k1 = k1
        self.b = b
        self._tokens = [tokenize(p.text) for p in self.passages]
        self._freqs = [Counter(t) for t in self._tokens]
        self._lengths = [len(t) for t in self._tokens]
        self._avgdl = (sum(self._lengths) / len(self._lengths)) if self._lengths else 0.0
        self._df: Counter[str] = Counter()
        for tokens in self._tokens:
            self._df.update(set(tokens))
        self._vectors: list[list[float]] | None = None

    def __len__(self) -> int:
        return len(self.passages)

    # -- dense side -------------------------------------------------------

    def embed(self, ollama: Ollama) -> None:
        """Precompute passage vectors. Optional: lexical search works without it."""
        if not self.passages:
            self._vectors = []
            return
        self._vectors = ollama.embed([p.text for p in self.passages])

    @property
    def dense_ready(self) -> bool:
        return self._vectors is not None

    # -- scoring ----------------------------------------------------------

    def _bm25(self, query_tokens: Sequence[str], index: int) -> float:
        n = len(self.passages)
        if n == 0:
            return 0.0
        freqs = self._freqs[index]
        length = self._lengths[index]
        score = 0.0
        for token in query_tokens:
            tf = freqs.get(token, 0)
            if tf == 0:
                continue
            df = self._df.get(token, 0)
            idf = math.log(1.0 + (n - df + 0.5) / (df + 0.5))
            denom = tf + self.k1 * (1 - self.b + self.b * length / (self._avgdl or 1.0))
            score += idf * (tf * (self.k1 + 1)) / denom
        return score

    def search(self, query: str, *, ollama: Ollama | None = None, limit: int = 5, dense_weight: float = 0.5) -> list[Hit]:
        """Top ``limit`` passages. Dense scoring is skipped when unavailable."""
        if not self.passages:
            return []
        query_tokens = tokenize(query)
        lexical = [self._bm25(query_tokens, i) for i in range(len(self.passages))]

        dense = [0.0] * len(self.passages)
        if ollama is not None and self._vectors:
            query_vector = ollama.embed([query])[0]
            dense = [_cosine(query_vector, v) for v in self._vectors]

        peak_lexical = max(lexical) if lexical else 0.0
        normalised = [(value / peak_lexical if peak_lexical > 0 else 0.0) for value in lexical]

        hits = [
            Hit(
                passage=self.passages[i],
                score=(1 - dense_weight) * normalised[i] + dense_weight * dense[i],
                lexical=normalised[i],
                dense=dense[i],
            )
            for i in range(len(self.passages))
        ]
        hits.sort(key=lambda h: (-h.score, h.passage.key))
        return [h for h in hits[:limit] if h.score > 0.0]


__all__ = ["Hit", "Index", "Passage", "tokenize"]
