# 26 — A request that only reads writes nothing

Status: resolved
Blocked by: —
Spec: [`../spec.md`](../spec.md) §2.4, §3.5, §10.1, §10.7

## What to build

`authenticate` in `app/backend/sign-in.ts` runs `UPDATE sessions SET last_used_at = ...` on every signed-in request, so every page view is a D1 write. On 2026-10-06 that turned an exhausted write quota into every page answering 500, while D1 reads still worked.

- Find the session with a read. Touch `last_used_at` only when it is older than a fixed interval (an hour is enough against a 60-day idle lifetime), in a second statement that most requests never issue.
- Keep every rule the single statement enforced: a revoked session, an idle one past its lifetime and a deactivated User are all refused, and the idle lifetime is still measured from the last touch.
- If the touch fails, the request still succeeds: the session was valid when it was read.
- `tests/proof-budget.test.ts`: assert that each of the six read-only requests reports zero rows written (spec §10.7).

## Acceptance criteria

- [x] A signed-in GET within the interval of the last touch issues no write; one after it issues exactly one.
- [x] The sign-in and session tests still pass, including revocation, the idle lifetime with a test clock, and a deactivated User.
- [x] A session that is used at least once an hour never expires; one unused for 60 days does.
- [x] The budget test asserts zero rows written for the read-only requests.

## Comments

- 2026-10-06: Opened from the research in [`../research/free-plan-stack-review.md`](../research/free-plan-stack-review.md) §3.5 and §4.4.
- 2026-10-06: Resolved, see `## Answer`.

## Answer

`authenticate` in `app/backend/sign-in.ts` is now a `SELECT` that joins `sessions` to `users` with the same conditions the single `UPDATE` had: not revoked, `last_used_at` within 60 days, User active. Only when `last_used_at` is at least an hour old (`SESSION_TOUCH_INTERVAL`) does it issue a second statement, `UPDATE sessions SET last_used_at = ?`, whose `DbError` is swallowed.

What a later reader should know:

- The 60 days are measured from the last touch, not the last request. A session last touched at 09:00 and last used at 09:59 ends 60 days after 09:00, so a session can end up to an hour earlier than "60 days without use" read literally. Spec §3.5 was left as written.
- The touch is one row written: `sessions` has no index on `last_used_at`.
- A failed touch is not logged or reported. With D1 writes refused, a session that is in use keeps working until 60 days after its last successful touch.
- The first criterion is proved in two places. `tests/sign-in.test.ts` ("using a session") counts the rows D1 reports written by `authenticate` under a test clock: none within the hour, exactly one at the hour, none after. `tests/proof-budget.test.ts` asserts zero rows written for the six GETs through the Worker at both history sizes; no test drives "exactly one" through an HTTP request, because the Worker reads the real clock.
- The same file covers a touch that fails (a `Db` that refuses every write still signs the User in, and still refuses a revoked or expired session) and a session used every hour for 61 days.
- README's "Request budgets" section now names the third rule.
