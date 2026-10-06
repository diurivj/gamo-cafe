# 17 — Por cobrar (Admin)

Status: resolved
Blocked by: 09, 11
Spec: [`../spec.md`](../spec.md) §5.3, §5.9 (Owed), §6.2 (Por cobrar), §10.2, §4.1

## What to build

**Por cobrar** (Admin only): each Customer with what they owe and the Day of their oldest Open Bill, then the Open Bills with no Customer, flagged when from an earlier Day. Overall Owed at the top. Rows link to the Customer page or to Cuenta.

## Acceptance criteria

- [ ] A Bill with no Customer left Open is flagged the next Day (test clock) and not on its own Day.
- [ ] A Customer's owed figure equals the sum still owed on their Open Bills; Paid and Voided Bills count for nothing.
- [ ] Rows read are proportional to Open Bills, not to history.
- [ ] Workers are refused.

## Comments

- 2026-10-06: Implemented on `ticket/17-por-cobrar`, merged into `gamo-cafe-v1` at `18666e8`. One index-driven statement over `bills_by_state` (`state IN ('open','partial') AND total > paid`), folded in `app/backend/owed.ts`; rows read are the Open Bills themselves — measured 5 Open Bills → 7 rows, +200 Paid and +200 Voided add 0–1, 200 Open → 502. Decisions: Customers ordered by oldest Day then `normalized_name`, loose Bills oldest first; `fromEarlierDay` is `day < today` and applies to the no-Customer rows; retired Customers stay collectable. `requireAdmin` on the read, `requireAdminUser` on the route, rows link to `/clientes/:id` and `/cuentas/:id`.
