# 09 — Abonar: pay across a Customer's Open Bills

Status: ready-for-agent
Blocked by: 08
Spec: [`../spec.md`](../spec.md) §5.2, §5.5, §6.1 (Clientes), §7.3 (2), §8.3, §10.3, §2.4

## What to build

The Customer page shows the Customer's Open Bills and what they owe, with **Abonar**.

- The User enters one amount, defaulting to everything owed and never above it, and a method.
- It is applied to the Customer's Open Bills oldest first, as one Payment per Bill with the same method, User and moment, and a shared handover reference.
- All of it is recorded or none of it: one batch, multi-row statements, conditional on the Bills not having changed. A stale submission changes nothing and tells the User.
- A retired Customer's Open Bills stay collectable.

## Acceptance criteria

- [ ] Flow §8.3: covered Bills become Paid, the last one touched may be Pago parcial.
- [ ] An amount above what the Customer owes is refused.
- [ ] If any Bill changed since the page was loaded (another phone paid), nothing is recorded.
- [ ] Paying a Customer with 30 Open Bills issues fewer than 50 D1 statements and no query exceeds 100 bound parameters.
- [ ] The Payments of one handover share a reference and are shown as one event on the Customer page.
