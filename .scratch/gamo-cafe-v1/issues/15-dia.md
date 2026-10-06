# 15 — Día (Admin)

Status: resolved
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

## Comments

- 2026-10-06: Implemented on `ticket/15-dia` at `3cc7436`. No migration was needed. `app/backend/day.ts` gains `itemsSoldForRange` beside `figuresForRange`, with the same `state <> 'voided'` and removal exclusions: one statement over `lines_by_day`, grouped by Item, most valuable first; the route composes both reads, so the screen is three statements. Decisions: the range defaults to today at both ends and travels as `desde`/`hasta` in a GET form; an empty or unreadable date falls back to today, and only `hasta < desde` is refused, with a Spanish message on the page and no figures; the per-User section lists just the Users with a record in the range; an Item's row shows `Cantidad: n` and its value. `tests/dia.test.ts` proves §5.9 across midnight and per User with the test clock, a Line added today to a Bill opened yesterday, removed Lines/Payments and Voided Bills dropping out of the Day they were recorded on, and the bounded-reads budget (three statements; a Day's read does not grow when 300 Lines and Payments, 40 Line removals and 20 Payment removals sit outside it, while a range covering them reads them). `tests/dia-routes.test.ts` covers the Worker's 403, today's default, ranges, the refused range and the unreadable-date fallback; `e2e/dia.spec.ts` covers the Admin screen and the Worker's refusal in both phone projects.
- Merged into `gamo-cafe-v1` at `3cc7436`.
