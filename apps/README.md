# apps/

Deployable applications live here. Libraries live in `../packages/`.

## Status: one decision pending

`apps/api` — the clinical web application (roles, care relationship, scales,
alerts, care plan) — has not been created yet. There are two ways to get it, and
the choice belongs to the tech lead after he has walked the mockup.

### Option A — adopt `reference/mockup/` (recommended)

The vendored mockup is 868 KB of working Django: 17 models, 30 routes, 14
templates. What it already gets right is exactly what a code review probes:

| Already implemented | Why it matters |
|---|---|
| Append-only audit enforced in the ORM (`update`/`delete` raise) | Mandatory condition: no silent history edits |
| One-time invitations stored as a hash, 48 h TTL, revocable | Care relationship without a third party |
| Versioned scale definitions pinned by SHA-256 into each assessment | Criterion 1: provable source version |
| Idempotent submissions via `submission_key` | Double-tap and replay safety |
| Incomplete ≠ zero (`completed_count`, `total = NULL`) | Clinical correctness |
| `require_role()` in every service function | Mandatory condition: role separation |
| `PrivateResponseMiddleware` (no-store) | Confidentiality |

Adopting it is a move, not a rewrite:

```bash
git mv reference/mockup/clinical_compass_app apps/api
rm -rf apps/api/data
```

Then the work is purely additive: a `pharmacology` app (Авиандр and its label
rules), a `rules` app (deterministic engine + alert delivery), an `assistant`
app (thin views over `packages/compass_ai`), `routing` (referral
"обязательно"/"желательно"), and `adherence`.

### Option B — build fresh

Better only if the team agrees the mockup's data model is wrong. It is not
obviously wrong; the parts that are missing are additive, not load-bearing. A
rewrite costs days and scores no rubric points — the criteria grade clinical
justification and data model coverage, not framework novelty.

## What is *not* in doubt

`packages/` is already usable and independent of this decision:

- `packages/instruments` — versioned scale definitions, scoring, safety signals
- `packages/compass_ai` — the model boundary (`Assistant` Protocol), triage,
  retrieval, citation-gated drafting
- `packages/knowledge` — the source corpus with exact passage offsets

Whichever app is chosen imports these; nothing in them assumes Django.
