# 22 — Run the free-plan proof on a disposable deployment

Status: ready-for-human
Blocked by: 21
Spec: [`../spec.md`](../spec.md) §10.7, §3.2 (exit rule), §9 (1–2)

## What to do

Needs a Cloudflare account on Workers Free and D1 Free, which only the developer can create and sign in to.

Follow the runbook from ticket 21: deploy a disposable Worker and D1, load the synthetic year, run the proof runner, and record for each of the nine §10.7 requests the median CPU time reported by Cloudflare over at least 20 runs, the D1 statements per request, and the rows read and written for a simulated busy Day against a fifth of the daily limits.

If Effect is the reason a screen fails the CPU criterion, the exit rule in §3.2 applies and a new ticket is opened.

## Acceptance criteria

- [ ] The figures are recorded in this file under `## Answer`.
- [ ] Every §10.7 bullet holds, or the failing request is ticketed.
- [ ] The disposable deployment is torn down.

## Comments

- 2026-10-06: The kit is ready on `gamo-cafe-v1` at `22c5e69`: the runbook is README's "The free-plan proof", the runner is `npm run proof` (with `--busy-day`), and the seed, its shape checks and the local budgets are green. The only things left are the account, the disposable deployment and the figures, per the runbook and acceptance criteria above; record them under `## Answer` and set `Status: resolved` when done.

## Answer

Run on 2026-10-06 under the developer's personal Cloudflare account (`diurivj@gmail.com`), Worker and D1 Free. Deployment: `gamo-cafe-proof` at `https://gamo-cafe-proof.diurivj.workers.dev`; D1 `gamo-cafe-proof` (id `c6b2e7c2-10b8-4097-9af1-5e4caaeac29d`).

**Seed import** (`npm run seed:production`): 161 statements, **71,084 rows written**, database 3.91 MB — within the 100,000 rows/day and 500 MB Free limits. `npm run projections:verify:production` after the load: no differences.

**CPU medians reported by Cloudflare** (µs from `workersInvocationsAdaptive.cpuTimeP50`, converted to ms; one filter window per request so the median is over that request's runs). The runner's own wall-time medians are 107–265 ms. Four passes, from the first (fresh deployment, 21 runs) to the largest (100 runs):

| §10.7 request | 21 runs (fresh) | 50 runs | 21 runs | 100 runs | criterion < 10 ms |
| --- | --- | --- | --- | --- | --- |
| Vender (the Sell screen) | 11.59 | 6.91 | 8.89 | 6.47 | passes warm |
| Record a ten-Item selection with Payment | 14.43 | 8.84 | 10.31 | 10.35 | **at/over** |
| Cuentas abiertas with 200 Open Bills | 18.57 | 16.41 | 20.40 | 17.67 | **fails, consistently** |
| Pay a Customer with 30 Open Bills | 11.05 | 10.24 | 10.37 | 9.64 | **at/over** |
| Día for the busiest Day | 7.87 | 6.95 | 9.96 | 6.21 | passes |
| A page of Cuentas | 9.46 | 7.53 | 10.73 | 7.60 | passes warm |
| Inventario | 11.47 | 7.93 | 11.06 | 9.40 | borderline |
| A Count of every Item | 5.13 | 4.71 | 5.97 | 4.96 | passes |
| A page of Historial | 10.31 | 9.62 | 14.92 | 10.56 | **at/over** |

**This §10.7 bullet does not hold.** Cuentas abiertas fails every pass by a wide margin (16.4–20.4 ms); the ten-Item selection, Abonar and Historial sit at or over 10 ms in most passes; the rest fluctuate close to the line. The first pass on a fresh deployment is the worst, so some of the gap is JIT warm-up, but the warm 100-run medians still leave four requests at 9.6–17.7 ms. The cost tracks React rendering volume: the Effect-only floor is low (`/healthz`, public, Effect runtime + `Db` + one D1 read: 4 ms; the Count's Effect batch of writes: 5.0 ms), while Cuentas abiertas renders 200 Bills and the Customer page renders 30 Bills plus its handovers. §2.4 already asks for small server rendering and paged long lists. **Effect is not the apparent cause, so §3.2's exit rule does not apply**; ticket 23 covers the fixes. The per-request CPU windows and runner outputs are in the four passes' `proof-results.json` files (run 2 saved at `/tmp/proof-results-run2.json` … run 5 at `/tmp/proof-results-run5.json`; run 1's file was overwritten by run 2).

**D1 statements and rows read per request**: Cloudflare does not report these per request, so they are proven locally by `tests/proof-budget.test.ts` (the same requests through the same code, a counting D1 in the binding): every request is 2–27 statements (bar: 50), and every request reads the same rows at a four-month and at a full-year history (bar: rows proportional to the requested page, not the history).

**Busy Day** (`npm run proof -- --busy-day`, 69 requests, 0 failed, 16.7 s): D1 metrics over the run's window (15:23:53–15:24:11 UTC) show **35,077 rows read and 1,793 rows written** — 3.5% and 9% of the one-fifth marks (1,000,000 and 20,000).

**Remaining acceptance**: the disposable deployment is left up for inspection pending the developer's word; teardown is `npx wrangler delete gamo-cafe-proof --force && npx wrangler d1 delete gamo-cafe-proof --skip-confirmation`, then revert `wrangler.jsonc`.</｜DSML｜ parameter,
