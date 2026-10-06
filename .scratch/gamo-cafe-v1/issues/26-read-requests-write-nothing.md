# 26 — A request that only reads writes nothing

Status: ready-for-agent
Blocked by: —
Spec: [`../spec.md`](../spec.md) §2.4, §3.5, §10.1, §10.7

## What to build

`authenticate` in `app/backend/sign-in.ts` runs `UPDATE sessions SET last_used_at = ...` on every signed-in request, so every page view is a D1 write. On 2026-10-06 that turned an exhausted write quota into every page answering 500, while D1 reads still worked.

- Find the session with a read. Touch `last_used_at` only when it is older than a fixed interval (an hour is enough against a 60-day idle lifetime), in a second statement that most requests never issue.
- Keep every rule the single statement enforced: a revoked session, an idle one past its lifetime and a deactivated User are all refused, and the idle lifetime is still measured from the last touch.
- If the touch fails, the request still succeeds: the session was valid when it was read.
- `tests/proof-budget.test.ts`: assert that each of the six read-only requests reports zero rows written (spec §10.7).

## Acceptance criteria

- [ ] A signed-in GET within the interval of the last touch issues no write; one after it issues exactly one.
- [ ] The sign-in and session tests still pass, including revocation, the idle lifetime with a test clock, and a deactivated User.
- [ ] A session that is used at least once an hour never expires; one unused for 60 days does.
- [ ] The budget test asserts zero rows written for the read-only requests.

## Comments

- 2026-10-06: Opened from the research in [`../research/free-plan-stack-review.md`](../research/free-plan-stack-review.md) §3.5 and §4.4.
