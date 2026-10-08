# 04: Correct a Bill and understand its History

**What to build:** A User can correct a Bill within their permissions, understand the consequence before committing a consequential action, and an Admin can inspect the preserved record in Historial. Complete the correction areas of the redesigned Cuenta and the full History experience without treating records as deletable.

**Blocked by:** 03 — Find an Open Bill and collect a Payment.

**Status:** resolved

**Spec:** [UI redesign](../spec.md) §§2.4, 6–8, 10.

- [x] Separate correction controls from routine selling/payment actions. Identify the affected Bill, Line or Payment and describe the consequence with a specific action label.
- [x] A Worker can remove a Line only while the Bill has no effective Payment. An Admin needs a reason when removing a Line after Payment, removing a Payment or voiding a Bill; preserve all existing server gates and stale-revision protection.
- [x] Refuse removing a Line if it would put the Bill total below paid money, with a useful explanation. Do not invent partial-Line edits or weaken existing correction rules.
- [x] Bill cancellation clearly explains its effect on figures and Stock and that it cannot be undone. Do not offer an unsupported undo. Avoid repetitive generic dialogs for ordinary reversible editing.
- [x] Pending and error feedback never presents a correction or Stock change as recorded before confirmation. Preserve necessary form context and do not blindly replay an unknown consequential operation as a new action.
- [x] Historial covers removed Lines/Payments, Voided Bills, Customer/note changes, Adjustments and cancelled Adjustments, retaining affected records, author, time and required reason in readable Spanish.
- [x] Original facts remain visible where appropriate. Corrections update the correct original Days' figures and restore Stock according to existing rules, not a newly invented UI calculation.
- [x] History remains Admin-only, newest-first and cursor-paged, with accessible Cargar más, useful empty/error states, and coherent return navigation.
- [x] End-to-end tests connect allowed corrections to Bill figures, Stock and History, and verify forbidden actions remain rejected. Cover keyboard confirmation/focus, long reasons, small screens and enlarged text.
- [x] Run focused tests and project verification; record evidence without rewriting historical issue outcomes or deploying.

## Comments

- 2026-10-07: Implemented. Review (standards and spec axes) found a retry answered as recorded even when it carried another reason than the one on file, a result that named Payments on a Bill that had none, a refusal that stayed on the Bill after the browser's Back although its step was still there, a Worker left with no word about asking an Admin when an outcome is unknown, and a README sentence that undercounted the route's programs. All fixed before the commit; what stays open is under Answer.

## Answer

A correction is a step of Cuenta, sent and answered as a Payment is, and Historial is a shadcn screen that shows each correction beside the record as it was made. The README's "Cuenta: its corrections" is the guidance.

- **Quitar**, **Quitar pago** and **Cancelar esta cuenta** are links into a step (`?paso=quitar-linea&id=…`, `?paso=quitar-pago&id=…`, `?paso=cancelar-cuenta`). The step shows the Bill and the record, lists what will happen, asks for **Motivo** when one is owed, and has one action named by its effect. Every correction goes through its step, the Worker's removal of a Line from an unpaid Bill included: it is a permanent record, and the step is specific, not a generic question.
- What is offered and what it says is `correctionPlan` in `app/shared/correction.ts`. A Line whose removal would leave the total below the Payments opens a step that says why and what to do first, with no action. A Worker with a Bill that has a Payment sees no correction and one sentence saying who can. Stock is said only to an Admin, for Lines that moved it (`getBill` now reads `movedStock`).
- The correction's state is `correctionAfter`: typed, recording, unknown, confirmed, gone. It goes with `sendForRecord` to a new route, `/cuentas/:billId/corregir`. The page's action takes no correction any more, so a correction needs JavaScript, as a sale and a Payment do.
- No submission key and no migration. Every correction moves the Bill's revision, so the same snapshot can never be recorded twice. A retry after a lost answer is refused as stale; the route then finds this User's own correction of that record, with that reason, and answers with it (`recordedCorrection`).
- Nothing is read after a correction until **Ver cuenta**. A Worker whose removal emptied the Bill sees the result and Cuentas abiertas; the old redirect to the list is gone.
- The operations' rules are untouched. They now return the Bill's figures (`total`, `paid`, `voided`) in place of `leftOpen`.
- Historial: each entry is what was done, the record, which Bill, who made the record and when (`Agregado por`, `Recibido por`, `Registrado por`), who corrected it and when, and the reason. `listHistory` reads those in the same six statements. **Ver cuenta** leads to a Bill whose way back is **Historial**, in history, so the list's pages and place are restored.
- `Textarea` was added from shadcn and brought to the app's sizes; it grows with a long reason.

Results, 2026-10-07: `npm run verify` — 71 files, 744 tests passed. `npm run test:e2e` — 270 passed (Android and iPhone shapes). New: `tests/correction.test.ts`; rewritten: `e2e/corrections.spec.ts` (10 tests), `tests/corrections-routes.test.ts`; extended: `e2e/historial.spec.ts`, `tests/corrections.test.ts`, `tests/history.test.ts`.

Left open:

- `tests/history-paging.test.ts` capped a deep page of Historial at 1,500 rows read; it reads about 1,600 now, for the original record's author on each entry, and the cap is 1,700. Rows read still do not grow with the history, and the §10.7 budget test (cap 3,000) passes unchanged.
- **Ver producto** from Historial leads to Producto, whose way back is still Productos; the browser's Back returns to Historial. Ticket 10 redesigns Producto.
- A reload on a correction's step forgets that the Bill was opened from Historial: the way back is then Cuentas abiertas.
- A Worker who presses the browser's Back on the result of a removal that emptied the Bill gets "No tienes acceso a esta página", as after a full Payment (ticket 03).
- A Payment's refusal still stays on the Bill after the browser's Back; only the correction's was narrowed here.
- `correction.ts` and the correction half of `bill.tsx` are a third copy of the recording/unknown/confirmed machine, and `record-correction.ts` repeats `record-payment.ts`'s revision parsing and `canOpen` read. Ticket 05 adds Abonar: that is the moment to extract what they share.
- `e2e/load-more.spec.ts` "the next page loads by itself" failed once in one run (two pages loaded before the count was read) and passed in 36 repeats and both full runs; it does not touch this ticket's code.
- No automated accessibility scan, screen reader or real device: focus, names, keyboard, 320px and 200% text are asserted by hand here; the rest is ticket 12's.
