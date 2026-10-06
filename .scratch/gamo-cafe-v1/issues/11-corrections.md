# 11 — Corrections: remove a Line, remove a Payment, void a Bill

Status: ready-for-agent
Blocked by: 08
Spec: [`../spec.md`](../spec.md) §2.1, §5.6, §5.7, §5.8, §4.1, §6.1 (Cuenta), §7.2, §7.3 (3 and Concurrency), §8.4, §8.5, §10.4 · ADR 0002

## What to build

On **Cuenta**, as permitted:

- **Remove a Line**: any User when the Bill has no (unremoved) Payment; an Admin with a reason otherwise. Removed whole. Refused if it would leave the total below the Payments. Returns its units to Stock.
- **Remove a Payment**: an Admin, with a reason.
- **Void a Bill**: an Admin, with a reason; cannot be undone. Its Lines' units return to Stock; it leaves Sold, Collected and Owed.
- Records: `line_removals`, `payment_removals`, `bill_voids`. The original records are never touched.
- Each correction is one batch with its effect on the Bill's projections and on Stock, conditional on the Bill's revision so a stale submission changes nothing.
- A Bill left with no Lines counts as Paid with a zero total.
- Cuenta shows removed Lines and Payments as removed, with who, when and why, and the Voided state.

## Acceptance criteria

- [ ] Every §10.4 criterion except the History list itself (ticket 18).
- [ ] A Worker removing a Line from a Bill with a Payment, removing a Payment, or voiding is refused on the server.
- [ ] Removing a Line and voiding a Bill each move Stock back by exactly the expected amount; non-stock-tracked Items are untouched; already-removed Lines are not returned twice on void.
- [ ] After removing the only Payment, a Worker can again remove a Line.
- [ ] A Voided Bill accepts no Lines, Payments or further corrections.
- [ ] Flows §8.4 and §8.5 pass.
