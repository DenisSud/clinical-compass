-- A signal raised by a registry rule names that rule, so the card can show which rule
-- fired and where it came from. Empty string for the instrument-band signal and for
-- the doctor's own rules: neither points at a rule file.
ALTER TABLE signals ADD COLUMN rule_id TEXT NOT NULL DEFAULT '';
