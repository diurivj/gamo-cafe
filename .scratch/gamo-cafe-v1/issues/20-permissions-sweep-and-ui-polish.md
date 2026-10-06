# 20 — Permissions matrix sweep, and phone UI polish

Status: resolved
Blocked by: 03, 09, 13, 15, 16, 17, 18
Spec: [`../spec.md`](../spec.md) §3.4, §4, §10.1, §10.6

## What to build

- One table-driven test that walks every route module's loader and action and asserts (a) nothing but sign-in responds without a valid session, and (b) every cell of the §4.1 matrix as Worker and as Admin. It must fail when a new route is added without being classified.
- A check of §4.2: no Worker response carries Stock numbers, another User's totals, Paid or Voided Bills outside their own activity, or History.
- UI pass over every screen on a phone viewport: Spanish everywhere, `es-MX` money and dates, large tap targets, no horizontal scrolling, nothing that depends on hover, pending and optimistic UI so every tap is acknowledged at once, navigation that shows Admin sections only to Admins, usable on a laptop.
- Every typed error an action can receive maps to a Spanish message or a redirect; no raw error reaches the screen.

## Acceptance criteria

- [ ] The matrix test covers every route and every §4.1 row and passes.
- [ ] Playwright runs flows §8.1–§8.8 on a phone viewport with no horizontal overflow.
- [ ] No English text is visible on any screen.

## Comments

- 2026-10-06: Implemented on `ticket/20-sweep`, merged into `gamo-cafe-v1` at `4f1c9fb`. `tests/permissions-matrix.test.ts` classifies every route from the router manifest (signed-out behaviour, Worker and Admin GET/POST statuses) and fails when a route is added without an entry — verified red by deleting one; 18 rows walk the §4.1 capabilities with real requests and side effects. `tests/worker-visibility.test.ts` checks §4.2 for every page a Worker may open. UI: a Spanish 403 page (status kept), Cuenta's forms no longer remount on revalidation (a typed reason survives; regression test), larger tap targets, a `Cargando…` pending line, laptop smoke plus overflow assertions; `tests/ui-spanish.test.ts` renders every screen and checks Spanish and `es-MX`. Notes at `/Users/diurivj/coding/gamo-cafe-notes/20-notes.md`. Known gap: `POST /healthz` answers the framework's English JSON 405; it is not a screen.
- Ticket 21 reuses the budget-test conventions here (a counting D1 wrapper) for the seeded §10.7 budgets.
