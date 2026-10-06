# 14 — Mi día

Status: ready-for-agent
Blocked by: 11
Spec: [`../spec.md`](../spec.md) §5.9, §6.1 (Mi día), §4.1, §4.2, §7.4, §10.6

## What to build

**Mi día**, for every User: what this User sold and collected today, in cash and by transfer, with their Lines and Payments.

- Sold is attributed to the author of each Line; Collected to the receiver of each Payment. Removed Lines and Payments and Voided Bills are excluded from the figures.
- Read by author and Day, index-driven. Put the Sold / Collected queries where ticket 15 can reuse them for all Users and date ranges.
- This is the only place a Worker sees Bills that are Paid or Voided, and only through their own records.

## Acceptance criteria

- [ ] A Worker's Mi día shows only that Worker's records, with no way to request another User's.
- [ ] Figures match §5.9, including across midnight `America/Mexico_City` (test clock).
- [ ] A removed Line, a removed Payment and a Voided Bill each drop out of the figures.
