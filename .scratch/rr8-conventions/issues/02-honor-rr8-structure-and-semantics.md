# 02: Honor React Router 8's standards and semantics in the codebase structure

**What to build:** The app's files and route modules follow React Router 8 Framework Mode's conventions and the layout `~/coding/mdwn` already uses, so that where a thing lives says whether it runs on the server, in the browser or in both, and a route module is a route and little else. Behaviour does not change: this is structure and naming.

**Blocked by:** 01 — A React Router 8 review gate for this repo. The gate is the checklist this ticket is measured against.

**Status:** needs-triage

**Why needs-triage:** the maintainer raised this as a concern on 2026-10-07 without naming the departures. The list below is what an architecture review of ticket 06's area found on that day; it is a starting point, not the agreed scope. Each item needs a decision — fix, or record as a deliberate exception — before this is ready for an agent.

## Departures found so far

1. **Server-only code is not marked as such.** `app/backend/` is "Effect code. Server only." (README), but only `run.server.ts` carries the `.server` suffix. Route modules import `~/backend/day`, `~/backend/bills` and the rest by plain names, so the client bundle is kept clean only by the framework removing `loader` and `action` and what they alone import, not by its `.server` guard, which fails the build when a server module reaches browser code. mdwn names these `tree.server.ts`, `comments.server.ts`. A constraint on renaming: `command-line.ts`, `rebuild.ts` and `seed.ts` are also run under plain Node by `scripts/`, with their paths listed in `tsconfig.node.json` and `tests/node-imports.test.ts`.
2. **The app is laid out by technical layer, not by feature.** `app/backend/`, `app/shared/`, `app/components/` and `app/routes/` each hold a slice of every feature; Día is spread over `backend/day.ts`, `shared/day.ts`, `routes/dia.tsx` and `routes/mi-dia.tsx`. mdwn keeps one directory per feature (`app/tree/tree.server.ts`, `app/tree/files-page.tsx`) and maps URLs to thin route modules in `app/routes.ts`.
3. **Route modules hold the screens.** `routes/bill.tsx` is 1,138 lines, `routes/customer.tsx` 788, `routes/home.tsx` 757: loader, action, reducers' wiring and every part of the page in one file. mdwn's rule is "keep business logic in feature modules".
4. **Server helpers for routes sit loose at the top of `app/`.** `catalog-forms.server.ts` (which also holds the Admin guard nine screens use), `navigation.server.ts`, `notice.server.ts`, `shell.server.ts`, `session.server.ts`.
5. **Route module names follow no one rule.** `home.tsx` is Vender, `owed.tsx` is Por cobrar and `users.tsx` is Usuarios, beside `dia.tsx`, `cuentas.tsx` and `productos.tsx`. CONTEXT.md says code uses the English terms.
6. **Four recording flows bypass the router's mutation APIs.** Vender, Cuenta's Payment, Cuenta's corrections and Abonar post with the browser's `fetch` through `sendForRecord` (`app/shared/record-request.ts`) and then call `useRevalidator` by hand, instead of a `useFetcher` and automatic revalidation. This one is documented and deliberate (UI redesign §6: a request that fails on its way must not replace the form with an error screen). Decide whether it stays an exception or whether a fetcher can give the same guarantee.
7. **Rules about a loader's input live in the loader.** `routes/dia.tsx` parses, defaults and validates its date range inside the loader; `routes/cuentas.tsx` parses the same kind of text differently. Ticket 06 of the UI redesign moves Día's part behind the Day read; the rest is here.

## To do

- [ ] Triage: for each numbered departure, decide fix or deliberate exception. Record an exception that a future review would otherwise raise again as an ADR.
- [ ] Complete the audit with ticket 01's gate over the whole app, not only Día's area, and add what it finds to the list before work starts.
- [ ] Apply the agreed fixes in steps that each keep `npm run verify` and `npm run test:e2e` green. No URL changes; the route guard and permissions matrix tests keep passing unchanged except for file paths.
- [ ] Update the README's "Layout" and "Writing a route" sections and the agent instructions (`AGENTS.md`, `CLAUDE.md`) with the placement and naming rules that result, in the way mdwn's `AGENTS.md` states its own ("React Router route placement", "File naming").
- [ ] Do this between UI redesign tickets, not during one: every remaining redesign ticket rewrites a route module, and moving files under it at the same time makes both diffs unreadable.
