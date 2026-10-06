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
