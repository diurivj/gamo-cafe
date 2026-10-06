# 18 — Historial (Admin)

Status: ready-for-agent
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
