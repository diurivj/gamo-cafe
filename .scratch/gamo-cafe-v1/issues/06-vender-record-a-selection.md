# 06 — Vender: record a selection and leave the Bill Open

Status: ready-for-agent
Blocked by: 04, 05
Spec: [`../spec.md`](../spec.md) §2.2, §5.3, §5.4, §5.8, §6.1 (Vender), §7.2, §7.3 (1), §8.2, §10.2, §10.5 · ADR 0002, 0003

## What to build

**Vender** becomes the home screen. Items are large buttons grouped by Category; tapping adds one unit to a selection held in the browser, with quantities, running total, and add / subtract / clear. The User may choose a Customer (picker from ticket 05) or type a note, then taps **Dejar abierta**. (Cobrar arrives in ticket 08.)

- Records: `bills` (with projections: current Customer, current note, total, paid, state, revision) and `lines`.
- "Record a selection" is one batch: the new Bill if needed, one Line per distinct Item at the Item's current price, the Bill's projections, and Stock for stock-tracked Items. Shape it so ticket 08 can add the on-the-spot Payment to the same batch.
- Routing: with a Customer, Lines go onto that Customer's most recently opened Open Bill of the current Day, else a new Bill. With no Customer, a new Bill, unless adding to a given Open Bill (the operation accepts a target Bill; ticket 07 adds the screen entry point).
- Stock never blocks a sale and may go below zero. Lines for an Item that is not stock-tracked do not move Stock.
- Adding Lines never conflicts: totals and Stock change by relative amounts.
- Bill state is derived (§5.6), never set by hand.

## Acceptance criteria

- [ ] Two selections for the same Customer on the same Day land on one Bill while it is Open, and on a new Bill on a later Day (test clock).
- [ ] A Line keeps its price after the Item's price changes.
- [ ] A retired Item cannot be added, and a retired Customer cannot be chosen.
- [ ] A Bill with no Customer can be left Open.
- [ ] Two concurrent additions to the same Bill both succeed and the total reflects both.
- [ ] Selling an Item whose Stock is zero succeeds and leaves Stock at minus one; a non-stock-tracked Item leaves Stock untouched.
- [ ] Every Line carries the signed-in User, the instant and the Day.
- [ ] Recording a ten-Item selection issues well under 50 D1 statements.
- [ ] Playwright: flow §8.2 end to end on a phone viewport.
