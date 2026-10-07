# 02: Record a sale through confirmation-first checkout

**What to build:** A User selects Items, reviews the selection, records a Payment or leaves the Bill Open, waits for a truthful result, and explicitly starts a new sale. Replace the overlapping-sale interaction with one understandable live workflow, including safe recovery. Any necessary prefactoring of selection/submission state happens first within this ticket, preserving domain operations and keeping existing capabilities usable. Establish payment/recovery interaction patterns for tickets 03 and 05.

**Blocked by:** 01 — Sign in and navigate the redesigned app.

**Status:** ready-for-agent

**Spec:** [UI redesign](../spec.md) §§2.2, 3.3, 5–6, 8–10.

- [ ] Step 1 groups Items predictably by Category with names, prices, immediate add/subtract feedback, visible quantities and a readily available running total/forward action. Helpful lightweight category illustrations supplement labels; unmatched Categories still work without artwork.
- [ ] Step 2 shows the selection and total, explicit Efectivo/Transferencia choices, full payment by default, optional partial payment, and cash-change help. The final action states the amount being recorded; ordinary payment has no redundant confirmation dialog.
- [ ] Customer search/add, note and Dejar abierta remain discoverable and optional. An anonymous Bill can remain Open; no Stock level blocks recording. Adding to an existing Open Bill clearly identifies its target and preserves restrictions on Customer/note changes.
- [ ] A selection's Payment never pays prior debt implicitly. Same-Day Customer routing and partial payment preserve existing rules; confirmation accurately distinguishes a Paid Bill from one with remaining Owed.
- [ ] Back between steps preserves selection and applicable form values. Clearing or navigating away from an unfinished selection requires an explicit discard decision. Pending/unknown navigation explains that leaving does not cancel server processing; browser unload protection is best-effort, not a guarantee.
- [ ] Submission freezes its content and identity, retains its visible context, acknowledges the tap by the next painted frame, and blocks another submission/new sale while recording. Apply this to Payment, Dejar abierta and adding Items to a Bill.
- [ ] Distinguish confirmed, refused and unknown outcomes. A refusal preserves usable input; an unknown outcome retains an immutable submission snapshot and offers safe reconciliation/retry with the same identity and identical content. No duplicate Lines, Bills, Payments or Stock movements result.
- [ ] A successful mutation followed by a failed read stays confirmed and offers a refresh, not a new mutation. Transport errors do not replace the live workflow with a screen that destroys its recovery context. Notices remain associated with their submitting action.
- [ ] Confirmed results retain applicable change, method, recorded amount and remaining Owed, with a prominent Nueva venta. Only that action resets sale-specific values; a previous transfer selection does not silently carry into the next sale. Workers can see confirmation without accessing a restricted Paid Bill.
- [ ] Forced-close/restart handling does not automatically resubmit or infer failure; provide a truthful way to check recorded activity/Bills. Do not add offline queues or promise cross-restart draft persistence.
- [ ] Browser tests cover cash, transfer, partial/open/named/anonymous sales, existing-Bill targeting, Customer prior debt, Back/discard, duplicate taps, a held request, refusal, failure before recording, lost response after recording and failed revalidation after success. Verify recorded facts and Stock effects, not only messages.
- [ ] Verify keyboard/focus/announcements, 320 px and enlarged-text layouts, sticky total/navigation interaction, and the mobile keyboard. The cash-change input is not confused with the stored Payment amount.
- [ ] Update implementation guidance and superseded UI tests/documentation for confirmation-first selling; retain historical issue records and domain guarantees. Run focused browser tests and project verification before completion.
