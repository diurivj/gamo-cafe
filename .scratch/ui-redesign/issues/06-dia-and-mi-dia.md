# 06: Understand Día and Mi día

**What to build:** An Admin quickly understands the cafeteria's Day or selected date range, while a Worker independently understands only their own Day. Redesign both summaries and their supporting detail so money received is never confused with consumption recorded or current debt.

**Blocked by:** 01 — Sign in and navigate the redesigned app.

**Status:** ready-for-agent

**Spec:** [UI redesign](../spec.md) §§1, 4, 7–10.

- [ ] Día defaults to today with an explicit displayed date. Preserve single-Day/range selection and clear handling of invalid ranges without showing stale figures as belonging to a new range.
- [ ] Lead with Cobrado and its Efectivo/Transferencia split, followed by Vendido. Explain the distinction briefly where useful; neither is an ambiguous total or a cash-drawer balance.
- [ ] Preserve readable per-User attribution and Items sold with quantities/value without overwhelming the initial summary. Use progressive disclosure only where details remain discoverable.
- [ ] Mi día clearly says these are the signed-in User's figures and records for today, showing their own Lines and Payments and no other User's totals.
- [ ] Por cobrar remains current outstanding debt, not Vendido minus Cobrado for the selected Day. A contextual link may reach the existing debt screen; redesigning that screen is not a prerequisite here.
- [ ] Money received today for older consumption contributes to today's Cobrado, not today's Vendido. Preserve local-Day semantics and the effect of corrections on original Days.
- [ ] Empty, pending and failed reads are clear; no stale cached money is presented as fresh. Preserve authoritative loading, efficient reads and role checks.
- [ ] Browser/domain tests verify both roles, date filters, older debt paid today, per-User attribution and permission boundaries. Cover long names, large values, stacked narrow-screen details, 200% text, keyboard use and accessible headings/statuses.
- [ ] Run focused tests and project verification. Do not introduce charts, closing procedures or new reporting semantics.
