# apps/

Deployable applications live here. Libraries live in `../packages/` (now `../../compass/`).

## `apps/api/clinic` — the clinical application module

One module, nine methods, one seam. Design and rejected alternatives:
`docs/api-design.md`. Decisions: `docs/decisions.md` D9–D11.

```
types.py      value types; patient-facing ones cannot hold a score
errors.py     closed refusal vocabulary — a reason, not a status code
ports.py      Store, Catalog, Screener, Drafter
memory.py     adapter: dicts, deepcopy rollback
sqlite.py     adapter: schema, JSON codecs, explicit transactions
clinical.py   Clinical — the nine methods
```

Two adapters exist for `Store`, and **one contract suite runs against both**. That
is what makes the port a seam rather than indirection. `Clinical` never names an
adapter.

### What the tests pin, at the interface

| Law | Test |
|---|---|
| Signature gates every clinical write | refusal writes nothing; audit empty |
| A critical finding must be reviewed | `NEEDS_ACKNOWLEDGEMENT` before signing |
| Obligatory escalation cannot be downgraded | `OBLIGATION_DOWNGRADED` |
| Severity first, provenance second | suspected critical beats verified moderate |
| Screening is a write-time fact | model called once across three reads |
| Advice degrades, never raises | `Advice(degraded=True)` |
| Nothing reaches the patient before publish | feed empty, then one card |
| Patient types cannot hold a score | asserted by reflection over fields |
| One idempotency key, one outcome | same id; different content is a conflict |
| Authority comes from the care link | `NOT_YOUR_PATIENT` |

```
devenv shell -- python -m pytest -m "not live" -q     # 88 green
```

### Deliberately not here yet

- **Rules engine** (Авиандр, nine label rules, interactions). The `Catalog` port
  exists and is faked in tests; real values wait on a clinician reading the
  instruction. Putting unverified doses in code would be the one mistake that
  matters.
- **Creating an assignment** — a doctor action, not one of the nine.
- **HTTP layer.** Five UX surfaces are not yet served by anything.
- **Postgres adapter.** Schema shape is already compatible (D11).

### Why this is not the mockup

`reference/mockup/` was read as a behaviour reference, not imported. It already
had audit, invitations, versioning and idempotency — and D9 chose to re-earn
those deliberately rather than inherit a Django monolith. The cost is real; the
return is an application layer with no framework in it and tests that need
neither Postgres nor a model.
