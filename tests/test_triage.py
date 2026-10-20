"""Triage and drafting: the two places where a wrong answer is dangerous."""

from __future__ import annotations

import pytest

from compass_ai.drafting import DraftRejected, draft
from compass_ai.retrieval import Hit, Passage
from compass_ai.triage import Candidate, Rank, from_instrument, merge
from instruments import load_strict, score

REGISTRY = load_strict()


def phq9(**overrides):
    answers = {key: 0 for key in REGISTRY.get("PHQ9-RU").item_keys}
    answers.update(overrides)
    return score(REGISTRY.get("PHQ9-RU"), answers)


# -- triage ----------------------------------------------------------------


def test_positive_q9_outranks_a_confident_model_guess():
    authoritative = from_instrument(phq9(q1=2, q2=2, q3=2, q9=1))
    model_guess = [
        Candidate(signal="worsening", origin="decision_model", rank=Rank.URGENT, authoritative=False, reason="model", confidence=99)
    ]
    ordered = merge(authoritative, model_guess)
    assert ordered[0].authoritative
    assert ordered[0].signal == "suicide_risk_item"
    assert [c.origin for c in ordered].count("decision_model") == 1


def test_model_can_only_add_attention():
    baseline = from_instrument(phq9())
    assert baseline == []
    with_model = merge(baseline, [Candidate("stopped_medication", "decision_model", Rank.SOON, False, "r", 70)])
    assert len(with_model) == 1


def test_severe_total_is_surfaced_without_item_9():
    result = phq9(q1=3, q2=3, q3=3, q4=3, q5=3, q6=3, q7=3)
    candidates = from_instrument(result)
    assert any(c.signal == "severe_score" and c.authoritative for c in candidates)
    assert not any(c.signal == "suicide_risk_item" for c in candidates)


def test_candidate_labels_are_human_readable():
    candidate = Candidate("suicide_risk_item", "instrument", Rank.URGENT, True, "r")
    assert "PHQ-9" in candidate.label


# -- drafting gate ---------------------------------------------------------


class FakeOllama:
    """Stands in for the model server so the gate can be tested without one."""

    def __init__(self, payload):
        from compass_ai.models import ModelRoles

        self._payload = payload
        self.roles = ModelRoles()
        self.calls: list = []

    def json_chat(self, messages, *, schema, model=None):
        self.calls.append((messages, schema))
        return self._payload


def hit(key: str = "p1") -> Hit:
    return Hit(
        passage=Passage(key=key, source_id="s", source_title="Клинрекомендации", locator="Приложение Г4", text="текст"),
        score=1.0,
        lexical=1.0,
        dense=0.0,
    )


def test_draft_with_valid_citations_is_accepted():
    fake = FakeOllama({"suggestions": [{"text": "Рассмотреть оценку риска", "citations": ["p1"]}], "cautions": ["требует подтверждения"], "refusal": ""})
    result = draft(fake, question="что делать?", hits=[hit()])
    assert len(result.proposals) == 1
    assert result.requires_doctor_confirmation
    assert result.proposals[0].citations == ("p1",)
    assert result.cited_passages[0].key == "p1"


def test_draft_citing_an_unretrieved_passage_is_rejected():
    fake = FakeOllama({"suggestions": [{"text": "Назначить X", "citations": ["p1", "made-up"]}], "cautions": [], "refusal": ""})
    with pytest.raises(DraftRejected, match="not retrieved"):
        draft(fake, question="q", hits=[hit()])


def test_draft_without_citations_is_rejected():
    fake = FakeOllama({"suggestions": [{"text": "Назначить X", "citations": []}], "cautions": [], "refusal": ""})
    with pytest.raises(DraftRejected, match="untraceable"):
        draft(fake, question="q", hits=[hit()])


def test_no_retrieval_means_no_draft_and_no_model_call():
    fake = FakeOllama({"suggestions": [{"text": "x", "citations": ["p1"]}], "cautions": [], "refusal": ""})
    result = draft(fake, question="q", hits=[])
    assert result.empty
    assert "фрагментов" in result.refusal
    assert fake.calls == []
