# 03: Find an Open Bill and collect a Payment

**What to build:** A User finds an Open Bill, understands its state and remaining Owed, inspects what was consumed and paid, adds Items through the new selling flow, and records a full or partial Payment. Redesign Cuentas abiertas and the routine parts of Cuenta using the established payment interaction. Keep existing corrections functional until ticket 04 completes their redesign.

**Blocked by:** 02 — Record a sale through confirmation-first checkout.

**Status:** resolved

**Spec:** [UI redesign](../spec.md) §§4–8, 9–10.

- [x] Cuentas abiertas is searchable by Customer and shows Customer/note, Day, total, paid and Owed with an obvious path to the Bill. Abierta and Pago parcial are distinguishable without color.
- [x] Cuenta leads with state and Owed, then readable Lines and Payments retaining author, time, amount and method. A Bill is not presented as having an owner.
- [x] Agregar productos opens the new selling flow targeting this Bill, preserves the target through review/submission and reports the correct updated total/Owed.
- [x] Customer/note editing follows the existing before/after-Payment permissions and retains History; stale revisions explain the conflict without applying a partial change.
- [x] Cobrar defaults to the outstanding amount, supports partial Payment and cash change, and clearly separates recording a Payment from recording additional Items. No overpayment is accepted.
- [x] Reuse confirmation-first payment feedback: immediate pending state, no optimistic money, preserved context on refusal/unknown outcome, and same-submission safe retry. A concurrent Payment from another phone is either safely recorded or visibly refused without an extra write.
- [x] Workers can finish a full Payment and see its result without being sent into a now-restricted Paid Bill. Admin access to Paid/Voided Bills and permitted corrections remains intact.
- [x] Lists retain cursor pagination, accessible Cargar más, search scope, focus behavior and return position. Show useful empty/loading/error states and preserve filters on return.
- [x] Browser tests cover search → Bill → add Items and search → partial/full Payment for both roles, stale payment conflicts, metadata gates and list restoration. Include long names/amounts, keyboard operation, mobile/enlarged-text layouts and accessibility checks.
- [x] Run focused tests and project verification; preserve request budgets, attribution and server permissions. No production or pilot release is part of this ticket.

## Comments

- 2026-10-07: Implemented. Review (standards and spec axes) found the way back to the list landing on the same Bill after a refused Payment replaced the step, a confirmed result (and its change) skipped when the Bill had been read again before the answer came, a refusal that stayed on the Bill for good, and a `run` without an exhaustive error map. All fixed before the commit; what stays open is under Answer.

## Answer

Cuentas abiertas and Cuenta are shadcn screens, and Cuenta's Payment is confirmation-first like a sale. The README's "Cuenta: taking its Payment" is the guidance; ticket 05 reuses the same pieces for Abonar.

- Cuenta leads with the state and Debe, then **Cobrar** and **Agregar productos**, then Lines and Payments, then Cliente y nota and the corrections. Cobrar is a step of its own at `?paso=cobrar`, so the browser's Back returns to the Bill.
- The Payment's state and rules are one reducer, `billPaymentAfter` in `app/shared/bill-payment.ts`. It is frozen at the tap with its own submission key and the Bill's revision, and sent with `sendForRecord` to a new route, `/cuentas/:billId/cobrar`, which answers JSON. The page's action no longer takes `intent=pagar`, so a Payment needs JavaScript, as a sale does since ticket 02.
- Nothing is read after a Payment until the User asks. A Worker whose Payment left the Bill Paid sees the result and Cuentas abiertas, never the Bill. A Worker whose Bill another phone paid or voided is told nothing was recorded, in place of the 403 page.
- A refused form of the page (Cliente y nota, a correction) now reads the Bill again, so the next attempt carries its current revision.
- The way back to the list goes back in history when the list is the entry behind the Bill (search, pages and place restored); otherwise it is a link to the list's last search, kept in the tab's memory (`app/shared/list-return.ts`).
- `Badge` was brought to the app's sizes and `LoadMore` to a shadcn button, which every paged list shows.
- The corrections keep their forms and rules, in shadcn components; their redesign is ticket 04's.

Results, 2026-10-07: `npm run verify` — 70 files, 704 tests passed. `npm run test:e2e` — 254 passed (Android and iPhone shapes). New: `tests/bill-payment.test.ts`, `e2e/cuenta-cobrar.spec.ts`, a restoration test in `e2e/load-more.spec.ts`.

Left open:

- A Worker who presses the browser's Back on the result of a full Payment lands on the Bill's entry and gets "No tienes acceso a esta página". The screen's own actions never lead there.
- **Ver cuenta** after a confirmed Payment is an ordinary read: if it fails, the error page takes the result's place. The Payment was already said to be recorded.
- "Salir" in the leaving question, when the navigation was Back to the same Bill, changes the address but the Payment on its way stays on screen until it is answered.
- `bill-payment.ts` and `bill.tsx` repeat the shape of `sale.ts` and `home.tsx` (the recording/unknown/confirmed machine, the send-once effect, the blocker). Ticket 05 adds a third; that is the moment to extract what the three share.
- No automated accessibility scan: roles, names, focus, 320px and 200% text are asserted by hand here; the scan, a screen reader and a real device are ticket 12's, as in tickets 01 and 02.
