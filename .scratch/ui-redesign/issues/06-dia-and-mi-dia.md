# 06: Understand Día and Mi día

**What to build:** An Admin quickly understands the cafeteria's Day or selected date range, while a Worker independently understands only their own Day. Redesign both summaries and their supporting detail so money received is never confused with consumption recorded or current debt.

**Blocked by:** 01 — Sign in and navigate the redesigned app.

**Status:** resolved

**Spec:** [UI redesign](../spec.md) §§1, 4, 7–10.

- [x] First, in a commit of its own: make Día one read of the Day module, as decided on 2026-10-07 (see Comments). The screen work below builds on it.
- [x] Día defaults to today with an explicit displayed date. Preserve single-Day/range selection and clear handling of invalid ranges without showing stale figures as belonging to a new range.
- [x] Lead with Cobrado and its Efectivo/Transferencia split, followed by Vendido. Explain the distinction briefly where useful; neither is an ambiguous total or a cash-drawer balance.
- [x] Preserve readable per-User attribution and Items sold with quantities/value without overwhelming the initial summary. Use progressive disclosure only where details remain discoverable.
- [x] Mi día clearly says these are the signed-in User's figures and records for today, showing their own Lines and Payments and no other User's totals.
- [x] Por cobrar remains current outstanding debt, not Vendido minus Cobrado for the selected Day. A contextual link may reach the existing debt screen; redesigning that screen is not a prerequisite here.
- [x] Money received today for older consumption contributes to today's Cobrado, not today's Vendido. Preserve local-Day semantics and the effect of corrections on original Days.
- [x] Empty, pending and failed reads are clear; no stale cached money is presented as fresh. Preserve authoritative loading, efficient reads and role checks.
- [x] Browser/domain tests verify both roles, date filters, older debt paid today, per-User attribution and permission boundaries. Cover long names, large values, stacked narrow-screen details, 200% text, keyboard use and accessible headings/statuses.
- [x] Run focused tests and project verification. Do not introduce charts, closing procedures or new reporting semantics.

## Comments

### 2026-10-07 — Día becomes one read (architecture review, agreed with the maintainer)

Mi día is one read (`myDay`). Día was two reads plus its range rule, assembled in the loader of `app/routes/dia.tsx`, where no test can move the clock. Before the screen work:

- `app/backend/day.ts` gains `everyonesDay(asked)`, beside `myDay()`. It takes the raw `desde` and `hasta` text of the URL, either of which may be missing, and answers the range it understood with its figures, each User's figures and the Items sold. Admin only.
- Both missing means today. One end alone means that single Day, not a range up to today.
- Text that is present but is not a real Day is refused; it no longer falls back to today. A range that ends before it starts is refused. These are two typed errors, one per rule, the first saying which field; the route answers each through `run`'s error map with its own Spanish message.
- A refused range answers 400. Each field shows what was asked when it is a readable Day and is empty otherwise; the message is a `Notice`; no date caption and no figures are shown.
- Reading a Day from text goes in `app/shared/day.ts`, beside `formatDay`, and rejects rolled-over dates such as `2026-02-31`. Cuentas keeps its own parser until ticket 07.
- `figuresForRange` and `itemsSoldForRange` stop being exported. Inicio does not pay for the Items-sold statement.
- `homeSummary` answers with the Day its figures are about; `app/routes/inicio.tsx` stops calling `today`. The Day shown is the Day the figures were read for.
- Tests are replaced, not layered. Operation tests with the test clock carry every rule: the default, one end alone, unreadable text, an inverted range, the three-statement read budget measured on `everyonesDay` itself, and a new one for older debt paid today (today's Collected, not today's Sold). The `figuresForRange` tests in `tests/dia.test.ts` and the two in `tests/mi-dia.test.ts` are rewritten against `everyonesDay`. `tests/dia-routes.test.ts` shrinks to three: a Worker is refused, an Admin gets a page, a refused range answers 400 with its message.

Done on 2026-10-07. One thing differs from what was agreed: instead of `myFigures` plus a separate read of today's totals, `app/backend/day.ts` exports one `todaysFigures`, which reads the Day once and answers `{ day, mine, everyone }` (`everyone` is `null` for a Worker and is not read for one). Two reads would each have read the clock, and the Day shown on Inicio could then differ from the Day of a figure at midnight. The screen itself is untouched apart from the loader, the `Notice` and where the date caption sits.

## Answer

Día and Mi día are shadcn screens built on one panel of figures. The README's "The Day's figures" is the guidance.

- **`FiguresPanel`** (`app/components/figures.tsx`) says Cobrado first, Efectivo and Transferencia under it, then Vendido, each with one line of explanation ("El dinero que se recibió.", "Lo que se consumió, pagado o no."). Nothing is added up and nothing is called a total. Día's summary, each User's entry on Día (`compact`) and Mi día use it.
- **Día** keeps its two date fields and **Ver**. The date over the figures is a heading in words and comes from what `everyonesDay` read, never from the fields. While another range is on its way the figures stay under their own date, dimmed and `aria-busy`, with "Leyendo las fechas que pediste…". A refused range shows its reason and no date or figure.
- **Por usuario** and **Productos vendidos** are closed `<details>`, each under a heading with how many it holds and a chevron. They are in the page, so the browser's search finds them.
- **Por cobrar** is a card that links to its screen: "Lo que se debe hoy, de cualquier fecha." Día shows no amount of it, as spec §7.1 allows, so there is no date-scoped debt to misread.
- **Mi día** says "Solo lo que registró **{name}** hoy, {date}." Then Resumen (the panel), **Pagos que recibiste** and **Productos que vendiste**. The two lists no longer carry the names of the totals. Item names wrap and are not truncated.
- Long names and large amounts wrap anywhere they must. A browser test on a 320px phone with text twice as large found four places that were cut ("Transferencia", a twelve-million amount, a payment row, a line's hint) and they are fixed.

Results, 2026-10-07: `npm run verify` — 72 files, 773 tests passed. `npm run test:e2e` — 302 passed (Android and iPhone shapes). New: `e2e/support/figures.ts` (`expectFigures`), `e2e/support/layout.ts` (`cutOff`). Rewritten: `e2e/dia.spec.ts` (6 tests), `e2e/mi-dia.spec.ts` (5 tests), `tests/dia.test.ts`, `tests/dia-routes.test.ts`.

Left open:

- Inicio's Cobrado card still writes its own Efectivo and Transferencia lines and does not use `FiguresPanel`. It was redesigned in ticket 01 and its card is a link with a different shape; nothing here changed it beyond where its Day comes from.
- The Owed total is summed in two places with different predicates: `app/backend/owed.ts` (`total > paid`, Admin only) and `app/backend/home.ts` (no such clause, shown to every User on Inicio). Día shows neither, so it is not visible from here; ticket 07 redesigns Por cobrar and should settle it.
- The "counts toward something" rule (Bill not Voided, no removal) is still written out in seven statements of `app/backend/day.ts`. It was the review's candidate 4 and was not taken.
- A date field is remounted when the range that was read changes, so it always shows what the figures are about; a date typed while an earlier read is still landing is replaced by that read's date.
- The older-debt browser test moves `bills.day` and `lines.day` back with `query`, because the Worker's clock cannot be moved. The rule itself is tested on the operation with the test clock.
- One run of `e2e/mi-dia.spec.ts` under `--repeat-each` with seven workers failed once on Android in "a Worker sees only what they collected and sold today"; forty further repeats of that test passed and the cause was not found.
- No automated accessibility scan, screen reader or real device: headings, names, keyboard, 320px and 200% text are asserted by hand here; the rest is ticket 12's.
- Mi día's pending read is the shell's "Cargando…" only; it has no parameters to change.
