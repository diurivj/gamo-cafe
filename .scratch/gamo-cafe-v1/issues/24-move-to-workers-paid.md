# 24 — Move the account to Workers Paid and take the proof deployment down

Status: resolved
Blocked by: —
Spec: [`../spec.md`](../spec.md) §2.4, §3.6, §9 (1); ADR 0007

## What to do

Only the developer can change the plan and the billing of their Cloudflare account.

- Upgrade the account to Workers Paid in the Cloudflare dashboard. This also lifts the D1 daily limits for every database in the account.
- Set a budget alert on the account (Billing → Budget alerts). The plan has no spending cap.
- Tear down ticket 22's disposable deployment: `npx wrangler delete gamo-cafe-proof --force`, then `npx wrangler d1 delete gamo-cafe-proof --skip-confirmation`.
- Create the production database (`npx wrangler d1 create gamo-cafe-db`) and put the id it prints in `wrangler.jsonc` under `env.production`.
- Confirm with the owner that the cafeteria's records will live in this account, and the monthly reimbursement (spec §11, assumption 3).

## Acceptance criteria

- [x] The account is on Workers Paid (done 2026-10-06, per the developer) and has a budget alert.
- [x] `gamo-cafe-proof` no longer exists as a Worker or as a database.
- [x] `gamo-cafe-db` exists and its id is recorded under `## Answer`.
- [x] The owner has agreed to spec §11, assumption 3.

## Comments

- 2026-10-06: Opened from ADR 0007.
- 2026-10-06: The developer upgraded the account. The budget alert, the teardown, the production database and the owner's agreement remain.
- 2026-10-06: The developer deleted the `gamo-cafe-proof` Worker and database.
- 2026-10-06: `gamo-cafe-db` created and its id put in `wrangler.jsonc`. No migrations applied yet. The budget alert and the owner's agreement remain, both the developer's.
- 2026-10-06: The owner agreed to spec §11, assumption 3, per the developer. Only the budget alert remains; the developer is creating it.
- 2026-10-06: The developer created the budget alert. All criteria met.

## Answer

- `gamo-cafe-db`: `489c5790-7285-4984-b735-89786843f70e`, region WNAM.
- `npx wrangler d1 list` shows no `gamo-cafe-proof` database.
