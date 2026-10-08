# 06: Understand Día and Mi día

**What to build:** An Admin quickly understands the cafeteria's Day or selected date range, while a Worker independently understands only their own Day. Redesign both summaries and their supporting detail so money received is never confused with consumption recorded or current debt.

**Blocked by:** 01 — Sign in and navigate the redesigned app.

**Status:** ready-for-agent

**Spec:** [UI redesign](../spec.md) §§1, 4, 7–10.

- [x] First, in a commit of its own: make Día one read of the Day module, as decided on 2026-10-07 (see Comments). The screen work below builds on it.
- [ ] Día defaults to today with an explicit displayed date. Preserve single-Day/range selection and clear handling of invalid ranges without showing stale figures as belonging to a new range.
- [ ] Lead with Cobrado and its Efectivo/Transferencia split, followed by Vendido. Explain the distinction briefly where useful; neither is an ambiguous total or a cash-drawer balance.
- [ ] Preserve readable per-User attribution and Items sold with quantities/value without overwhelming the initial summary. Use progressive disclosure only where details remain discoverable.
- [ ] Mi día clearly says these are the signed-in User's figures and records for today, showing their own Lines and Payments and no other User's totals.
- [ ] Por cobrar remains current outstanding debt, not Vendido minus Cobrado for the selected Day. A contextual link may reach the existing debt screen; redesigning that screen is not a prerequisite here.
- [ ] Money received today for older consumption contributes to today's Cobrado, not today's Vendido. Preserve local-Day semantics and the effect of corrections on original Days.
- [ ] Empty, pending and failed reads are clear; no stale cached money is presented as fresh. Preserve authoritative loading, efficient reads and role checks.
- [ ] Browser/domain tests verify both roles, date filters, older debt paid today, per-User attribution and permission boundaries. Cover long names, large values, stacked narrow-screen details, 200% text, keyboard use and accessible headings/statuses.
- [ ] Run focused tests and project verification. Do not introduce charts, closing procedures or new reporting semantics.

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
