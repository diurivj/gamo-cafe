# 09: Count Stock and inspect Discrepancies

**What to build:** An Admin enters quantities found on the shelf without seeing expected Stock, reviews the comparison, confirms the Count and understands the recorded Discrepancies. Complete Conteo and Diferencias from the redesigned Inventario entry point.

**Blocked by:** 08 — Inspect Stock and record Adjustments.

**Status:** ready-for-agent

**Spec:** [UI redesign](../spec.md) §§2.4, 4, 6–10.

- [ ] Count entry clearly identifies each Item and accepts whole quantities found, including zero, without showing expected Stock or leaking it through helper text/accessible names.
- [ ] Preserve Counts of any subset of Items: untouched fields are not silently treated as zero or included in the Count. Backtracking preserves entered quantities and applicable notes.
- [ ] Review shows expected, found and difference with Faltante, Sobrante or Sin diferencia. Confirmation is explicit and describes the effect of recording the Count; it is not a direct Stock edit.
- [ ] The recorded expected Stock and Discrepancy follow the existing confirmation-time rules, including other operations between entry/review/confirmation. Do not freeze stale expectations into authoritative records merely because review displayed them.
- [ ] Pending state acknowledges the tap immediately; Stock is not presented as changed before confirmation. Preserve refused/unknown context and use the same identity/content for safe retry so a lost response cannot record another Count.
- [ ] After confirmation, show the recorded outcome and clear paths to Inventario and Diferencias. Counts with zero Discrepancy remain recorded and understandable.
- [ ] Diferencias retains Item, expected/found/difference, Count context and attribution, with readable text distinctions, cursor pagination and accessible Cargar más.
- [ ] Tests cover partial Counts, explicit zero versus blank, negative/invalid input, backtracking, review, intervening Stock changes, duplicate submission and the recorded Count/Stock/Discrepancy results. Workers remain refused.
- [ ] Verify long lists/names, keyboard entry/focus, mobile keyboards, narrow screens, enlarged text and screen-reader labels/statuses. Include useful empty/loading/error states.
- [ ] Run focused tests and project verification; preserve bounded bulk operations and existing domain semantics.
