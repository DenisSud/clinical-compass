"""compass.ai — everything that touches a model, behind one Protocol.

Nothing here performs a clinical action. It classifies, retrieves, extracts and
drafts. A doctor confirms.

Entry point for the clinical app::

    from compass import LocalAssistant, ModelRoles, load_dir

    assistant = LocalAssistant(ModelRoles.from_env())
    assistant.load_corpus(load_dir()[0])
    candidates = assistant.triage(score=phq9_score, text=patient_note)
"""

from compass.knowledge.passage import Passage

from .assistant import Assistant, Extraction, LocalAssistant
from .drafting import Draft, DraftRejected, Proposal
from .models import DEFAULT_HOST, TARGET_REASONING_MODEL, ModelRoles
from .ollama import Decision, Ollama, OllamaError
from .retrieval import Hit, Index
from .triage import SCREENS, Candidate, Rank, merge

__all__ = [
    "DEFAULT_HOST",
    "SCREENS",
    "TARGET_REASONING_MODEL",
    "Assistant",
    "Candidate",
    "Decision",
    "Draft",
    "DraftRejected",
    "Extraction",
    "Hit",
    "Index",
    "LocalAssistant",
    "ModelRoles",
    "Ollama",
    "OllamaError",
    "Passage",
    "Proposal",
    "Rank",
    "merge",
]
