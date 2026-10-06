# 25 — Retire the remote proof kit and set the production configuration

Status: resolved
Blocked by: —
Spec: [`../spec.md`](../spec.md) §2.4, §3.6, §10.7; ADR 0007

## What to build

The remote proof is no longer a release gate. Keep what proves the request budgets locally and remove what only existed to run against a deployment.

- `wrangler.jsonc`: restore `env.production` to `gamo-cafe` and `gamo-cafe-db` with the id from ticket 24's answer, and add `limits.cpu_ms` as the CPU ceiling per request. Pick the ceiling from a local run of the heaviest request with generous room; it is a guard against a runaway request, not a performance target.
- Remove `scripts/proof.ts`, the `proof` npm script, and the gitignore entries and generated files that belong to it. Keep `app/backend/seed.ts`, `scripts/seed.ts`, `tests/proof-seed.test.ts` and `tests/proof-budget.test.ts`.
- Decide whether `seed:production` stays. It imports a synthetic year into the production database; if nothing needs that any more, remove it.
- Fix `INDEX_ENTRIES` in `app/backend/seed.ts`: `counts` and `count_lines` have 3 index entries each since migration 0013, not 2 (research §4.1).
- README: replace "The free-plan proof" with a short "Request budgets" section that says what the two local tests prove and how to run them. Remove the runbook for the disposable deployment.

## Acceptance criteria

- [x] `npm run verify` passes, with `tests/proof-seed.test.ts` and `tests/proof-budget.test.ts` still in it.
- [x] No script, README section or gitignore entry refers to the remote proof.
- [x] `wrangler.jsonc` names the production Worker and database and sets `limits.cpu_ms`.
- [ ] The seed's rows-written estimate matches what the local D1 reports for the load. (Dropped: the estimate was removed instead, see `## Answer`.)

## Comments

- 2026-10-06: Opened from ADR 0007.
- 2026-10-06: Done ahead of ticket 24 at the developer's request, so the production database id is not in yet.
- 2026-10-06: Ticket 24 created `gamo-cafe-db` and put its id in `wrangler.jsonc`.

## Answer

- Removed `scripts/proof.ts`, the `proof` and `seed:production` npm scripts, the `--production` path of `scripts/seed.ts`, the proof's gitignore entries and its generated result files. Nothing needs the synthetic year in production, so the seed now loads into the local D1 only.
- Kept `app/backend/seed.ts`, `scripts/seed.ts` (`seed`, `seed:local`), `tests/proof-seed.test.ts` and `tests/proof-budget.test.ts`.
- `INDEX_ENTRIES` and the rows-written estimate existed only to check the load against D1 Free's daily limit, so they were removed rather than corrected, with the test that asserted the limit.
- `wrangler.jsonc`: `env.production` is back to `gamo-cafe` and `gamo-cafe-db`, with `limits.cpu_ms` at 1000. The heaviest request measured about 18 ms of CPU on Cloudflare, so the ceiling only stops a runaway. The database id came from ticket 24.
- README: "The free-plan proof" is now "Request budgets".
- `npm run verify` passes: 56 files, 554 tests.
