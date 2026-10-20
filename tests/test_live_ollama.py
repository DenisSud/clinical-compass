"""Live checks against the local Ollama. Skipped unless explicitly requested.

    pytest -m live
"""

from __future__ import annotations

import pytest

from compass_ai import LocalAssistant, ModelRoles, Ollama, OllamaError, TARGET_REASONING_MODEL

pytestmark = pytest.mark.live


@pytest.fixture(scope="module")
def ollama():
    client = Ollama(ModelRoles.from_env())
    if not client.installed():
        pytest.skip("Ollama is not reachable")
    return client


def test_configured_models_are_installed(ollama):
    ollama.require_installed(ollama.roles.reasoning, ollama.roles.embedding)


def test_target_model_availability_is_reported_not_assumed(ollama):
    """Bonsai 2 is the goal; until it is pulled, say so instead of crashing."""
    installed = ollama.installed()
    if TARGET_REASONING_MODEL not in installed:
        pytest.skip(f"{TARGET_REASONING_MODEL} not installed yet; configured reasoning is {ollama.roles.reasoning!r}")


def test_reasoning_model_answers_without_spending_all_tokens_thinking(ollama):
    answer = ollama.chat([{"role": "user", "content": "Reply with the single word: ok"}], max_tokens=64)
    assert answer.strip()


def test_decision_model_returns_a_parseable_verdict(ollama):
    decision = ollama.decide("Does the text mention a side effect?", "Пациент жалуется на тошноту и головокружение.")
    assert decision.label.lower() in {"yes", "no"}
    assert 0 <= decision.confidence <= 100


def test_decision_model_classifies_and_levels(ollama):
    choice = ollama.decide("What is this message about?", "Я перестал пить таблетки", choices={"adherence": "Medication problems", "admin": "Scheduling"})
    assert choice.label in {"adherence", "admin"}
    level = ollama.decide("How urgent is this?", "Не вижу смысла жить дальше", levels=("Routine", "Soon", "Immediate"))
    assert level.ordinal is not None


def test_embeddings_have_consistent_dimension(ollama):
    vectors = ollama.embed(["тревога", "депрессия"])
    assert len(vectors) == 2
    assert len(vectors[0]) == len(vectors[1])


def test_assistant_degrades_when_the_model_is_missing():
    """A clinical app must not lose a message because a model is absent."""
    assistant = LocalAssistant(ModelRoles(reasoning="definitely-not-installed:1b"))
    assert assistant.available() is False
    assert assistant.extract("текст", ["диагноз"]) is None
