# 15 — Día (Admin)

Status: ready-for-agent
Blocked by: 14
Spec: [`../spec.md`](../spec.md) §5.9, §6.2 (Día), §7.4, §10.6, §2.4

## What to build

**Día** (Admin only): for a date or a from–to range, Sold, Collected in cash and by transfer, the same per User, and Items sold with quantities and value. Defaults to today.

- Lines and Payments belong to the Day they were recorded, whatever the Day of their Bill; corrections change the figures of that original Day.
- Aggregated in SQL, driven by the by-Day indexes; rows read are proportional to the range requested, never to total history.

## Acceptance criteria

- [ ] Sold and Collected for a Day match §5.9 exactly, including across midnight (test clock) and for a Line added today to a Bill opened yesterday.
- [ ] Per-User figures attribute Sold to Line authors and Collected to Payment receivers.
- [ ] Removed Lines, removed Payments and Voided Bills count toward nothing.
- [ ] Items sold shows quantity and value per Item.
- [ ] Workers are refused.
