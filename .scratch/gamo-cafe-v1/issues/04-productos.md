# 04 — Productos: Items and Categories

Status: resolved
Blocked by: 02
Spec: [`../spec.md`](../spec.md) §5.1, §5.8 (starting Stock), §6.2 (Productos), §7.2, §2.1

## What to build

On **Productos**, an Admin manages Categories (name, position, retire/restore) and Items (name, price, Category, stock-tracked flag defaulting to on, optional Minimum, retire/restore).

- Records: `categories`, `items`, and, because starting Stock entered when an Item is created is recorded as a Restock, the `adjustments` fact and the `stock_levels` projection (ticket 12 builds the Inventario screen on them).
- Active Item names are unique ignoring case and accents. Price is greater than zero, entered in pesos, stored in centavos.
- A Category with active Items cannot be retired. Nothing is deleted.
- Switching stock tracking changes no existing record.
- A read used by later tickets: active Items grouped by Category in position order, Items in name order.

## Acceptance criteria

- [ ] Creating an Item with starting Stock records one Restock Adjustment with its author and Day, and sets its Stock, in one batch.
- [ ] Duplicate active names (case and accent variants) are refused with a Spanish message; a retired Item's name can be reused.
- [ ] Retiring and restoring an Item keeps its records; retiring a Category with active Items is refused.
- [ ] A Worker calling any Productos loader or action is refused.

## Comments

- 2026-10-06: Implemented on `ticket/04-productos`, merged into `gamo-cafe-v1` at `2d15ddb`. Notes at `/Users/diurivj/coding/gamo-cafe-notes/04-notes.md`. The merge with ticket 05 moved `tidyName` into `catalog.ts`; `normalize-name.ts` holds only `normalizeName`.
- Ticket 12: an Item with no `stock_levels` row has Stock zero, so Inventario must `LEFT JOIN` and `COALESCE(units, 0)`. Ticket 11 and 19: `changeStock` tests `stock_tracked` when the statement runs, so the rebuild has to apply the same rule. Migration changes to `categories`, `items`, `adjustments` or `stock_levels` must update the direct writes in `e2e/fixtures.ts`.
