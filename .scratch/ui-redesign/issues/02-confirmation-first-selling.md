# 02: Record a sale through confirmation-first checkout

**What to build:** A User selects Items, reviews the selection, records a Payment or leaves the Bill Open, waits for a truthful result, and explicitly starts a new sale. Replace the overlapping-sale interaction with one understandable live workflow, including safe recovery. Any necessary prefactoring of selection/submission state happens first within this ticket, preserving domain operations and keeping existing capabilities usable. Establish payment/recovery interaction patterns for tickets 03 and 05.

**Blocked by:** 01 — Sign in and navigate the redesigned app.

**Status:** resolved

**Spec:** [UI redesign](../spec.md) §§2.2, 3.3, 5–6, 8–10.

- [x] Step 1 groups Items predictably by Category with names, prices, immediate add/subtract feedback, visible quantities and a readily available running total/forward action. Helpful lightweight category illustrations supplement labels; unmatched Categories still work without artwork.
- [x] Step 2 shows the selection and total, explicit Efectivo/Transferencia choices, full payment by default, optional partial payment, and cash-change help. The final action states the amount being recorded; ordinary payment has no redundant confirmation dialog.
- [x] Customer search/add, note and Dejar abierta remain discoverable and optional. An anonymous Bill can remain Open; no Stock level blocks recording. Adding to an existing Open Bill clearly identifies its target and preserves restrictions on Customer/note changes.
- [x] A selection's Payment never pays prior debt implicitly. Same-Day Customer routing and partial payment preserve existing rules; confirmation accurately distinguishes a Paid Bill from one with remaining Owed.
- [x] Back between steps preserves selection and applicable form values. Clearing or navigating away from an unfinished selection requires an explicit discard decision. Pending/unknown navigation explains that leaving does not cancel server processing; browser unload protection is best-effort, not a guarantee.
- [x] Submission freezes its content and identity, retains its visible context, acknowledges the tap by the next painted frame, and blocks another submission/new sale while recording. Apply this to Payment, Dejar abierta and adding Items to a Bill.
- [x] Distinguish confirmed, refused and unknown outcomes. A refusal preserves usable input; an unknown outcome retains an immutable submission snapshot and offers safe reconciliation/retry with the same identity and identical content. No duplicate Lines, Bills, Payments or Stock movements result.
- [x] A successful mutation followed by a failed read stays confirmed and offers a refresh, not a new mutation. Transport errors do not replace the live workflow with a screen that destroys its recovery context. Notices remain associated with their submitting action.
- [x] Confirmed results retain applicable change, method, recorded amount and remaining Owed, with a prominent Nueva venta. Only that action resets sale-specific values; a previous transfer selection does not silently carry into the next sale. Workers can see confirmation without accessing a restricted Paid Bill.
- [x] Forced-close/restart handling does not automatically resubmit or infer failure; provide a truthful way to check recorded activity/Bills. Do not add offline queues or promise cross-restart draft persistence.
- [x] Browser tests cover cash, transfer, partial/open/named/anonymous sales, existing-Bill targeting, Customer prior debt, Back/discard, duplicate taps, a held request, refusal, failure before recording, lost response after recording and failed revalidation after success. Verify recorded facts and Stock effects, not only messages.
- [x] Verify keyboard/focus/announcements, 320 px and enlarged-text layouts, sticky total/navigation interaction, and the mobile keyboard. The cash-change input is not confused with the stored Payment amount.
- [x] Update implementation guidance and superseded UI tests/documentation for confirmation-first selling; retain historical issue records and domain guarantees. Run focused browser tests and project verification before completion.

## Comments

- 2026-10-06, decided before starting:
  - The look is shadcn/ui (spec §3.2, README "The look and the navigation"); build both steps from its components, adding the ones needed.
  - Illustrations are one small line drawing per Category, not per Item; a Category with no fitting drawing shows none.
  - Step 1 also gets a search field and a Category filter, which the User liked in the prototype.
  - Users land on Inicio; its "Nueva venta" card and the Vender destination both open step 1. After a confirmed sale, Nueva venta stays on Vender.
- 2026-10-07: Implemented. Review (standards and spec axes) found a retry that could claim "nothing was recorded" after a session ended, a stale price that dead-ended a full payment, a refusal that never cleared, the Customer picker's failures replacing the screen, the target Bill missing once a sale was sent, and Nueva venta demoted on a targeted sale. All fixed before the commit; what stays open is under Answer.

## Answer

Vender is two steps and a result: step 1 chooses the Items (search, Category filter, a drawing per Category that fits one), step 2 at `?paso=cobrar` reviews them and records a Payment or leaves the Bill Open, and the confirmed result stays until **Nueva venta**. The README's "Vender: one sale at a time" is the guidance for tickets 03 and 05.

- The sale's state and rules are one reducer, `saleAfter` in `app/shared/sale.ts`: editing, recording, unknown, confirmed. A sale is frozen into a snapshot with its own submission key at the tap; a retry sends that snapshot byte for byte.
- A sale no longer goes through the router. It is sent with the browser's `fetch` (`sendForRecord`, `app/shared/record-request.ts`) to a new route, `/vender/registrar`, which answers JSON. `/` has no action any more. That is what keeps a failed request from replacing the screen with the error page.
- Nothing is read after a sale: the answer carries the Bill as the sale left it. So "a successful mutation followed by a failed read" cannot happen on Vender, and there is no refresh to offer; the test proves no read is made and that the next sale works with every read failing.
- The Customer picker searches and adds with `fetch` too, on every screen that uses it, and was moved to shadcn components.
- `PaymentEntry`, `ConfirmDialog` and `sendForRecord` are the patterns for tickets 03 and 05. Cuenta and Abonar still use the old `PaymentFields`.
- The v1 spec §3.4 and §6.1 point here for what was superseded; resolved issue files were left as they were.

Results, 2026-10-07: `npm run verify` — 69 files, 680 tests passed. `npm run test:e2e` — 226 passed (Android and iPhone shapes), including `e2e/vender.spec.ts`, `e2e/vender-recovery.spec.ts` and the 320px and 200%-text checks of both steps in `e2e/navigation.spec.ts`.

Left open:

- A selection emptied with the minus buttons keeps the Customer, note and Payment typed for it, and leaving then asks nothing. Only **Vaciar** resets them.
- When a price rose since Vender was opened, a "full" Payment is recorded for the old total and the result says what the Bill still owes. Only a price that fell is refused and read again.
- With text at 200% on a small phone the sticky total covers much of step 1; everything is reachable by scrolling.
- The module is named `sale` although CONTEXT.md lists "Sale" as a word to avoid for a Line. It follows the redesign spec's "sale" and the screen's "venta"; it does not name a Line.
- The mobile keyboard, a screen reader, a real device and the automated accessibility scan are ticket 12's, as in ticket 01.
