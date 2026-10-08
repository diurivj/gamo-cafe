# 05: Find a Customer and collect outstanding money

**What to build:** A User finds or adds a Customer, understands what they owe and records one handover across their Open Bills through Abonar. Redesign Clientes and Customer detail, including the Admin management actions and permitted history, using the payment interaction established by ticket 02. Existing Bill detail links work independently of ticket 03's redesign.

**Blocked by:** 02 — Record a sale through confirmation-first checkout.

**Status:** resolved

**Spec:** [UI redesign](../spec.md) §§4–8, 10.

- [x] Clientes supports accessible search and adding a Customer, shows existing matches before creation, and preserves case/accent-insensitive duplicate-name rules and useful validation.
- [x] Customer detail leads with identity and current Owed, then Open Bills and a clearly discoverable Abonar action. Preserve note/context, grouped handover history and Admin-only past Bills.
- [x] Abonar defaults to all current Owed and accepts a smaller positive amount, with Efectivo/Transferencia and optional cash-change help. Explain that it pays the oldest Open Bills first.
- [x] One handover records one Payment per affected Bill, all or nothing, with correct authorship and grouping. An overpayment or stale Bill set changes nothing and gives a useful message. Part cash/part transfer remains sequential handovers.
- [x] Pending/confirmed/refused/unknown states use the established payment behavior. Preserve submitted context and reuse the original identity/content for a safe retry; never optimistically reduce Owed or create duplicate Payments.
- [x] Admins can rename, retire and restore Customers with clear consequences. A retired Customer is unavailable for new Bills but their existing debts remain collectable. Workers cannot perform restricted management or see restricted past Bills.
- [x] Customer selection/creation within selling retains the same accessible labels, recognition and validation patterns without losing the sale draft.
- [x] Retain applicable paging, accessible Cargar más, filters/return position, and useful empty/loading/error states. Provide clear routes between Customer, Open Bills and collection without requiring repeated trips through Más.
- [x] Browser tests cover search/add/duplicate refusal, oldest-first partial/full Abonar, mixed-method sequential handovers, stale submissions, safe retry and retire/restore permissions. Assert actual Payment/Bill results and test mobile, keyboard and enlarged-text usability.
- [x] Run focused tests and project verification; preserve existing request budgets and domain semantics. No new Customer features or production changes are included.

## Comments

- 2026-10-07: Implemented. Review (standards and spec axes) found a confirmed result, and its change, taken off the screen by a read that was already on its way when the answer came (the step left while the Abonar was recording); a refusal shown for a frame on the Customer's page when its step was left; a Worker's refusal asserted in the browser only for restoring; and three README sentences the change left stale. All fixed before the commit; what stays open is under Answer.

## Answer

Clientes and Cliente are shadcn screens, and Abonar is confirmation-first like a sale and Cuenta's Payment. The README's "Abonar across a Customer's Bills" is the guidance.

- **Clientes**: the search has a visible label and a sentence that says what it is for, no placeholder. The matches come before the form that adds; a name an active Customer already has, whatever its case or accents, says so and is not offered. A name refused by the server (another phone added it first) keeps the note that was typed. The search is in the address, and the Customer's way back returns to it.
- **Cliente** leads with the name, the note, who added them and **Debe**, the figure, with how many Open Bills hold it. Then **Abonar**, the Open Bills oldest first, **Abonos** (each handover as one event), and for an Admin **Cuentas pasadas** and **Administrar cliente**. I kept "Debe" for the figure, as Cuenta uses it, and not CONTEXT.md's "Por cobrar", which stays the name of the Admin screen.
- **Abonar** is a step of the page, at `?paso=abonar`: the Customer and what they owe, that the oldest Bill is paid first, that part cash and part transfer are two abonos, `PaymentEntry`, and one action named by its amount. Its state is `customerPaymentAfter` in `app/shared/customer-payment.ts`. It is frozen at the tap with its own key and every Open Bill's revision, and sent with `sendForRecord` to a new route, `/clientes/:customerId/abonar`, which answers JSON. The page's own action takes no Abonar any more, so it needs JavaScript, as a sale and a Payment do.
- The result says the amount, the method, how many Bills it reached and what the Customer still owes, and keeps the change. **Registrar otro abono** is there while something is owed: the next one starts as cash for what is left, which is how part cash and part transfer are taken.
- A stale Abonar is refused whole; the screen reads the Customer again and keeps what was typed, checked against what is owed now. When nothing is owed any more, the Customer's page says the refusal.
- `takeCustomerPayment`'s rules are untouched. Its answer gained `owed`, what the Customer still owed once it was recorded, stored with the submission so a retry says the same.
- **Administrar cliente** keeps its two forms. Retiring and restoring say what they do before the button; a rename's refusal is tied to the Nombre field.
- A Bill opened from a Customer's page leads back to it (**Cliente**), in history.
- The Customer picker in selling was not changed: it already has its label, shows matches before "Agregar", refuses duplicates and never loses the sale (`e2e/vender.spec.ts`, `e2e/vender-recovery.spec.ts`); a retired Customer not being offered there is now asserted in `e2e/abonar.spec.ts`.
- `app/components/recording.tsx` now holds what Cuenta and Cliente share on screen (`Pending`, `SentRows`, `Change`, `useLeaveGuard`, `useReadAgainSince`); `payment-fields.tsx` is gone. The reducers stay apart: three small ones read more plainly than one generic one.
- The tests that used Abonar as their example of a form answered with a notice (`tests/notice.test.ts`, `e2e/redirect-after-recording.spec.ts`) now use Cuenta's Cliente y nota.

Results, 2026-10-07: `npm run verify` — 72 files, 768 tests passed. `npm run test:e2e` — 292 passed (Android and iPhone shapes). New: `tests/customer-payment.test.ts`, `e2e/support/customer.ts`; rewritten: `e2e/abonar.spec.ts` (13 tests), `tests/abonar-routes.test.ts`; extended: `e2e/customers.spec.ts`. The §10.7 budget test passes with its cap unchanged; it now posts the Abonar to the new route (200, not 302).

Left open:

- Cuenta has the fault that was fixed here for Abonar: a Payment or correction confirmed while a read of the Bill was already on its way can lose its result when that read lands. `bill.tsx` still calls `useReadAgainSince` without waiting for the User to go on.
- "Salir" in the leaving question, when the navigation was Back to the same Customer, changes the address but the Abonar on its way stays on screen until it is answered, as on Cuenta (ticket 03).
- **Ver cliente**, **Registrar otro abono** and the read after a stale refusal are ordinary reads: if one fails, the error page takes the screen's place. The Abonar was already said to be recorded, or refused.
- A `submissions` row of an Abonar recorded before this change has no `owed` in its answer and would not decode. Nothing can ask for one: the new route only receives keys made at the tap.
- The sentence about the oldest Bill is shown only to a Customer with more than one Open Bill.
- A duplicate name refused inside the picker is covered through the Worker (`tests/customers-routes.test.ts`), not in a browser.
- `customer.tsx` repeats `bill.tsx`'s send-once effect, focus effect and step/list history handling, and `record-handover.ts` repeats `record-payment.ts`'s method and amount parsing.
- "Handover" is the code's word for one Abonar (`handoverStatements`, `listCustomerHandovers`, now `record-handover.ts`), beside `takeCustomerPayment` and `customer-payment.ts`; it is not a CONTEXT.md term.
- Por cobrar still has the old look; its links to a Customer work. Ticket 07 redesigns it.
- No automated accessibility scan, screen reader or real device: focus, names, keyboard, 320px and 200% text are asserted by hand here; the rest is ticket 12's.
