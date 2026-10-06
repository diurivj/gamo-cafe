# 01 — Scaffold the app and the Effect backend skeleton

Status: resolved
Blocked by: none
Spec: [`../spec.md`](../spec.md) §3.1, §3.2, §3.3, §3.4, §3.6, §7.1

## What to build

An empty but deployable Gamo Cafe: a signed-out visitor can load a Spanish page served by the Worker, and a health route proves the Worker can query D1 through the `Db` service. Every later ticket copies the patterns set here, so this ticket's code is the reference for "how an operation, a route and a test are written".

- React Router v8 Framework Mode on Cloudflare Workers (`@react-router/cloudflare`, `@cloudflare/vite-plugin`), TypeScript, npm, Tailwind 4. Mirror the layout, scripts and configuration of `~/coding/mdwn` (read-only reference; never copy its ids or secrets; no Drizzle, no CI, no preview environment).
- `wrangler.jsonc` with a `DB` D1 binding for local and for production (placeholder production database id), and a `migrations/` directory of hand-written `.sql` files applied with Wrangler.
- Effect 4.0.x, stable exports only (ADR 0006). Services: `Db` (first row, all rows, run, batch; returns Effects; typed error), `CurrentUser`, and Effect's `Clock` as the only source of "now". One runtime per isolate built from the D1 binding, and one helper that loaders and actions use to run a program and map typed errors to a response.
- Shared helpers: opaque id generation, money as integer centavos with `es-MX` formatting and parsing of typed peso amounts, instants as epoch milliseconds, and `Day` (`YYYY-MM-DD` in `America/Mexico_City`) computed from the `Clock`.
- App shell: Spanish `lang`, phone-first layout, web app manifest and icons, no service worker.
- Test harness: Vitest with the Cloudflare Workers pool running against a real local D1 with migrations applied, a test clock helper, and Playwright wired with one smoke test.
- npm scripts: `dev`, `build`, `typecheck`, `test`, `test:e2e`, `verify` (typecheck + tests), `db:migrate`, `db:migrate:production`, `deploy:production`.

## Conventions this ticket establishes

- A migration file is named after the ticket that adds it: `NNNN_<slug>.sql` where `NNNN` is the zero-padded ticket number (a ticket needing more than one uses a letter suffix). This keeps parallel tickets from colliding.
- Facts are insert-only; projections are written only in the same batch as the fact that changes them (§7.1).
- Rows read from D1 are decoded with Effect `Schema`.

## Acceptance criteria

- [ ] `npm run verify` passes from a clean clone after `npm install`.
- [ ] A Workers-pool test runs an Effect program that requires `Db` and reads from local D1.
- [ ] A test shows `Day` changing at midnight `America/Mexico_City`, driven by a test clock.
- [ ] Money helpers round-trip centavos to `es-MX` text with no floating-point arithmetic.
- [ ] No import from an Effect module or export tagged unstable.
- [ ] `npm run build` produces a Worker bundle; the Playwright smoke test loads the shell.

## Comments

- 2026-10-06: Implemented on `ticket/01-scaffold`, merged into `gamo-cafe-v1` at `63a88be`. Production scripts not executed (no account); production D1 id is a placeholder.
