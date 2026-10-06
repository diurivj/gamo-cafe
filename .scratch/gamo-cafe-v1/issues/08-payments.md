# 08 — Payments: Cobrar on Vender and pay from a Bill

Status: ready-for-agent
Blocked by: 07
Spec: [`../spec.md`](../spec.md) §2.3, §5.5, §5.6, §6.1 (Vender, Cuenta), §7.2, §7.3 (1, 2 and Concurrency), §8.1, §10.2, §10.3

## What to build

- Record: `payments` (Bill, amount, method cash or transfer, handover reference, received by, at, Day).
- **Cobrar** on Vender: records the selection and a Payment together in the one batch from ticket 06. Method; optional amount handed over with the change shown (not stored); optionally an amount lower than the total.
- **Cobrar / Abonar** on Cuenta: amount defaults to what the Bill still owes and may be less. Cuenta lists Payments with who, when and method.
- A Payment is greater than zero and never more than the Bill still owes. The check is a conditional write expressed in SQL (revision or equivalent), because a D1 batch cannot branch: a stale submission changes nothing and the User is told the Bill has changed.
- Bill projections (paid, state, revision) are written in the same batch. Customer routing from ticket 06 now sends a new selection to a new Bill once the day's Bill is Paid.

## Acceptance criteria

- [ ] A walk-up sale produces one Paid Bill whose Lines and Payment carry the signed-in User (flow §8.1, Playwright).
- [ ] A Payment larger than what the Bill owes, or of zero, is refused.
- [ ] Two concurrent full Payments on one Bill produce exactly one Payment; the other submission gets the "Bill has changed" message.
- [ ] A partial Payment leaves the Bill Pago parcial; paying the rest makes it Pagada.
- [ ] After a Customer's Bill is Paid, their next selection the same Day starts a new Bill.
- [ ] The change shown equals amount handed over minus amount paid (pure function, unit-tested; integer centavos).
