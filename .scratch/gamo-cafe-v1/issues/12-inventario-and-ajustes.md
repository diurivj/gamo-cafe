# 12 — Inventario: Stock, Minimums and Adjustments

Status: ready-for-agent
Blocked by: 04
Spec: [`../spec.md`](../spec.md) §5.8, §6.2 (Inventario), §7.2, §7.3 (5), §8.6, §10.5, §4.1, §4.2

## What to build

**Inventario** (Admin only): each stock-tracked Item's Stock and Minimum, flagged for restocking when Stock is at or below its Minimum and flagged separately when Stock is below zero. From here an Admin records an **Ajuste** and cancels one.

- An Adjustment is one Item, a whole number of units of at least 1, a reason (Entrada adds; Merma and Consumo interno subtract) and an optional note.
- Cancelling an Adjustment needs a reason, is recorded as `adjustment_cancellations`, reverses its effect, and can happen once.
- Each is one batch with the `stock_levels` projection, by relative amounts.
- No screen edits Stock directly. Workers never see Stock numbers.

## Acceptance criteria

- [ ] Each kind of Adjustment, and cancelling one, moves Stock by exactly the expected amount.
- [ ] An Item at or below its Minimum is flagged; an Item below zero is flagged separately.
- [ ] An Adjustment on an Item that is not stock-tracked is refused.
- [ ] A Worker calling any Inventario loader or action is refused.
- [ ] Flow §8.6 passes.
