"""Workspace self-check: what is loaded, what is citeable, what models answer.

    python scripts/verify_workspace.py            # summary
    python scripts/verify_workspace.py --corpus   # every bundle and passage count
    python scripts/verify_workspace.py --models   # local model readiness

Run via `make verify` / `make corpus` / `make doctor`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "packages"))

from instruments import load as load_instruments  # noqa: E402
from knowledge import load_dir  # noqa: E402


def show_instruments() -> bool:
    report = load_instruments()
    print(f"instruments: {len(report.registry)} loaded, {len(report.errors)} failed")
    for instrument in sorted(report.registry, key=lambda i: i.code):
        items = len(instrument.items)
        subscales = ", ".join(s.key for s in instrument.subscales)
        print(f"  {instrument.code:10} v{instrument.version:24} {items:2} items  [{subscales}]  sha {instrument.sha256[:12]}")
        if instrument.validation.licensor:
            print(f"  {'':10} licensor: {instrument.validation.licensor}  <- check rights before shipping")
    for name, error in report.errors.items():
        print(f"  FAILED {name}: {error}")
    return report.ok


def show_corpus(verbose: bool) -> bool:
    bundles, errors = load_dir()
    total_passages = sum(len(b.passages) for b in bundles)
    total_chars = sum(len(b.text) for b in bundles)
    print(f"corpus: {len(bundles)} bundles, {total_passages} passages, {total_chars:,} chars")
    for bundle in bundles:
        doc = bundle.document
        print(f"  [{doc.kind:9}] {doc.title[:70]}")
        print(f"  {'':11} {len(bundle.passages):3} passages  {len(bundle.text):>8,} chars  v{doc.version}")
        if not doc.usage_rights.strip():
            print(f"  {'':11} WARNING: no usage_rights recorded")
        if verbose:
            for passage in bundle.passages[:3]:
                preview = passage.text.strip().replace("\n", " ")[:110]
                print(f"  {'':13}- {passage.key:14} {passage.locator:16} {preview}")
    for name, error in errors.items():
        print(f"  FAILED {name}: {error}")
    return not errors


def show_models() -> bool:
    from compass_ai import ModelRoles, Ollama, OllamaError, TARGET_REASONING_MODEL

    roles = ModelRoles.from_env()
    print(f"ollama host: {roles.host}")
    print(f"  reasoning  {roles.reasoning}")
    print(f"  decision   {roles.decision}")
    print(f"  embedding  {roles.embedding}")
    client = Ollama(roles)
    installed = client.installed()
    if not installed:
        print("  server: NOT REACHABLE")
        return False
    print(f"  server: up, {len(installed)} models")
    ok = True
    for role, name in (("reasoning", roles.reasoning), ("decision", roles.decision), ("embedding", roles.embedding)):
        resolved = client.resolve(name)
        if resolved is None:
            ok = False
        print(f"  {role:10} {name:32} {resolved or 'MISSING'}")
    if client.resolve(TARGET_REASONING_MODEL) is None:
        print(f"  note: {TARGET_REASONING_MODEL} is the intended reasoning model once pulled")
    try:
        client.require_installed(roles.embedding)
        vectors = client.embed(["тревожно-депрессивная симптоматика"])
        print(f"  embed probe: {len(vectors[0])} dims")
    except OllamaError as exc:
        print(f"  embed probe failed: {exc}")
        ok = False
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", action="store_true", help="list bundles and sample passages")
    parser.add_argument("--models", action="store_true", help="check the local Ollama setup")
    args = parser.parse_args()

    if args.models:
        return 0 if show_models() else 1

    ok = show_instruments()
    print()
    ok = show_corpus(args.corpus) and ok
    print()
    print("OK" if ok else "PROBLEMS FOUND")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
