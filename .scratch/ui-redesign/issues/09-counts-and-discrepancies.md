# 09: Count Stock and inspect Discrepancies

**What to build:** An Admin enters quantities found on the shelf without seeing expected Stock, reviews the comparison, confirms the Count and understands the recorded Discrepancies. Complete Conteo and Diferencias from the redesigned Inventario entry point.

**Blocked by:** 08 — Inspect Stock and record Adjustments.

**Status:** resolved

**Spec:** [UI redesign](../spec.md) §§2.4, 4, 6–10.

- [x] Count entry clearly identifies each Item and accepts whole quantities found, including zero, without showing expected Stock or leaking it through helper text/accessible names.
- [x] Preserve Counts of any subset of Items: untouched fields are not silently treated as zero or included in the Count. Backtracking preserves entered quantities and applicable notes.
- [x] Review shows expected, found and difference with Faltante, Sobrante or Sin diferencia. Confirmation is explicit and describes the effect of recording the Count; it is not a direct Stock edit.
- [x] The recorded expected Stock and Discrepancy follow the existing confirmation-time rules, including other operations between entry/review/confirmation. Do not freeze stale expectations into authoritative records merely because review displayed them.
- [x] Pending state acknowledges the tap immediately; Stock is not presented as changed before confirmation. Preserve refused/unknown context and use the same identity/content for safe retry so a lost response cannot record another Count.
- [x] After confirmation, show the recorded outcome and clear paths to Inventario and Diferencias. Counts with zero Discrepancy remain recorded and understandable.
- [x] Diferencias retains Item, expected/found/difference, Count context and attribution, with readable text distinctions, cursor pagination and accessible Cargar más.
- [x] Tests cover partial Counts, explicit zero versus blank, negative/invalid input, backtracking, review, intervening Stock changes, duplicate submission and the recorded Count/Stock/Discrepancy results. Workers remain refused.
- [x] Verify long lists/names, keyboard entry/focus, mobile keyboards, narrow screens, enlarged text and screen-reader labels/statuses. Include useful empty/loading/error states.
- [x] Run focused tests and project verification; preserve bounded bulk operations and existing domain semantics.

## Answer

Conteo is a shadcn screen built like Inventario's steps, and a Count is sent the way an Adjustment is: frozen at the tap, and said only as what is known.

- **The fields** (`app/routes/conteo.tsx`, `/inventario/conteo`) are one per stock-tracked Item, labelled by the Item's name alone, with a numeric keyboard and a search of the screen's own that hides fields without losing what they hold. The loader carries names and nothing about Stock. A bar above the navigation says "Contados: 3 de 60" and holds **Revisar conteo**. A field left empty is an Item left out; `0` is a count. A sign, a decimal or a word is said under its field, nothing is asked while one cannot be read, and the first takes the keyboard.
- **The review** (`?paso=revisar`) shows each counted Item with Esperado, Contado and **Faltante**, **Sobrante** or **Sin diferencia**, what they add up to, the note, what recording does ("Al registrar, las existencias de estos 3 productos quedan en lo contado", nothing changes yet, the Count is kept in Diferencias, the expected is read again) and one action named by its effect: "Registrar conteo de 3 productos". **Volver a contar** and the browser's Back keep everything typed; typing after a review discards it.
- **Recording** is `~/shared/count` (`countAfter`: editing with its review, recording, unknown, confirmed). The review and the Count go with `sendForRecord` to the new `/inventario/conteo/registrar` (`app/routes/resources/record-count.ts`): `revisar` reads and records nothing, `registrar` answers the Count as it was recorded. The page has no action any more. The submission key is made at the tap, so an unknown outcome is retried as the very same snapshot and recorded once.
- **What was expected is the Stock of the moment of recording**, as before (`countStatements` was not touched). The result shows the recorded lines, and says so when they differ from what the review showed.
- **The result** stays, with **Volver a Inventario** and **Ver diferencias**. A Count with no Discrepancy is recorded and listed like any other.
- **Diferencias** (`app/routes/diferencias.tsx`) is a card per Count: when, who recorded it, its note, its sum in words and its lines (`CountLineItem`), with the same cursor paging and **Cargar más**.
- **What was typed** is guarded like an unfinished sale: leaving Conteo asks first, moving between its two steps does not (`useLeaveGuard` took a `within` option for that).
- **Nothing about Stock changed**: `recordCount` and `previewCount` are untouched; `recordCountAndRead` adds one read of the Count just recorded. A Worker is refused both screens and the route (403).

Changed outside the screens:

- The tests that posted to `/inventario/conteo` send to `/inventario/conteo/registrar` (`sendCount` in `tests/support/sales.ts`); the request budget's "Count of every Item" is that request and answers 200.
- The Count's test in `e2e/pending-ui.spec.ts` moved to `e2e/conteo.spec.ts`.
- Inventario's links use the new path constants.

Results, 2026-10-08: `npm run verify` — 74 files, 829 tests passed. `npm run test:e2e` — 342 passed (Android and iPhone shapes). New: `tests/count.test.ts` (21 tests), `e2e/support/count.ts`. Rewritten: `tests/conteo.test.ts`, `e2e/conteo.spec.ts` (11 tests per phone shape).

Left open:

- Without JavaScript a Count can no longer be reviewed or recorded, the same trade Inventario made.
- The browser's Forward to a review that was left shows it as it was read; only a tap on **Revisar conteo** reads again. What is recorded is still read at that moment.
- After a refusal the review's address is replaced by the fields', which leaves two entries for the fields: Back seems to do nothing once.
- A read that fails after a refusal is the shared error screen, and what was typed is lost with it, as on Inventario.
- What was typed does not survive a reload or a session that ended.
- The review named duplication left alone: the search block is Inventario's, `itemsText` is `unitsText` of `~/shared/sale`, and the two `sendForRecord` effects share a shape.
- No automated accessibility scan, screen reader or real device: that is ticket 12's.
