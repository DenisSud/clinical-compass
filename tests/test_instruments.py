"""Instrument engine: definitions, scoring, and the extensibility claim."""

from __future__ import annotations

import json

import pytest

from instruments import DefinitionError, Instrument, load_strict, score

REGISTRY = load_strict()


# -- registry --------------------------------------------------------------


def test_registry_loads_every_definition():
    assert set(REGISTRY.codes()) >= {"PHQ9-RU", "HADS-RU"}
    assert REGISTRY.fingerprint()


def test_every_definition_declares_validation_and_rights():
    """Criterion 1 is graded on this: no scale without a source and a licence."""
    for instrument in REGISTRY:
        assert instrument.validation.source.strip(), instrument.code
        assert instrument.validation.usage_rights.strip(), instrument.code


def test_hashes_are_stable_across_loads():
    again = load_strict()
    assert again.fingerprint() == REGISTRY.fingerprint()


# -- PHQ-9 -----------------------------------------------------------------


def phq9_answers(**overrides):
    answers = {key: 0 for key in REGISTRY.get("PHQ9-RU").item_keys}
    answers.update(overrides)
    return answers


def test_phq9_full_completion_scores_and_bands():
    result = score(REGISTRY.get("PHQ9-RU"), phq9_answers(q1=3, q2=3, q3=2, q4=2, q5=1, q6=2, q7=2, q8=1, q9=0))
    assert result.complete
    assert result.primary.total == 16
    assert result.primary.severity == "moderately_severe"


def test_unanswered_item_is_not_zero():
    """A partial form must not look like a mild depression."""
    answers = phq9_answers(q1=3, q2=3, q3=3, q4=3)
    answers["q5"] = None
    result = score(REGISTRY.get("PHQ9-RU"), answers)
    assert not result.complete
    assert result.primary.total is None
    assert result.primary.band_label is None
    assert result.completed == 8


def test_q9_positive_raises_authoritative_signal_even_when_incomplete():
    answers = {key: None for key in REGISTRY.get("PHQ9-RU").item_keys}
    answers["q9"] = 1
    result = score(REGISTRY.get("PHQ9-RU"), answers)
    assert result.primary.total is None
    assert [f.signal for f in result.findings] == ["suicide_risk_item"]


def test_q9_missing_is_flagged_not_assumed_negative():
    answers = phq9_answers()
    answers["q9"] = None
    result = score(REGISTRY.get("PHQ9-RU"), answers)
    assert "suicide_risk_unanswered" in {f.signal for f in result.findings}


def test_rejects_unknown_and_missing_keys():
    with pytest.raises(DefinitionError, match="unknown items"):
        score(REGISTRY.get("PHQ9-RU"), {**phq9_answers(), "q99": 1})
    answers = phq9_answers()
    answers.pop("q1")
    with pytest.raises(DefinitionError, match="no entry"):
        score(REGISTRY.get("PHQ9-RU"), answers)


def test_rejects_out_of_range_points():
    with pytest.raises(DefinitionError, match="not a valid point value"):
        score(REGISTRY.get("PHQ9-RU"), phq9_answers(q1=9))


# -- HADS ------------------------------------------------------------------


def test_hads_scores_two_independent_subscales():
    hads = REGISTRY.get("HADS-RU")
    answers = {key: None for key in hads.item_keys}
    for key in ("a1", "a2", "a3", "a4", "a5", "a6", "a7"):
        answers[key] = 2
    for key in ("d1", "d2", "d3", "d4", "d5", "d6", "d7"):
        answers[key] = 1
    result = score(hads, answers)
    by_key = {s.key: s for s in result.subscales}
    assert by_key["anxiety"].total == 14
    assert by_key["anxiety"].severity == "clinical"
    assert by_key["depression"].total == 7
    assert by_key["depression"].severity == "normal"


def test_hads_item_order_follows_the_paper_form():
    """Points are not monotonic in presentation order; the UI must not sort them."""
    hads = REGISTRY.get("HADS-RU")
    assert [o.points for o in hads.options_for("a1")] == [3, 2, 1, 0]
    assert [o.points for o in hads.options_for("a4")] == [0, 1, 2, 3]


# -- extensibility (technical metric 10) -----------------------------------


def test_a_new_scale_is_data_not_code(tmp_path):
    """Drop a JSON file in, no Python change: this is the metric-10 demo."""
    definition = {
        "code": "TINY-RU",
        "version": "v1",
        "title": "Демонстрационная шкала",
        "respondent": "patient",
        "language": "ru",
        "instruction": "Ответьте на один вопрос.",
        "recall": {"days": 7},
        "scale": {"options": [{"label": "нет", "points": 0}, {"label": "да", "points": 3}]},
        "items": [{"key": "x1", "text": "Вам тяжело?"}],
        "scoring": {
            "kind": "sum",
            "subscales": [
                {
                    "key": "total",
                    "label": "Итог",
                    "items": "*",
                    "bands": [{"maximum": 1, "label": "Норма", "severity": "normal"}, {"maximum": 3, "label": "Высоко", "severity": "severe"}],
                }
            ],
        },
        "safety": [{"item": "x1", "operator": "gte", "threshold": 3, "signal": "x_high", "reason": "отметка «да»"}],
        "validation": {"source": "тест", "usage_rights": "внутренняя"},
    }
    (tmp_path / "tiny.json").write_text(json.dumps(definition, ensure_ascii=False), encoding="utf-8")

    registry = load_strict(tmp_path)
    result = score(registry.get("TINY-RU"), {"x1": 3})
    assert result.primary.total == 3
    assert result.primary.severity == "severe"
    assert [f.signal for f in result.findings] == ["x_high"]


def test_invalid_definition_is_reported_not_raised(tmp_path):
    (tmp_path / "broken.json").write_text('{"code": "X"}', encoding="utf-8")
    from instruments import load

    report = load(tmp_path)
    assert not report.ok
    assert "broken.json" in report.errors


def test_definition_rejects_unknown_keys():
    data = json.loads((REGISTRY.get("PHQ9-RU")).canonical_json)
    data["surprise"] = True
    with pytest.raises(DefinitionError, match="unknown keys"):
        Instrument.from_dict(data)
