# 03: Find an Open Bill and collect a Payment

**What to build:** A User finds an Open Bill, understands its state and remaining Owed, inspects what was consumed and paid, adds Items through the new selling flow, and records a full or partial Payment. Redesign Cuentas abiertas and the routine parts of Cuenta using the established payment interaction. Keep existing corrections functional until ticket 04 completes their redesign.

**Blocked by:** 02 — Record a sale through confirmation-first checkout.

**Status:** ready-for-agent

**Spec:** [UI redesign](../spec.md) §§4–8, 9–10.

- [ ] Cuentas abiertas is searchable by Customer and shows Customer/note, Day, total, paid and Owed with an obvious path to the Bill. Abierta and Pago parcial are distinguishable without color.
- [ ] Cuenta leads with state and Owed, then readable Lines and Payments retaining author, time, amount and method. A Bill is not presented as having an owner.
- [ ] Agregar productos opens the new selling flow targeting this Bill, preserves the target through review/submission and reports the correct updated total/Owed.
- [ ] Customer/note editing follows the existing before/after-Payment permissions and retains History; stale revisions explain the conflict without applying a partial change.
- [ ] Cobrar defaults to the outstanding amount, supports partial Payment and cash change, and clearly separates recording a Payment from recording additional Items. No overpayment is accepted.
- [ ] Reuse confirmation-first payment feedback: immediate pending state, no optimistic money, preserved context on refusal/unknown outcome, and same-submission safe retry. A concurrent Payment from another phone is either safely recorded or visibly refused without an extra write.
- [ ] Workers can finish a full Payment and see its result without being sent into a now-restricted Paid Bill. Admin access to Paid/Voided Bills and permitted corrections remains intact.
- [ ] Lists retain cursor pagination, accessible Cargar más, search scope, focus behavior and return position. Show useful empty/loading/error states and preserve filters on return.
- [ ] Browser tests cover search → Bill → add Items and search → partial/full Payment for both roles, stale payment conflicts, metadata gates and list restoration. Include long names/amounts, keyboard operation, mobile/enlarged-text layouts and accessibility checks.
- [ ] Run focused tests and project verification; preserve request budgets, attribution and server permissions. No production or pilot release is part of this ticket.
