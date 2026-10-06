# 21 — Free-plan proof kit: synthetic year, statement budgets and the proof runner

Status: ready-for-agent
Blocked by: 19, 20
Spec: [`../spec.md`](../spec.md) §2.4, §10.7, §3.2 (exit rule), §3.6

## What to build

Everything needed for the §10.7 release gate short of touching a real Cloudflare account (that is ticket 22).

- A seed generator producing a year of synthetic records (Users, about 60 Items, Customers, Bills, Lines, Payments, corrections, Adjustments, Counts; 200 Open Bills; a Customer with 30 Open Bills; a clearly busiest Day) as SQL that loads into local D1 or a remote D1, with projections consistent with the facts (verified by ticket 19's command).
- A local budget test against the seeded database for each §10.7 request (Sell screen, recording a ten-Item selection with Payment, Cuentas abiertas with 200 Open Bills, paying a Customer with 30 Open Bills, Día for the busiest Day, a page of Cuentas, Inventario, a Count of every Item, a page of Historial) asserting: at most 50 D1 statements, and rows read (from D1's query `meta`) bounded independently of history size — shown by running at two history sizes.
- A proof runner script that, given a deployed URL and a session, performs at least 20 runs of each request and writes a results file; plus a runbook in the README for creating the disposable deployment, loading the seed, collecting Cloudflare's reported CPU time and D1 rows read/written, simulating a busy Day, and tearing it down.
- Fix any request that fails a budget.

## Acceptance criteria

- [ ] The budget test passes for all nine requests at both history sizes.
- [ ] The seed loads within D1 Free limits and the projections verify.
- [ ] The runner and runbook are complete enough that ticket 22 needs no code changes.

## Comments

- 2026-10-06: Implemented on `ticket/21-proof` (commit `7b65fb9`). `app/backend/seed.ts` builds the year as SQL, and the seed's last statements are the ticket 19 rebuild, so a loaded database is consistent by construction. `npm run seed [-- --local|:production]` writes `seed.sql` (161 statements, 1.9 MB) and loads it: 71,084 rows written as the local binding reports it, under D1 Free's 100,000 a day; `projections:verify` finds no differences after a local load. `tests/proof-budget.test.ts` measures the nine §10.7 requests as real HTTP requests (a counting D1 swapped into the binding) at four months and at a year: 2–27 statements each and the same rows read at both sizes; no request needed a fix. `tests/proof-seed.test.ts` holds the shape, consistency and limit checks. `scripts/proof.ts` runs each request at least 20 times (`--runs`, default 21) or a busy Day with `--busy-day`, and writes `proof-results.json` / `proof-busy-day.json`; it was rehearsed end to end against `npm run dev` over the seeded local D1 (180 requests, none failed). The runbook is the README's "The free-plan proof". Ticket 22 needs no code change: only `wrangler.jsonc`'s `env.production` name and database id. Notes: `21-notes.md`. Caveat: the remote paths (`seed:production`, `deploy:production` and the Cloudflare figures) were not exercised — no account — which is exactly what ticket 22 does.
