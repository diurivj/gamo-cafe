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
