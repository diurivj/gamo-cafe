# 29 — Page the growing lists by cursor, with Cargar más

Status: ready-for-agent
Blocked by: —
Spec: [`../spec.md`](../spec.md) §2.4, §3.4, §6.1, §6.2, §7.4

## What to build

One way to page, used by every list that grows with time.

- A shared component for a paged list: the first page comes from the loader, a **Cargar más** control fetches the next page with a fetcher and appends it, and the control loads by itself when it scrolls into view. Without JavaScript it is a link to the next page. Coming back to the list restores what was loaded and the scroll position.
- A cursor over the list's order (as `listHistory` does) instead of an offset, wherever the order allows it. `listBills` pages by offset with a page cap today; move it to a cursor and drop the cap.
- Use it on: **Cuentas abiertas** (50 per page on `bills_by_state`; the Customer search applies across pages), **Cuentas**, a Customer's past Bills, **Historial**, **Diferencias** (by Count, a few Counts per page; it renders 720 rows for the seeded year) and the Open Bills with no Customer on **Por cobrar**.
- Leave unpaged what the catalog bounds: the Items on Vender, Inventario and Conteo, and the Customers' totals on Por cobrar.
- Row budgets: each page reads rows in proportion to the page, tested with the counting D1 as `tests/cuentas.test.ts` does.

## Acceptance criteria

- [ ] No list in the app renders more than one page of rows on a first load, whatever the database holds.
- [ ] Cargar más appends the next page, announces loading, and stops when nothing follows; it works from the keyboard and with a screen reader.
- [ ] A row added or removed between two pages neither repeats nor skips a row.
- [ ] Searching Cuentas abiertas by Customer finds a Bill that is not on the first page.
- [ ] `tests/proof-budget.test.ts` and the lists' own row-budget tests pass.

## Comments

- 2026-10-06: Opened from the research (§3.5) and the decision to page every growing list. Split it by screen if it is too large for one change.
