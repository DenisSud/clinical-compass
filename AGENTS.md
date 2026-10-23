# clinical-compass

Clinical decision-support tool for physicians managing anxiety and depressive
symptoms. Case championship MVP, built slice by slice.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, driven by the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary; label string equals role name. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the root plus ADRs in `docs/adr/`, created
lazily. See `docs/agents/domain.md`.

### Design

`DESIGN.md` at the root decides UI questions by citation (`DESIGN.md §3.2`).
Its §2 outranks any UX heuristic: clinical safety, uninterpreted patient data,
signal semantics above decoration. Read it before changing a screen.
