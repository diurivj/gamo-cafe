# 07 — Cuentas abiertas and Cuenta: see Open Bills and add Items to one

Status: ready-for-agent
Blocked by: 06
Spec: [`../spec.md`](../spec.md) §5.3, §6.1 (Cuentas abiertas, Cuenta), §7.4, §4.1, §4.2

## What to build

- **Cuentas abiertas**: every Open Bill (Abierta or Pago parcial), newest first, with Customer or note, Day, total, paid and owed. Searchable by Customer. Driven by an index on state; must stay cheap with 200 Open Bills.
- **Cuenta**: one Bill with its Lines (who and when), its state and what it owes, and **Agregar productos**, which opens Vender targeting this Bill so any User can add Lines to any Open Bill.
- A Worker can open only Open Bills (Paid and Voided Bills are Admin-only, server-enforced), apart from their own activity in Mi día (ticket 14).

Payments, Customer/note edits and corrections are added to Cuenta by tickets 08, 10 and 11.

## Acceptance criteria

- [ ] Cuentas abiertas lists Open Bills newest first with correct total, paid and owed, and filters by Customer.
- [ ] Adding Items from Cuenta puts the Lines on that Bill, by any User, each Line with its own author.
- [ ] Lines cannot be added to a Bill that is not Open.
- [ ] A Worker requesting a Paid Bill's page is refused.
- [ ] The Cuentas abiertas loader's statement count and rows read do not grow with the number of Paid Bills.
