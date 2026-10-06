# 13 — Conteo and Diferencias

Status: resolved
Blocked by: 12
Spec: [`../spec.md`](../spec.md) §5.8, §6.2 (Inventario, Diferencias), §7.2, §7.3 (6), §8.7, §10.5, §2.4

## What to build

- **Conteo**, started from Inventario (Admin only): an entry step listing Item names with no expected numbers, for any subset of Items; a review step showing expected, found and difference; then confirm.
- Confirming is one batch with multi-row statements: per Item, the Stock expected at that moment, the units found, and then Stock set to the units found and `last counted at` updated. "Expected at that moment" is read inside the batch, not taken from the review page. A Discrepancy of zero is recorded too.
- **Diferencias**: per Count, Item, expected, found, difference; below zero shown as Faltante, above zero as Sobrante.
- Records: `counts`, `count_lines`.

## Acceptance criteria

- [ ] A Count sets Stock to the units found and records the Discrepancy against the Stock expected at the moment of confirming, including when a sale lands between review and confirm.
- [ ] The entry step's response contains no expected numbers.
- [ ] A Count of every Item (60 Items) issues fewer than 50 statements and no query exceeds 100 bound parameters.
- [ ] Faltante and Sobrante are shown correctly; zero Discrepancies are recorded.
- [ ] Workers are refused. Flow §8.7 passes.

## Comments

- 2026-10-06: Implemented on `ticket/13-conteo`, merged into `gamo-cafe-v1` at `85c5fe8`. Budget: a 60-Item Count is 5 statements, the largest 98 bound parameters (32 lines per statement); the Count's insert carries the whole Item set through one `json_each` parameter, and `count_lines` reads the expected Stock inside the batch before any Stock write. Decisions: Diferencias shows the 20 most recent Counts; a blank entry field leaves an Item out (any subset); a second line for one Item is ignored; retired stock-tracked Items are countable; confirming redirects to `/diferencias`; `lastCountedAt` in `stock.ts` is the read seam for tests.
- Ticket 19: a Count sets Stock absolutely and updates `last_counted_at`, which the rebuild must treat as a reset.
