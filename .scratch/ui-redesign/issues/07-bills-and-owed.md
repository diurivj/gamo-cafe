# 07: Review all Bills and outstanding debts

**What to build:** An Admin finds Bills across their states and understands current outstanding debts through redesigned Cuentas and Por cobrar. Preserve the difference between historical Bill filtering and debt that is still owed now. These screens can link to existing Bill/Customer details while those redesigns proceed independently.

**Blocked by:** 01 — Sign in and navigate the redesigned app.

**Status:** resolved

**Spec:** [UI redesign](../spec.md) §§4, 7–10.

- [x] Cuentas clearly identifies itself as the Admin all-Bills screen, distinct from Cuentas abiertas. Preserve date/state/Customer filters and readable state, identity, date and amount information.
- [x] Paid, Open, Partially paid and Voided states have understandable text, not color-only indicators. Detail links preserve existing permissions and meaningful return navigation.
- [x] Por cobrar shows current overall Owed and each Customer's Owed and oldest Open Day. Never imply the values describe a historical selected Day or equal a report's Vendido minus Cobrado.
- [x] Anonymous Open Bills remain visible, with identifiable notes/dates and explicit warnings for Bills from an earlier Day. Do not require attaching a Customer to preserve or collect them.
- [x] Customer and Bill links lead toward existing collection capabilities without adding new payment operations or requiring a redesign of linked detail screens in this ticket.
- [x] Preserve bounded queries, cursor paging on growing lists, accessible Cargar más, filter/scroll restoration and focus behavior. Searches/filters must retain their existing scope, not operate only on already loaded results.
- [x] Both screens have helpful empty/loading/error states and readable long names/amounts without page-level horizontal scrolling. Apply the shared visual and accessibility standards rather than wrapping the old dense UI in new colors.
- [x] End-to-end tests cover filtered Bills in every state, Customer/anonymous debts and older-Day warnings, pagination and navigation back. Verify Workers cannot access these screens or their data; include keyboard, narrow-screen and enlarged-text checks.
- [x] Run focused tests and project verification; do not fetch all history or change debt calculations to simplify presentation.

## Answer

Cuentas and Por cobrar are shadcn screens built like Cuentas abiertas: one card per row, the state in words, the amount that matters large.

- **Cuentas** (`app/routes/cuentas.tsx`) says under its title "Todas las cuentas, también las pagadas y las canceladas." Its filters are Día, Estado (a new `NativeSelect`) and Cliente, sent with **Filtrar**; **Quitar filtros** appears when one is on. Each field is keyed by the filter that was read, so the fields say what the list is. While other filters are read the list stays, dimmed and `aria-busy`, with "Buscando las cuentas que pediste…". A row shows the Customer or the note, the state badge, the Day, **Debe** only while the Bill is Open, and Total and Pagado.
- **Por cobrar** (`app/routes/owed.tsx`) leads with **Se debe ahora** and "Lo que falta por pagar de las cuentas abiertas, de cualquier fecha." It has no date field and uses none of the words Cobrado, Vendido or total. Then **Clientes** (Debe, the Day of the oldest Open Bill) and **Cuentas sin cliente**, each named by its note or "Sin nota", with its Day and the badge **De un día anterior**. `listOwed` now answers each loose Bill's `note`.
- **The way back**: both lists say so in their links, and Cuenta's and Cliente's way back is named after the list that opened them (**Cuentas**, **Por cobrar**) and goes back in history, which restores the filters, the pages and the place.
- **Cuentas reads its Day with `parseDay`**, as ticket 06 left for this one. A `dia` the calendar does not have is no filter and the field is empty.
- **The two Owed sums** (ticket 06, left open) select the same Bills: `paid <= total` is a table constraint and every operation marks a Bill Paid when `paid >= total`, so no Open Bill has `total = paid` and `total > paid` in `owed.ts` excludes nothing. `tests/owed.test.ts` holds it, with a Bill whose only Line was removed. Neither statement was changed.

Changed outside the two screens:

- `Badge` lets its words break. "De un día anterior" and "Cancelada" were cut on a 320px phone with text twice as large.
- `SubmitButton` takes the focus back when its form is answered and nothing else took it. A disabled button drops the focus, so after **Filtrar** the keyboard was left on nothing; the same was true of Día's **Ver** and every other form.
- `NativeSelect` was added with the shadcn CLI, brought to the field's size, and draws the app's own `UnfoldDrawing`. The preset's icon import pulled the whole icon library into the Worker and timed out 28 test files.

Results, 2026-10-08: `npm run verify` — 72 files, 775 tests passed. `npm run test:e2e` — 318 passed (Android and iPhone shapes). Rewritten: `e2e/cuentas-admin.spec.ts` (7 tests), `e2e/por-cobrar.spec.ts` (6 tests).

Left open:

- An unreadable `dia` on Cuentas is dropped and every Bill is listed; Día refuses the same text with a 400. No spec line decides it for Cuentas.
- Por cobrar's pending read is the shell's "Cargando…" only; it has no parameters to change. A failed read of either screen is the shared error screen inside the navigation; only Cuentas has a browser test of it.
- A Bill's row is written out in Cuentas abiertas, Cuentas, Por cobrar and Cliente, and `LISTS`/`listBehind` in both `bill.tsx` and `customer.tsx`. The review named both as duplication; neither was extracted.
- The browser test could not clear a date field on the iPhone shape with `fill("")`, so it clears the Day with **Quitar filtros**.
- No automated accessibility scan, screen reader or real device: headings, names, keyboard, 320px and 200% text are asserted by hand here; the rest is ticket 12's.
