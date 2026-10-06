# 18 — Historial (Admin)

Status: resolved
Blocked by: 10, 11, 12
Spec: [`../spec.md`](../spec.md) §5.7, §6.2 (Historial), §7.4, §10.4, §2.4, §4.2

## What to build

**Historial** (Admin only): removed Lines, removed Payments, Voided Bills, changes to a Bill's Customer or note, Adjustments and cancelled Adjustments, newest first, with who, when and why, 50 per page.

- History by time, paged, index-driven across the fact tables; a page must not read rows in proportion to total history. Pick the approach (keyset over a union of indexed tables, or equivalent) that satisfies §2.4 without adding a record the spec does not list.
- Entries link to the Bill or Item concerned.

## Acceptance criteria

- [ ] After each kind of correction and Adjustment, History shows it with its author, time and reason, and the original record still exists.
- [ ] Entries from different tables interleave in correct time order across page boundaries.
- [ ] A page issues a bounded number of statements and reads a bounded number of rows regardless of history size.
- [ ] Workers are refused.

## Comments

- 2026-10-06: Implemented on `ticket/18-historial`, merged into `gamo-cafe-v1` at `9c4fe66`. Approach: a keyset over the six fact tables — one statement per table, `LIMIT 51`, on each table's `_by_time` index; the cursor is the page's last `(at, id)`, and the keyset `WHERE` carries a leading `column <= ?` range so SQLite seeks into the index (measured: pages stay bounded at page 12). 6 statements per page; `tests/history-paging.test.ts` proves the bounds and the interleaving. `migrations/0018_historial.sql` adds the missing `adjustment_cancellations_by_time` index (a ticket 12 gap, the only schema addition). Decisions: Customer-edit entries show the Customer's name; an unreadable cursor falls back to page one; Counts stay out of History per §5.7. Notes at `/Users/diurivj/coding/gamo-cafe-notes/18-notes.md`.
- Ticket 20: the e2e hit a real UI race — Cuenta's forms remount on loader revalidation and can wipe a freshly typed reason; the test waits for loader-driven text, the screens should be looked at in the phone-UI pass.
