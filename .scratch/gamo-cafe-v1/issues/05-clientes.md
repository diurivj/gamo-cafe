# 05 — Clientes: search, add and manage Customers

Status: resolved
Blocked by: 02
Spec: [`../spec.md`](../spec.md) §5.2, §6.1 (Clientes), §7.2, §7.4, §4.1

## What to build

On **Clientes**, any User searches Customers as they type and adds a new one; a Customer has a page. Admins rename, retire and restore.

- Record: `customers` with a normalized name (case and accents ignored), note, retired at, added by, added at. Search is by normalized-name prefix, index-driven.
- A name equal to an active Customer's name, ignoring case and accents, is refused.
- A reusable Customer picker (search as you type, matches first, "add new") for the Sell screen and the Bill screen in later tickets.
- The Customer page's Open Bills, owed amount, Abonar and past Bills arrive in tickets 09 and 16.

## Acceptance criteria

- [ ] A Worker can add a Customer; the record carries who added it and when.
- [ ] A duplicate active name (case or accent variant) is refused with a Spanish message.
- [ ] Search returns prefix matches on the normalized name, excluding retired Customers from the picker.
- [ ] Only an Admin can rename, retire or restore (server-enforced).

## Comments

- 2026-10-06: Implemented on `ticket/05-clientes`, merged into `gamo-cafe-v1` at `6e4cad3`. The `CustomerPicker` is not mounted on any screen yet, so no committed Playwright test covers it; a spec to adapt is at `/Users/diurivj/coding/gamo-cafe-notes/05-picker-spec.ts.txt`. Nothing checks yet that a Customer chosen for a Bill is active: tickets 06 and 10 must enforce it in their operations. `normalizeName` strips all combining marks, so `ñ` compares as `n`.
