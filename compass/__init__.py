"""compass — clinical decision support for anxiety and depressive symptoms.

Four modules, one direction of dependency:

    instruments   versioned scales, scoring, safety signals   (stdlib only)
    knowledge     source corpus, citable passages              (stdlib only)
    ai            models, retrieval, drafting                  (needs both + httpx)
    ... and later apps/api, which needs ai.

The two data modules import nothing outside the standard library on purpose:
scoring a questionnaire must be provable in a test without a model, a database
or a network.

Read them in that order. `instruments` and `knowledge` are the parts a clinician
can audit; `ai` is the part that is allowed to be wrong, because nothing it says
reaches a patient without a doctor confirming it.
"""

from compass.ai import Assistant, LocalAssistant, ModelRoles
from compass.instruments import Instrument, load, load_strict, score
from compass.knowledge import Bundle, load_dir

__all__ = [
    "Assistant",
    "Bundle",
    "Instrument",
    "LocalAssistant",
    "ModelRoles",
    "load",
    "load_dir",
    "load_strict",
    "score",
]
