# 29 — Page the growing lists by cursor, with Cargar más

Status: resolved
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

- [x] No list in the app renders more than one page of rows on a first load, whatever the database holds.
- [x] Cargar más appends the next page, announces loading, and stops when nothing follows; it works from the keyboard and with a screen reader.
- [x] A row added or removed between two pages neither repeats nor skips a row.
- [x] Searching Cuentas abiertas by Customer finds a Bill that is not on the first page.
- [x] `tests/proof-budget.test.ts` and the lists' own row-budget tests pass.

## Comments

- 2026-10-06: Opened from the research (§3.5) and the decision to page every growing list. Split it by screen if it is too large for one change.
- 2026-10-06: Resolved in one change. See the answer below.

## Answer

Every growing list now shows one page and **Cargar más**; the README's "Paged lists" section is the reference.

- **Cursor.** `~/shared/cursor.ts`: an instant and a tie-breaker, carried in the URL as `?desde=<at>~<id>`. An unreadable cursor is the first page. Historial's `?antes=&id=` and the `?pagina=` of Cuentas and of a Customer's past Bills are gone, with `~/shared/page.ts` and `MAX_BILL_PAGE`.
- **Reads.** `listOpenBills(typed, cursor)`, `listBills(filter, cursor)`, `listCustomerPastBills(id, cursor)`, `listCounts(cursor)` and `listOwed(cursor)` answer `{ ..., next }`; `listHistory` already did. Page sizes: 50 Bills, 50 History entries, 3 Counts (`COUNTS_PER_PAGE`), 50 loose Bills on Por cobrar.
- **Bills tie-break by `rowid`**, as the lists already ordered, so the cursor's id is a rowid for Bills. One Customer's Bills order by `day` first, so their cursor also carries the Day (`rowid:day`) and the keyset is the row value `(day, opened_at, rowid) < (?, ?, ?)`. The first attempt sought by the Day alone and a deep page inside one Day read every row before it; the row-budget test caught it.
- **Cuentas abiertas** reads one arm per Open state instead of every Open Bill. The Customer search joins inside the arm with `CROSS JOIN`, which keeps SQLite walking Open Bills and not the Customer's past ones; a search that matches few Bills still walks the Open Bills to the end, which is bounded by the Open Bills, not by the history.
- **Por cobrar** is two statements: one grouped read of the Open Bills for the figures and the Customers (unpaged, as the ticket says), and the page of loose Bills. Every page, also a later one, carries the whole Owed.
- **Component.** `~/components/paged-list.tsx`: `usePagedList` and `LoadMore`. The control is a link (the ticket's no-JavaScript behaviour), intercepted when JavaScript runs; it loads on scroll with an `IntersectionObserver`; loading and the end are said in a `role="status"` region, and focus moves there when the last page arrives after a tap or Enter.
- **Coming back.** The loaded rows are remembered in memory per history entry (30 lists at most), not in `sessionStorage`: they are about Bills and money (§3.4). A list restored that way is shown at once, which is what lets React Router restore the scroll position, and its pages are fetched again behind it and swapped in. After a full reload a list starts from its first page.

Left as it is, for a later reader to know:

- A revalidation on the same screen (Abonar on a Customer's page) starts that screen's paged list over, then reloads as many pages as it had.
- On a Customer's page the fetcher loads the route's whole loader for each page of past Bills: the Customer, their Open Bills and Abonos are read again. It is bounded, and the page has one loader.
- `tests/proof-budget.test.ts` passes unchanged; its caps were not tightened.
