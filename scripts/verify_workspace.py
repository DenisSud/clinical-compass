"""Two checks that a test cannot make: what models answer, what the corpus holds.

    python scripts/verify_workspace.py --models   # is the local model stack usable
    python scripts/verify_workspace.py --corpus   # every bundle, passage count, sample

`make doctor` and `make corpus`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from compass.knowledge import load_dir  # noqa: E402


def show_corpus(verbose: bool) -> bool:
    bundles, errors = load_dir()
    passages = sum(len(b.passages) for b in bundles)
    print(f"corpus: {len(bundles)} bundles, {passages} passages, {sum(len(b.text) for b in bundles):,} chars")
    for bundle in bundles:
        doc = bundle.document
        print(f"  [{doc.kind:9}] {doc.title[:64]}")
        print(f"  {'':11} {len(bundle.passages):3} passages  {len(bundle.text):>8,} chars  v{doc.version}")
        if not doc.usage_rights.strip():
            print(f"  {'':11} WARNING: no usage_rights recorded")
        if verbose:
            for passage in bundle.passages[:2]:
                print(f"  {'':13}- {passage.key:14} {passage.locator:14} {passage.text.strip()[:90]!r}")
    for name, error in errors.items():
        print(f"  FAILED {name}: {error}")
    return not errors


def show_models() -> bool:
    from compass.ai import ModelRoles, Ollama, OllamaError, TARGET_REASONING_MODEL

    roles = ModelRoles.from_env()
    client = Ollama(roles)
    print(f"ollama {roles.host}")
    if not client.installed():
        print("  server: NOT REACHABLE")
        return False
    ok = True
    for role, name in (("reasoning", roles.reasoning), ("decision", roles.decision), ("embedding", roles.embedding)):
        resolved = client.resolve(name)
        ok = ok and resolved is not None
        print(f"  {role:10} {name:32} {resolved or 'MISSING'}")
    if client.resolve(TARGET_REASONING_MODEL) is None:
        print(f"  note: {TARGET_REASONING_MODEL} is the intended reasoning model once pulled")
    try:
        print(f"  embed probe: {len(client.embed(['тревожно-депрессивная симптоматика'])[0])} dims")
    except OllamaError as exc:
        print(f"  embed probe failed: {exc}")
        ok = False
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", action="store_true", help="list bundles and sample passages")
    parser.add_argument("--models", action="store_true", help="check the local Ollama setup")
    args = parser.parse_args()
    if not (args.corpus or args.models):
        parser.print_help()
        return 2
    return 0 if (show_models() if args.models else show_corpus(args.corpus)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
