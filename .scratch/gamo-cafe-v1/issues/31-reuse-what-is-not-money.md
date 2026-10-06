# 31 — Do not fetch again what a sale cannot change

Status: ready-for-agent
Blocked by: 27
Spec: [`../spec.md`](../spec.md) §3.4

## What to build

After every recorded form React Router runs every loader on the page again, and a navigation asks for the shell's loader again. Most of that cannot have changed.

- The shell's loader (the User's name and role, the navigation) runs again only when the User changes: after signing in or out, and after an Admin changes that User.
- Vender's catalog (the active Items by Category) is not fetched again after recording a sale. It is fetched again when Vender is opened, and after anything on Productos changes.
- Use `shouldRevalidate` on those routes. Do not add a cache in the Worker, a service worker or cache headers: Bills, Payments and Stock stay `no-store` and are always read fresh.
- Measure before and after: the number of loaders run and D1 statements issued for "record a sale on Vender, then record another".

## Acceptance criteria

- [ ] Recording a sale on Vender runs no catalog read and no shell loader, shown by a test that counts D1 statements.
- [ ] An Item added, repriced or retired on Productos is right on Vender the next time it is opened.
- [ ] A User whose role an Admin changed sees the right navigation on their next navigation.
- [ ] Every response about Bills, Payments or Stock still carries `Cache-Control: no-store`.

## Comments

- 2026-10-06: Opened from the decision to cache what can safely be cached.
