"""Triage and drafting: the two places where a wrong answer is dangerous."""

from __future__ import annotations

import pytest

from compass.ai.assistant import LocalAssistant
from compass.ai.drafting import DraftRejected, draft
from compass.ai.models import ModelRoles
from compass.ai.retrieval import Hit, Passage
from compass.ai.triage import Candidate, Rank, Severity, from_instrument, merge, screen_text, severity_of
from compass.instruments import load_strict, score

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
        from compass.ai.models import ModelRoles

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


# -- two axes: severity of the signal, provenance of the finding -----------


def test_a_suspected_suicide_signal_outranks_a_verified_high_score():
    """Provenance must not demote a signal that could mean someone dies.

    The first version sorted by authority first, which put "the questionnaire
    was filled in" above "a model thinks this person is talking about dying".
    """
    verified = [Candidate("severe_score", "instrument", Rank.SOON, True, "PHQ-9 = 22")]
    suspected = [Candidate("suicide_risk", "decision_model", Rank.SOON, False, "модель: yes 84%", 84)]
    ordered = merge(verified, suspected)
    assert ordered[0].signal == "suicide_risk"
    assert ordered[0].authoritative is False
    assert ordered[1].authoritative is True


def test_within_one_severity_band_verified_leads_suspicion():
    verified = [Candidate("suicide_risk_item", "instrument", Rank.URGENT, True, "пункт 9 = 2")]
    suspected = [Candidate("suicide_risk", "decision_model", Rank.URGENT, False, "модель: yes 91%", 91)]
    ordered = merge(suspected, verified)
    assert [c.authoritative for c in ordered] == [True, False]


def test_severity_comes_from_the_signal_not_the_origin():
    assert severity_of("suicide_risk") == severity_of("suicide_risk_item") == Severity.CRITICAL
    assert severity_of("severe_side_effect") == Severity.DANGER
    assert severity_of("stopped_medication") == Severity.ATTENTION


def test_an_unclassified_signal_is_not_buried():
    assert severity_of("something_new_nobody_thought_about") == Severity.ATTENTION


def test_full_queue_order_is_stable():
    items = [
        Candidate("screen_unavailable", "decision_model", Rank.INFO, False, "r"),
        Candidate("stopped_medication", "decision_model", Rank.SOON, False, "r", 70),
        Candidate("severe_score", "instrument", Rank.SOON, True, "r"),
        Candidate("suicide_risk_item", "instrument", Rank.URGENT, True, "r"),
        Candidate("severe_side_effect", "decision_model", Rank.SOON, False, "r", 88),
        Candidate("worsening", "decision_model", Rank.SOON, False, "r", 61),
    ]
    order = [c.signal for c in merge(items)]
    assert order[0] == "suicide_risk_item"
    assert order[1] == "severe_side_effect"
    assert order[-1] == "screen_unavailable"
    # stable across runs
    assert order == [c.signal for c in merge(items)]


# -- regressions found by an adversarial review ---------------------------


def test_low_confidence_suicide_screen_is_not_ranked_urgent():
    """`and` binds tighter than `or`; without parentheses the name alone did it."""
    class FakeOllama:
        calls = 0

        def decide(self, question, text, **kw):
            from compass.ai.ollama import Decision

            FakeOllama.calls += 1
            if "suicidal" in question:
                return Decision(label="yes", confidence=51)
            return Decision(label="no", confidence=10)

    candidates = screen_text(FakeOllama(), "текст обращения")
    by_signal = {c.signal: c for c in candidates}
    assert by_signal["suicide_risk"].rank == Rank.SOON
    assert by_signal["suicide_risk"].severity == Severity.CRITICAL


def test_high_confidence_suicide_screen_is_urgent():
    class FakeOllama:
        def decide(self, question, text, **kw):
            from compass.ai.ollama import Decision

            return Decision(label="yes", confidence=91) if "suicidal" in question else Decision(label="no", confidence=10)

    by_signal = {c.signal: c for c in screen_text(FakeOllama(), "текст")}
    assert by_signal["suicide_risk"].rank == Rank.URGENT


def test_abandoned_questionnaire_does_not_flood_the_critical_band():
    """Leaving at item 2 and deliberately skipping item 9 are different events."""
    early = {key: None for key in REGISTRY.get("PHQ9-RU").item_keys}
    early["q1"] = 2
    early["q2"] = 2
    abandoned = score(REGISTRY.get("PHQ9-RU"), early)
    assert abandoned.findings[0].signal == "suicide_risk_unanswered"
    candidate = next(c for c in from_instrument(abandoned) if c.signal == "suicide_risk_unanswered")
    assert candidate.severity == Severity.ATTENTION
    assert "не дошли" in candidate.reason


def test_skipping_only_item_nine_stays_critical():
    answers = {key: 0 for key in REGISTRY.get("PHQ9-RU").item_keys}
    answers["q9"] = None
    skipped = score(REGISTRY.get("PHQ9-RU"), answers)
    candidate = next(c for c in from_instrument(skipped) if c.signal == "suicide_risk_unanswered")
    assert candidate.severity == Severity.CRITICAL


def test_a_verified_27_outranks_a_verified_10():
    """Both are `severe_score`; the band has to break the tie somewhere."""
    severe = score(REGISTRY.get("PHQ9-RU"), {k: 3 for k in REGISTRY.get("PHQ9-RU").item_keys})
    answers = {k: 0 for k in REGISTRY.get("PHQ9-RU").item_keys}
    answers.update({"q1": 3, "q2": 3, "q3": 3, "q4": 3, "q5": 3})  # 15 = moderately severe
    moderate = score(REGISTRY.get("PHQ9-RU"), answers)
    a = next(c for c in from_instrument(severe) if c.signal == "severe_score")
    b = next(c for c in from_instrument(moderate) if c.signal == "severe_score")
    assert severe.primary.severity == "severe"
    assert moderate.primary.severity == "moderately_severe"
    assert a.severity == b.severity  # same band, deliberately
    assert a.rank > b.rank
    assert merge([b], [a])[0] is a


def test_a_questionnaire_total_never_outranks_a_dangerous_reaction():
    """A score is a descriptor, an adverse event is an event."""
    answers = {k: 3 for k in REGISTRY.get("PHQ9-RU").item_keys}
    answers["q9"] = 0  # 24/27, severe band, no suicide finding to distract the test
    verified = from_instrument(score(REGISTRY.get("PHQ9-RU"), answers))
    assert not any(c.signal.startswith("suicide") for c in verified)
    suspected = [Candidate("severe_side_effect", "decision_model", Rank.SOON, False, "r", 88)]
    ordered = merge(verified, suspected)
    assert ordered[0].signal == "severe_side_effect"


def test_local_assistant_explains_a_failed_draft_instead_of_returning_none():
    assistant = LocalAssistant(ModelRoles(reasoning="definitely-not-installed:1b"))
    no_hits = assistant.draft(question="что делать?", hits=[])
    assert no_hits.empty and "фрагментов" in no_hits.refusal
