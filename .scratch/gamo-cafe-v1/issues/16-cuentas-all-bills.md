# 16 — Cuentas: every Bill, and a Customer's past Bills (Admin)

Status: resolved
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

## Comments

- 2026-10-06: Implemented on `ticket/16-cuentas`, merged into `gamo-cafe-v1` at `bfb9b9c`. Paging: one statement per state arm on `bills_by_state` (or `bills_by_day_state` with a Day), each `LIMIT offset + 51`, merged by `opened_at`; the Customer path uses `bills_by_customer_day`. 50 rows + 1 gives `hasMore` without counting; pages past `MAX_BILL_PAGE` (200) are answered with zero reads. `tests/support/d1.ts` measures rows read with 400 and 800 unrelated Bills added. Decisions: past Bills are Pagada/Cancelada; the date filter is one Day; the Customer filter is the exact picker, not a prefix. `listBills`/`listCustomerPastBills` both `requireAdmin`.
