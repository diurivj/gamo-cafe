# 20 — Permissions matrix sweep, and phone UI polish

Status: ready-for-agent
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
