"""Drafting a suggestion the doctor can accept, amend, or throw away.

The case is explicit: the system does not prescribe. So the output of this module
is a *proposal* that carries three things every time:

1. the text of the proposal,
2. the passage keys every claim rests on,
3. a flag saying a doctor must confirm before anything happens.

If a draft arrives with a claim that cites a passage that was not actually
retrieved, the whole draft is rejected. A suggestion a doctor cannot trace is
worse than no suggestion — it is a plausible-sounding liability. That check is
why retrieval and drafting are separate steps with an explicit boundary.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

from .ollama import Ollama, OllamaError
from .retrieval import Hit, Passage

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "citations": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["text", "citations"],
            },
        },
        "cautions": {"type": "array", "items": {"type": "string"}},
        "refusal": {"type": "string"},
    },
    "required": ["suggestions", "cautions", "refusal"],
}

SYSTEM = """Ты — вспомогательный инструмент врача. Ты НЕ ставишь диагноз и НЕ назначаешь лечение.

Правила, которые нельзя нарушать:
1. Каждое утверждение должно опираться на предоставленные фрагменты источников.
2. В поле citations перечисли ключи (key) тех фрагментов, на которых основано утверждение.
3. Не используй знания, которых нет во фрагментах, даже если они кажутся верными.
4. Если фрагментов недостаточно для ответа — заполни refusal и оставь suggestions пустым.
5. Не предлагай дозировки, которых нет во фрагментах.
6. Пиши по-русски, кратко, в формулировках «рассмотреть», «обсудить с пациентом», а не «назначить».
"""


class DraftRejected(RuntimeError):
    """The model produced something that failed the citation gate."""


@dataclass(frozen=True)
class Proposal:
    text: str
    citations: tuple[str, ...]


@dataclass(frozen=True)
class Draft:
    proposals: tuple[Proposal, ...]
    cautions: tuple[str, ...]
    refusal: str
    hits: tuple[Hit, ...] = ()
    requires_doctor_confirmation: bool = True
    model: str = ""

    @property
    def empty(self) -> bool:
        return not self.proposals

    @property
    def cited_passages(self) -> tuple[Passage, ...]:
        keys = {key for proposal in self.proposals for key in proposal.citations}
        return tuple(hit.passage for hit in self.hits if hit.passage.key in keys)


def _prompt(question: str, hits: Sequence[Hit], context: str) -> list[dict[str, str]]:
    if hits:
        fragments = "\n\n".join(
            f"[{hit.passage.key}] {hit.citation}\n{hit.passage.text.strip()}" for hit in hits
        )
    else:
        fragments = "(фрагменты не найдены)"
    user = (
        f"Вопрос врача: {question}\n\n"
        f"Контекст пациента:\n{context.strip() or '(не указан)'}\n\n"
        f"Фрагменты источников:\n{fragments}\n\n"
        "Ответь JSON по схеме."
    )
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


def draft(
    ollama: Ollama,
    *,
    question: str,
    hits: Sequence[Hit],
    context: str = "",
) -> Draft:
    """Draft a proposal strictly from ``hits``.

    Raises :class:`DraftRejected` when the model cites a passage it was not given,
    or returns a proposal with no citations at all.
    """
    if not hits:
        return Draft(proposals=(), cautions=(), refusal="Нет подходящих фрагментов источников.", model=ollama.roles.reasoning)

    raw = ollama.json_chat(_prompt(question, hits, context), schema=SCHEMA)
    if not isinstance(raw, Mapping):
        raise DraftRejected("model did not return an object")

    allowed = {hit.passage.key for hit in hits}
    proposals: list[Proposal] = []
    for index, item in enumerate(raw.get("suggestions") or []):
        if not isinstance(item, Mapping):
            raise DraftRejected(f"suggestion[{index}]: not an object")
        text = (item.get("text") or "").strip()
        citations = item.get("citations") or []
        if not isinstance(citations, list) or not all(isinstance(c, str) for c in citations):
            raise DraftRejected(f"suggestion[{index}]: citations must be a list of strings")
        unknown = [c for c in citations if c not in allowed]
        if unknown:
            raise DraftRejected(f"suggestion[{index}]: cites passages that were not retrieved: {unknown}")
        if not text:
            continue
        if not citations:
            raise DraftRejected(f"suggestion[{index}]: no citations — refusing to surface an untraceable claim")
        proposals.append(Proposal(text=text, citations=tuple(dict.fromkeys(citations))))

    return Draft(
        proposals=tuple(proposals),
        cautions=tuple(str(c) for c in (raw.get("cautions") or []) if str(c).strip()),
        refusal=str(raw.get("refusal") or "").strip(),
        hits=tuple(hits),
        model=ollama.roles.reasoning,
    )


__all__ = ["Draft", "DraftRejected", "Proposal", "SCHEMA", "SYSTEM", "draft"]
