# 14 — Mi día

Status: resolved
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

## Comments

- 2026-10-06: Implemented on `ticket/14-mi-dia`, merged into `gamo-cafe-v1` at `e3a7c90` (follow-up `40d477c` restored the time-helper tests the new file had replaced). The shared reads for ticket 15 live in `app/backend/day.ts`: `figuresForRange({from, to})` is Admin-only and gives the total plus per-User figures; `myDay()` takes no arguments — the User comes from the session and the Day from `today`, so a Worker cannot ask for anyone else's records. Decisions: removed Lines/Payments and Voided Bills leave both the figures and the lists; a Void drops a record from the Day it was recorded, not the Bill's; ranges are inclusive.
- Ticket 15: add the Items-sold query beside these, with the same `state <> 'voided'` and removal exclusions, driven by `lines_by_day`.
