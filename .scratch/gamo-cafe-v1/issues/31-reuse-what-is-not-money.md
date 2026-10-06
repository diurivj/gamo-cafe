# 31 — Do not fetch again what a sale cannot change

Status: resolved
Blocked by: 27
Spec: [`../spec.md`](../spec.md) §3.4

## What to build

After every recorded form React Router runs every loader on the page again, and a navigation asks for the shell's loader again. Most of that cannot have changed.

- The shell's loader (the User's name and role, the navigation) runs again only when the User changes: after signing in or out, and after an Admin changes that User.
- Vender's catalog (the active Items by Category) is not fetched again after recording a sale. It is fetched again when Vender is opened, and after anything on Productos changes.
- Use `shouldRevalidate` on those routes. Do not add a cache in the Worker, a service worker or cache headers: Bills, Payments and Stock stay `no-store` and are always read fresh.
- Measure before and after: the number of loaders run and D1 statements issued for "record a sale on Vender, then record another".

## Acceptance criteria

- [x] Recording a sale on Vender runs no catalog read and no shell loader, shown by a test that counts D1 statements.
- [x] An Item added, repriced or retired on Productos is right on Vender the next time it is opened.
- [x] A User whose role an Admin changed sees the right navigation on their next navigation.
- [x] Every response about Bills, Payments or Stock still carries `Cache-Control: no-store`.

## Comments

- 2026-10-06: Opened from the decision to cache what can safely be cached.
- 2026-10-06: Resolved. See the answer below.

## Answer

Two loaders are now kept by the browser, each with `shouldRevalidate`; every other loader runs as before.

**The measurement.** "Record a sale on Vender (Cobrar, one Item), then record another", as the browser's router sends it: a POST to the action, then one GET for the page's data.

| | Before | After |
| --- | --- | --- |
| Loaders run after each sale | 2: the shell, Vender (Items and flash together) | 1: Vender (the target Bill and the flash) |
| D1 statements of that GET | 2: the session's read, the catalog read | 1: the session's read |
| D1 statements of the POST | 8 | 8, unchanged |
| The two sales together | 4 loaders, 20 statements | 2 loaders, 18 statements |
| Body of that GET, one Item in the catalog | 809 bytes | 446 bytes, and it no longer grows with the catalog |

`tests/reuse.test.ts` sends those requests through the Worker with a counting D1 and holds the GET to one statement and no row written; `e2e/reuse.spec.ts` checks that the browser sends exactly that request (`/_.data?_routes=routes/home`) after each of two sales. `measured(send)` in `tests/support/d1.ts` is the counting helper.

**Vender's Items** moved out of `app/routes/home.tsx` into the loader of a layout around it, `app/routes/sell-items.tsx`; Vender reads them with `useOutletContext<SellItems>()`. They had to move: Vender's own loader takes the flash and reads the target Bill, so it must run after every sale (ticket 27's note). The layout's `shouldRevalidate` answers: after a recorded form, no; after a refused one (400), yes; otherwise React Router's default. So the Items are read when Vender is opened (any navigation to it, the Vender link included) and never by a sale. Productos is another page, so a change there is read the next time Vender is opened.

**The shell** (`app/routes/shell.tsx`) answers `shouldRevalidate` with yes only after a form on Usuarios. Signing in or out leaves the shell and comes back to it, which loads it. For a User whose role an Admin changed from another phone there is `shellMiddleware` in `app/shell.server.ts`, the shell route's middleware: the response that carries the shell's data sets a cookie `gamo_shell` (`<user id>.<role>`, `HttpOnly`), and a GET for a page's data that does not ask for the shell (`_routes` without `routes/shell`) from a phone whose cookie is not the current User and role is answered with `redirectDocument` to that page. The browser then loads the whole page, shell included, and the cookie is set again. It costs no D1 statement: the session middleware has already read the User.

**`no-store`** was already set on every response by `workers/app.ts`; nothing here adds a cache, a header or a service worker. `tests/reuse.test.ts` now requests every screen about Bills, Payments or Stock as a document and as data, a sale's redirect and a refusal, and checks the header on each.

Things a later reader should know:

- Not asked for by the ticket, and added because this ticket would otherwise have removed it: a refused selection reads the Items again. Before, every sale refreshed them, so a phone that stays on Vender all day saw a retired Item go; now only a refusal (the server refuses a retired Item) or opening Vender does.
- A phone that stays on Vender and only records sales does not learn of an Item added or repriced on Productos until Vender is opened again. That is what the ticket asks for. The price charged is the server's, as before; the message after the sale shows it.
- The shell's cookie is one per browser. Two tabs of the same browser share it, so after a role change the first tab to navigate reloads and sets the cookie, and the second keeps its old navigation until it is reloaded. Each Admin route still guards itself, so this is about what is shown, not what is allowed.
- A data request that does not ask for the shell and carries no `gamo_shell` cookie at all is also answered with the reload. A test that sends such a request has to carry the cookie the first page set; `cookies(sent, response)` in `tests/reuse.test.ts` does it.
- Every GET inside the shell from a phone without the right cookie now answers with a `Set-Cookie`. `tests/flash.test.ts` asserted "no `Set-Cookie` at all" on another page; it now asserts that nothing is cleared.
- For tickets 28, 29 and 30: Vender's loader data no longer has `categories`; the component takes them from the outlet context. A new route that takes a flash needs nothing: only the shell and `sell-items` are ever skipped. A list that loads more with a fetcher or `?cursor=` is unaffected by the shell's `shouldRevalidate`, which looks only at the form's action.
