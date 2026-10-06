# 04 — Productos: Items and Categories

Status: ready-for-agent
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
