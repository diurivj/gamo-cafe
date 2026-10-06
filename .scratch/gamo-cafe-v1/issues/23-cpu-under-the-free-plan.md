# 23 — Bring every screen's CPU under the Workers Free median

Status: wontfix
Blocked by: 22
Spec: [`../spec.md`](../spec.md) §10.7, §2.4, §3.2 (exit rule)

## What to build

Ticket 22's proof ran on a disposable Workers Free / D1 Free deployment; the D1 budgets passed, but the CPU bullet did not. Cloudflare-reported medians over the nine §10.7 requests (four passes: 21, 50, 21 and 100 runs each; the 100-run pass is the most stable):

| Request | 100 runs | Worst pass | Verdict |
| --- | --- | --- | --- |
| Vender (the Sell screen) | 6.47 ms | 11.59 ms | warm passes, fresh fails |
| Record a ten-Item selection with Payment | 10.35 ms | 14.43 ms | at/over |
| Cuentas abiertas with 200 Open Bills | 17.67 ms | 20.40 ms | fails |
| Pay a Customer with 30 Open Bills | 9.64 ms | 11.05 ms | at/over |
| Día for the busiest Day | 6.21 ms | 9.96 ms | passes |
| A page of Cuentas | 7.60 ms | 10.73 ms | warm passes, fresh fails |
| Inventario | 9.40 ms | 11.47 ms | borderline |
| A Count of every Item | 4.96 ms | 5.97 ms | passes |
| A page of Historial | 10.56 ms | 14.92 ms | at/over |

The criterion is a Cloudflare-reported median under 10 ms over at least 20 runs of each request. The cost tracks server rendering: the Effect floor is low (`/healthz`, Effect runtime + `Db` + one D1 read: 4 ms; the Count's Effect batch of writes: 5 ms), while the failing screens render long lists — Cuentas abiertas renders all 200 Open Bills, the Customer page renders 30 Bills plus the handovers, Historial renders 50 entries, the recorded-selection response re-renders Vender. **Effect is not the apparent cause, so §3.2's exit rule is not invoked** — profile before considering it.

Work:

- Profile and fix the two clear failures first: **Cuentas abiertas** (page it, e.g. 50 per page on `bills_by_state`, as §2.4's "long lists are paged" and "server rendering stays small" ask; keep the Customer search working across pages or bound it), and **the ten-Item selection's response** (it re-renders the whole Vender grid; a redirect after recording may be the right answer, updating the runner's expected status).
- Then the at/over and borderline ones: **Abonar**'s Customer page (30 Open Bills + handovers), **Historial** (50 entries), and the fresh-deployment cases of Vender, Cuentas and Inventario (JIT warm-up accounts for part of the gap; the gate runs on a fresh deployment, so it counts).
- Measure with `npm run proof` against a disposable deployment, per the README runbook (reusable; create a fresh D1, point `env.production` at it, seed, run, tear down). Use at least 50 runs per request — 21-run medians jitter by several ms. Read the figures with the `workersInvocationsAdaptive.cpuTimeP50` per request window, as ticket 22 did.
- Keep the local budgets green (`npm run verify`, `tests/proof-budget.test.ts`), and do not weaken the D1 statement or rows-read rules while slimming the render.

## Acceptance criteria

- [ ] A disposable proof shows every one of the nine §10.7 requests with a Cloudflare-reported CPU median under 10 ms over at least 20 runs of each.
- [ ] The new figures are recorded in this file under `## Answer`, with the passes they came from.
- [ ] `npm run verify` and the full Playwright suite pass, and the D1 budgets still hold.
- [ ] If after profiling a screen still cannot fit, the measurement showing Effect as the cause is recorded and §3.2's exit rule is applied.

## Comments

- 2026-10-06: Opened from ticket 22's proof figures.
- 2026-10-06: Superseded by ADR 0007. The app moves to Workers Paid, where there is no 10 ms limit to fit, and the remote proof is dropped as a release gate. No code was changed for this ticket. What its profiling found is in [`../research/free-plan-stack-review.md`](../research/free-plan-stack-review.md), and the fixes worth making on any plan are tickets 26 to 31.
