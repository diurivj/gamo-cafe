# 19 — Maintenance command: rebuild and verify projections

Status: ready-for-agent
Blocked by: 10, 11, 13
Spec: [`../spec.md`](../spec.md) §7.1, §5.8, §10.5 · ADR 0002

## What to build

A maintenance command the developer runs against local or production that recomputes every projection from the facts — each Bill's current Customer, current note, total, paid and state, and each Item's Stock and last counted at — and either verifies them against the live values (reporting every difference) or rewrites them.

- Stock is rebuilt from Lines (less removed Lines and Voided Bills; see the note on stock tracking), Adjustments less cancellations, and Counts as resets.
- Note on stock tracking: §5.1 says switching tracking changes no existing record and Lines do not move Stock while it is off, but no fact records when the flag changed. If the rebuild needs it, record on the Line whether it moved Stock (a fact about the Line, set when it is written) rather than inferring it; adjust the writing operations accordingly.

## Acceptance criteria

- [ ] A property-style test runs random sequences of every operation (selections, Payments, Abonar, removals, voids, edits, Adjustments, cancellations, Counts, tracking toggles) and the rebuild yields the same Stock and the same Bill projections as the live values.
- [ ] Corrupting a projection by hand is detected by verify and fixed by rebuild.
- [ ] The command is documented in the README and exposed as npm scripts for local and production.
