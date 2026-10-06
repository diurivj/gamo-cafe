# 13 — Conteo and Diferencias

Status: ready-for-agent
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
