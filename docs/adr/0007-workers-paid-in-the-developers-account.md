---
status: accepted
---

# Workers Paid in the developer's Cloudflare account, and no remote proof

The app runs in the developer's own Cloudflare account, on Workers Paid, beside the developer's other projects. The owner reimburses the plan's $5 a month. This replaces two parts of ADR 0005: the account that belongs to Gamo, and the requirement to stay on Workers Free and D1 Free. The rest of ADR 0005 stands: React Router 8 on Workers with D1 and hand-written SQL.

The free plan fitted the cafeteria's volume many times over and did not comfortably fit its rendering. On 2026-10-06 the release proof measured four of nine screens at or over the 10 ms CPU limit, which Cloudflare's own limits page says server-side rendering typically exceeds, and the proof's own load then exhausted the account's daily D1 write limit, which is counted per account and so blocked the developer's other projects too. Workers Paid is a plan change with no code change: the CPU limit becomes 30 seconds, the daily D1 limits go away, and at this volume the bill stays at the $5 minimum. The research is in [`.scratch/gamo-cafe-v1/research/free-plan-stack-review.md`](../../.scratch/gamo-cafe-v1/research/free-plan-stack-review.md).

The remote free-plan proof is dropped as a release gate. Its one purpose was to show that the app fits a plan it no longer runs on. What it checked that still matters is kept where it costs nothing: `tests/proof-budget.test.ts` holds every proof request to a statement budget and to rows read that do not grow with the history. With no 10 ms limit to fit, Effect's exit rule (ADR 0006) has nothing to decide and is withdrawn.

## Consequences

- The cafeteria's records live in an account the owner does not hold. The owner depends on the developer's account and on the developer's card.
- The plan has no spending cap, only budget alerts. A budget alert is set on the account, and the Worker sets a CPU ceiling per request.
- The account's included usage is shared by every project in it.

## Considered Options

- **Stay on Workers Free**: workable, but every screen then has to be kept under 10 ms and proven so on a real deployment, and the tolerance for overruns is undocumented.
- **Workers Paid in an account that belongs to Gamo**: keeps the owner's custody at a second $5 a month, with nothing shared.
- **Another host**: nothing at $0 was permanent, awake and allowed for a business; at about $5, Railway, Fly and a small server cost the same or less on the invoice and need the data layer and the test harness rewritten.
