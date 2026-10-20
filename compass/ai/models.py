"""Which local model plays which role.

Three roles, three models, all local. Keeping them in one place means swapping
Bonsai 2 in later is a config change, not a code change.

    reasoning  free-text work: summarising a discharge summary, drafting a
               suggestion, answering "why did you flag this".
    decision   a small text-classification head (yes/no, choice, level) for the
               triage boundary. Not a chat model — see d1 below.
    embedding  passage and query vectors for retrieval.

Local models only, per the project decision: no PHI leaves the host.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_HOST = "http://127.0.0.1:11434"


@dataclass(frozen=True)
class ModelRoles:
    reasoning: str = "qwen3.5:4b"
    decision: str = "d1:latest"
    embedding: str = "nomic-embed-text-v2-moe"
    host: str = DEFAULT_HOST
    # Reasoning models spend output tokens thinking. 64 tokens of "thinking"
    # and no answer is a classic silent failure, so the client defaults it off.
    thinking: bool = False

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> ModelRoles:
        env = env if env is not None else dict(os.environ)
        base = cls()
        return cls(
            reasoning=env.get("COMPASS_MODEL_REASONING", base.reasoning),
            decision=env.get("COMPASS_MODEL_DECISION", base.decision),
            embedding=env.get("COMPASS_MODEL_EMBEDDING", base.embedding),
            host=env.get("COMPASS_OLLAMA_HOST", base.host),
            thinking=env.get("COMPASS_MODEL_THINKING", "0") == "1",
        )


#: The model we want once `ollama pull` cooperates. Documented, not defaulted,
#: until it is actually installed — a missing model must not fail the demo.
TARGET_REASONING_MODEL = "bonsai-2:27b"


__all__ = ["DEFAULT_HOST", "ModelRoles", "TARGET_REASONING_MODEL"]
