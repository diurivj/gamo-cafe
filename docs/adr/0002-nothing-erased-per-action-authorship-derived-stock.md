# Nothing is erased, every action has its own author, and Stock is derived

The app exists for loss control, so its records have to answer "who handed over the Item?" and "who took the money?" even after mistakes are corrected. Removing a Line or a Payment, voiding a Bill, an Adjustment and a Count are therefore recorded as new facts with their author and reason, never as edits or deletions, and a Bill has no owner because each Line and each Payment carries its own author. For the same reason Stock is never a number a person edits: it changes only as a consequence of Lines, Adjustments and Counts, and it can be rebuilt from them.

## Consequences

- There is no "assigned to" on a Bill. Sold is attributed to the authors of Lines and Collected to the authors of Payments.
- Items, Customers and Users are retired, never deleted, so old records stay readable.
- Stock and each Bill's totals are kept as projections, written in the same batch as the fact that changes them. D1 Free limits the rows read per day, so working the answer out from the whole history on every request would not fit. A maintenance command rebuilds and verifies the projections from the facts.
