# 16 — Cuentas: every Bill, and a Customer's past Bills (Admin)

Status: ready-for-agent
Blocked by: 11
Spec: [`../spec.md`](../spec.md) §6.2 (Cuentas), §6.1 (Clientes: past Bills), §5.6, §7.4, §2.4, §4.1

## What to build

- **Cuentas** (Admin only): every Bill with its state (Abierta, Pago parcial, Pagada, Cancelada), filtered by date, state or Customer, 50 per page, index-driven (Bills by Day and state).
- On a Customer's page, Admins also see that Customer's past Bills (paged).
- Each row opens Cuenta.

## Acceptance criteria

- [ ] Filters by date, state and Customer work alone and combined; pages hold 50.
- [ ] A page's rows read do not grow with the total number of Bills.
- [ ] Workers are refused on Cuentas and do not receive past Bills on the Customer page.
