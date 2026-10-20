"""Corpus and retrieval: the source of every claim the assistant makes."""

from __future__ import annotations

import re

from compass_ai.retrieval import Index, Passage
from knowledge import load_dir, passages

BUNDLES, ERRORS = load_dir()


def test_every_bundle_loads():
    assert not ERRORS, ERRORS
    assert len(BUNDLES) >= 5


def test_guideline_is_present_and_citable():
    guideline = next(b for b in BUNDLES if b.document.kind == "guideline")
    assert "депресс" in guideline.document.title.lower()
    assert len(guideline.passages) > 100
    assert guideline.document.usage_rights.strip()


def test_scale_appendices_are_in_the_corpus():
    """The four tools we need for risk and differential are already extracted.

    Appendix Г1 Hamilton, Г2 MADRS, Г3 HCL-33, Г4 Columbia.
    """
    guideline = next(b for b in BUNDLES if b.document.kind == "guideline")
    headings = {
        "Г1": "Шкала Гамильтона",
        "Г2": "Монтгомери",
        "Г3": "HCL-33",
        "Г4": "Колумбийская",
    }
    for appendix, marker in headings.items():
        assert marker in guideline.text, f"appendix {appendix} ({marker}) missing"


def test_columbia_carries_the_risk_key():
    guideline = next(b for b in BUNDLES if b.document.kind == "guideline")
    tail = guideline.text[-3000:]
    assert "риск" in tail.lower()
    assert re.search(r"[35]\s*балл", tail) or "балл" in tail


def test_passage_offsets_reproduce_the_source_exactly():
    for bundle in BUNDLES:
        for passage in bundle.passages:
            assert bundle.text[passage.start : passage.end] == passage.text


def test_bm25_finds_a_contraindication_passage():
    corpus = passages(BUNDLES)
    index = Index(corpus)
    hits = index.search("противопоказания при беременности", limit=5)
    assert hits
    assert any("беременност" in hit.passage.text.lower() for hit in hits)


def test_empty_index_is_safe():
    assert Index([]).search("anything") == []


def test_single_passage_index_still_scores():
    index = Index([Passage(key="p1", source_id="s", source_title="t", locator="l", text="тревога и депрессия")])
    assert len(index.search("тревога")) == 1
