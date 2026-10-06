# Research: free-plan stack review — hosting, React rendering cost, and tests versus provider limits

**Scope and status.** Research only, prepared 2026-10-06, the day ticket 22's proof missed its CPU criterion and then exhausted D1 Free's daily write quota. It decides nothing and changes no spec, ADR or ticket. It gives Diego what he needs to decide three things: where to host, whether React Router's server rendering is the problem, and how to keep proof runs away from provider limits.

**Method.** Every provider figure was read from the provider's own page on 2026-10-06 and is linked where it is used; none is quoted from memory. Source-code claims cite the packages installed in `node_modules` (react-dom 19.3.0, react-router 8.4.0, @react-router/cloudflare 8.4.0, @react-router/dev 8.4.0, wrangler 4.147.0, @cloudflare/vitest-plugin 1.3.6, @cloudflare/vite-plugin 1.62.5) by path, function and line. **Fact** is documented or read in source. **Inference** is my reasoning from facts. **Recommendation** is an option for a later decision. **unverified** marks a claim whose owner I could not read. Pages were read through a fetch tool that returns extracts, so quoted text is as the tool returned it; the three sentences that carry a decision were fetched twice (Cloudflare's CPU "flexibility" paragraph, Cloudflare's "SPA mode and prerendering" sentence, react.dev's "worse performance" sentence).

**Added after the research.** Three local measurements, in the subsections marked "(added by the lead)" in §3.3, §3.4 and §4.3, and the edits elsewhere that they made necessary. They ran on a laptop against the built app or a scratch Worker; none touched Cloudflare, and their scripts were temporary and are not in the repo. Two records from the developer's other project on this stack (`~/coding/mdwn/docs/import.md` and `operations.md`) are quoted in §2.1 and §4.3, and one read-only `wrangler d1 list` named the databases in the account (§4.3). Seven pages that carry a decision were fetched once more by the lead and matched what is quoted here: Workers limits, Workers pricing, D1 pricing, Railway's plans, Cloudflare's React Router guide, react.dev's server APIs and Vercel's fair-use guidelines.

## 0. Bottom line

### 0.1 Hosting and database

**Answer.** Cloudflare Free is enough for this app's volume and not comfortably enough for its CPU. A busy Day uses 1.8% of D1 Free's daily rows written, 0.7% of its rows read and a few percent of the Worker request quota (§2.1). The two limits reached today were not reached by the app's workload:

- The **10 ms CPU limit** is one that Cloudflare's own limits page says server-side rendering normally exceeds: "Heavier workloads that handle authentication, server-side rendering, or parse large payloads typically use 10-20 ms." No request was terminated in 1,797 requests, including 100 consecutive ones at a 17.7 ms median, but Cloudflare documents the tolerance only as "some built-in flexibility" for a Worker that "infrequently" runs over. What we saw is an observation, not a guarantee: the developer's other project, on the same plan, drew `exceededCpu` 503s this week from much heavier requests, and then from light ones until it was left to rest (§2.1).
- The **D1 write limit** was exhausted by the proof kit: about 137,000 rows written in one afternoon, the equivalent of some 76 busy Days, against 100,000 a day (§4.3).

| Option | Monthly cost | Code change | What it buys | What it risks |
| --- | --- | --- | --- | --- |
| A. Stay on Workers Free + D1 Free | $0 | Render diet (§3.5); proof moved off the production account (§4.4) | Nothing new to run; the measured busy Day uses under 2% of each D1 quota and a few percent of the requests | Four screens at 9.6–17.7 ms warm and 15–27 ms on a cold isolate, against a 10 ms limit whose tolerance is undocumented. While every request writes a session row, an exhausted write quota is a total outage |
| B. Workers Paid | $5.00, flat at this volume (§2.2) | None | CPU limit of 30 s by default; no daily D1 caps; a runaway run becomes a bill instead of an outage | Breaks ADR 0005's "permanently free". Budget alerts only inform; there is no spend cap |
| C. Another host at $0 | $0 | Replace the Cloudflare layer (§2.5) | — | Every managed $0 option fails on a hard fact (§2.3): non-commercial terms (Vercel Hobby), sleep (Render, Koyeb, Deno Deploy, Cloud Run), expiry or credits (Render Postgres, AWS, Netlify, Railway), or no free tier (Fly). The survivor is an Oracle Always Free VM with a SQLite file: you run the server, and Oracle may reclaim an idle one |
| D. Another host at about $5 (Railway Hobby, Fly, Hetzner, Render) | $2.34–$7.25 | Same replacement, plus a server and backups to look after | No per-request CPU cap; React's faster Node renderer | Costs as much as B and buys nothing B does not |

**Recommendation.** This is an owner decision between A and B; C and D are dominated. If the owner will pay $5 a month, switch the Gamo account to Workers Paid: it is a plan change, not a migration, and it removes both limits that bit today. If $0 is not negotiable, stay on Cloudflare, which is the only $0 option found that is permanent, never sleeps and carries no non-commercial clause; do the render diet in §3.5 so each request sits under 10 ms with margin, stop writing a session row on every request, and keep B as the documented way out. Do not move to Railway: its free plan is a $1 monthly credit and its Hobby plan is $5, the same price as B, plus a rewrite.

### 0.2 React and React Router rendering

**Answer.** React is behaving normally; the limit is what is unusual. Six to eighteen milliseconds of CPU for a server-rendered page is what Cloudflare itself calls typical, and staff see 112–247 ms of wall time either way. It does not come up elsewhere because the other platforms read here meter CPU as a monthly total (Vercel Hobby: 4 CPU-hours; Deno Deploy Free: 10 hours) or cap a request in seconds; of them, only Workers Free caps each request at 10 ms. On Workers Free it has come up before in another form: the other project's import proof was terminated for CPU this week (§2.1). Nothing we do is a bug. Four things we do are expensive under a 10 ms cap, and the proof measures a path that phones rarely take (§3.5):

- **Inherent:** React's Workers build encodes every attribute name, attribute value and text node separately with `TextEncoder.encode` and copies each into a 4,096-byte buffer; React Router's `<Link>` resolves its path twice per render; loader data travels twice, as HTML and as a hydration payload; the 1.3 MB server build is evaluated inside the first request of every new isolate (inferred, §3.1).
- **Ours:** an unpaged 200-row list; document POSTs that answer with a full page instead of a redirect; a gate that times full document renders although a hydrated phone sends `.data` requests, which render no HTML; a D1 write on every request.

| Option | Effort | Expected effect | Evidence |
| --- | --- | --- | --- |
| Diet inside React Router: page Cuentas abiertas at 50, answer document POSTs with a redirect, fewer attributes per row | Small | The 50-row page of Cuentas measures 7.6 ms where 200 rows measure 17.7; the one POST that redirects measures 5.0 ms. Locally, 50 rows render 3.5 times faster than 200, and rows with fewer attributes another 2.8–3.8 times | Table A; local benchmark (§3.4) |
| Skip the server render of heavy lists (`clientLoader` + `HydrateFallback`) | Medium | Removes React's HTML render of the list from the Worker; the data is still serialized once. It cannot cost less than the data request, which locally is 1.8–3.7 times cheaper than the document | React Router docs and source (§3.3); the route change itself is not measured |
| Measure `.data` requests as well as documents | Small | Shows what a signed-in phone costs after first load. Locally: 1.8–3.7 times less than the document for the same screen | React Router source and a local measurement (§3.3); not yet measured on Cloudflare |
| React's Node stream build, with Node compatibility | Small, if it works inside React Router's entry | 27–37% off the render in a local workerd | Local benchmark (§3.4); not tested in the app or on Cloudflare |
| Another renderer (Hono JSX, Preact, template strings) | Rewrite of every screen and of the client-side navigation | In a local workerd, string renderers render the same list 3.5–5 times faster than React's streaming Workers build. React's own `renderToString` is as fast as they are | Local benchmark (§3.4) |
| Workers Paid | None | Makes the question moot | §2.2 |

**Recommendation.** Do the diet first. It is what spec §2.4 already asks ("long lists are paged"), it is cheap, and table A says it is enough for most screens. Do not rewrite the UI in another framework. The local benchmark in §3.4 does show a multiple, about four times, but it puts the cost in the streaming byte path React uses on Workers, not in React's rendering: React's own `renderToString` costs what Preact and Hono's JSX cost. A rewrite would buy that multiple on the render alone, which is about half of a request, and would give up React Router's client-side navigation. Paging, leaner rows and not server-rendering heavy lists buy as much without leaving React Router.

### 0.3 Tests versus provider limits

**Answer.** Nothing in `npm test`, `npm run test:e2e`, `npm run verify` or `npm run dev` talks to Cloudflare. They run workerd and a D1 simulator on the laptop, and the repo has no CI. The only commands that spend account quota say `--remote` or `:production`, or take a deployed URL (§4.2). What exhausted the limit was the proof kit itself: the seed import (71,084 rows, 71% of a Free day), then five runner executions the same UTC day at about 334 rows written per run of the nine requests (§4.3). The limit is account-wide, so every write on the account then failed; and because `authenticate` writes on every request, so did every page. That account also holds the other project's production database, so the proof blocked that project's writes too; its own restore rehearsal had done the same the day before (§4.3). Every limit either project reached in those two days was reached by a proof or a rehearsal, none by ordinary use.

**Recommendation.**

1. Keep ordinary tests local. That is already true; it stays true as long as the D1 binding never gets `remote: true`.
2. Run the proof by hand, as now, in a Cloudflare account that is not production's. Budget it before starting: the seed, one 21-run pass and the busy Day come to about 79,900 rows, which fits one Free day once. Further passes cost about 7,000 rows per 21 runs and either wait for 00:00 UTC or reuse the seeded database on a later day.
3. Use the remote run only for the one figure Cloudflare alone can report, CPU time. Statements, rows read and rows written per request are already proven locally by `tests/proof-budget.test.ts`.
4. On Workers Paid the same mistake costs money instead of service: $1.00 per million rows written beyond 50 million a month. Today's whole afternoon was 0.27% of the included amount.

## 1. What we measured in this repo

First-party data from 2026-10-06, as recorded by the lead and ticket 22. Not re-derived here.

**A. Cloudflare-reported CPU per request** on a disposable Workers Free + D1 Free deployment loaded with a synthetic year. Median ms from `workersInvocationsAdaptive.cpuTimeP50`, four passes (21 runs on a fresh deployment, 50, 21, 100):

| Request | 21 fresh | 50 | 21 | 100 |
| --- | --- | --- | --- | --- |
| Vender, the Sell screen (GET document, 60 Item tiles) | 11.59 | 6.91 | 8.89 | 6.47 |
| Record a ten-Item selection with Payment (POST document; re-renders Vender) | 14.43 | 8.84 | 10.31 | 10.35 |
| Cuentas abiertas with 200 Open Bills (GET document, unpaged) | 18.57 | 16.41 | 20.40 | 17.67 |
| Pay a Customer with 30 Open Bills (POST document; re-renders the page) | 11.05 | 10.24 | 10.37 | 9.64 |
| Día for the busiest Day | 7.87 | 6.95 | 9.96 | 6.21 |
| A page of Cuentas (50 rows) | 9.46 | 7.53 | 10.73 | 7.60 |
| Inventario (60 Items + recent Adjustments with a form each) | 11.47 | 7.93 | 11.06 | 9.40 |
| A Count of every Item (POST, answers 302, renders nothing) | 5.13 | 4.71 | 5.97 | 4.96 |
| A page of Historial (50 rows) | 10.31 | 9.62 | 14.92 | 10.56 |

- Every one of the 1,728 requests in the four recorded passes, plus 69 in a busy-Day simulation, answered its expected status: zero failures and zero CPU-exceeded errors, including 100 consecutive Cuentas abiertas requests at a 17.7 ms median. The documented 10 ms limit did not kill any request in these runs.
- Wall-time medians seen from the client (Mexico): 112–247 ms per request.
- Read-only probes, 80 requests each, two windows each: `/healthz` (a resource route: Effect runtime and one D1 read, no session, no HTML) p50 2.02 and 3.46 ms; `GET /entrar` (a 6 KB server-rendered page, no D1) p50 3.00 and 2.67 ms. The same request varies by about 1.5 ms between windows.
- `wrangler tail` showed single invocations at 15, 16, 22, 26 and 27 ms CPU with outcome "ok": the first request after idle or in a new isolate.

**B. A CPU profile of the built server bundle** (loaded in Node, warm, SQLite standing in for D1). JS ms per request: `/healthz` 0.25, Vender 0.98, selection POST 1.35, Cuentas abiertas 3.5, Customer page 1.3, Día 1.1, Cuentas 1.6, Inventario 1.8, Count 0.7, Historial 2.0. A rough fit to table A is Cloudflare ≈ 3.3 ms + 3.4 × the Node figure.

- React's server render (`performWork` inclusive) is 40–55% of every rendered screen.
- The largest single self-time item is `TextEncoder.encode`: 0.5 of 3.5 ms on Cuentas abiertas (14%), 0.37 of 2.9 ms on Inventario. The hypothesis handed to this research was that React's edge build encodes every dynamic string to its own `Uint8Array` and copies it into a 2 KB view, so cost follows element and attribute count; §3.2 checks it in source.
- React Router's `<Link>` (`LinkWithRef` inclusive: `useResolvedPath`, `usePrefetchBehavior`, `useLinkClickHandler` and the rest) is 17% on the 200-row list, about 3 µs per link warm.
- The hydration payload (`encodeViaTurboStream`) is about 12%: loader data is serialized into the HTML in addition to being rendered.
- Running the Effect programs (`runPromiseExit` inclusive, SQLite time included) is 0.02–0.37 ms, at most about 10%. Effect is not the cause.
- Cuentas abiertas is 177 KB of HTML for 200 rows; the server bundle is 1.3 MB (280 KB gzip).

**C. Code facts**, each confirmed by reading the file today:

- `app/entry.server.tsx` calls `renderToReadableStream` from `react-dom/server`.
- `workers/app.ts` loads the build lazily: `build: () => import("virtual:react-router/server-build")`. The built Worker keeps it as a separate 1.3 MB module, `import("./assets/server-build-CeKrKnXj.js")` at `build/server/index.js:1067`, with `no_bundle: true` in `build/server/wrangler.json`.
- `react-router.config.ts` is `{ ssr: true }`.
- `authenticate` in `app/backend/sign-in.ts:129` runs `UPDATE sessions SET last_used_at = ? ... RETURNING ...`, and `sessionMiddleware` in `app/session.server.ts:72` calls it for every request that carries a session cookie. Every signed-in request is a D1 write.
- `app/backend/db.ts` is the only module that calls the D1 binding; `app/backend/run.server.ts` holds the binding's type for the runtime cache.

**D. D1 usage.** The synthetic-year import wrote 71,084 rows (Cloudflare-reported; 161 statements; 3.91 MB database). A simulated busy Day (69 requests: 55 sales, 10 Abonar submissions for the Customer with 30 Open Bills, 3 Adjustments, a Count of 60 Items) cost 35,077 rows read and 1,793 rows written. The four proof passes ran 192 times each of the nine requests the same UTC day, three of which write (a ten-Line sale with Payment; a one-centavo Abonar for the Customer with 30 Open Bills; a Count of 60 Items). Minutes after the last pass every write failed with `D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.` Because of the per-request session UPDATE, every signed-in request then answered 500. The account is the developer's personal one; the message says "your account".

**What the Abonar request writes, from reading the runner.** One Payment, not 30; the brief for this research said 30 and was wrong. `abono()` in `scripts/proof.ts:190` sends `amount=0.01`, and `takeCustomerPayment` in `app/backend/bills.ts:865` spreads an amount oldest Bill first until it is used up, so one centavo becomes one Payment on the oldest Bill. The form carries 30 `bill` fields; the write is one `payments` row and one `bills` update. The busy-Day figure of 1,793 rows only reconciles with one Payment per Abonar, and the local measurement agrees: 9 rows written (§4.3).

## 2. Question 1 — hosting and database

### 2.1 Cloudflare Free, as documented and as observed

**Fact.** Current figures, all from Cloudflare's pages:

| Limit | Free figure | At the limit | Source |
| --- | --- | --- | --- |
| Worker requests | "100,000/day", "resetting at midnight UTC" | "Cloudflare returns **Error 1027**"; per route either "Fail open" (the Worker is bypassed) or "Fail closed" | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (last updated Sep 5, 2026) |
| Static-asset requests | "Requests to static assets are free and unlimited." "Requests to the Worker script (for example, in the case of SSR content) are billed according to Workers pricing." | — | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) |
| CPU time per HTTP request | "10 ms" | "Cloudflare returns Error 1102 to the client with the message `Worker exceeded resource limits`"; outcome `exceededCpu`. See enforcement below | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Memory | "128 MB", "per-isolate, not per-invocation" | The runtime starts a new isolate; Error 1102, outcome `exceededMemory` | same |
| Startup time | "1 second" for "its global scope (top-level code outside of handlers)" | The deployment is rejected: "Script startup exceeded CPU time limit" (code 10021) | same |
| Subrequests | "50/request" | — | same |
| Worker size | 64 MiB uncompressed on both plans; "There is no compressed size limit." | — | same |
| D1 rows read | "5 million / day" | Queries fail (wording below) | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) |
| D1 rows written | "100,000 / day" | Queries fail | same |
| D1 storage | "5 GB (total)" per account; 500 MB per database; 10 databases per account | "you will need to delete unused databases or clean up stale data before you can insert new data" | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) (last updated April 21, 2026) |
| D1 queries per Worker invocation | 50 | — | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| D1 bound parameters per query | 100 | — | same |
| D1 Time Travel | 7 days; "always on"; "Database history and restoring a database incur no additional costs." | — | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) |

D1's free limits reset and scope: "Free limits reset daily at 00:00 UTC." They are per account, not per database: "When your account hits the daily read and/or write limits, you will not be able to run queries against D1. D1 API will return errors to your client indicating that your daily limits have been exceeded." ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)). The error we received says the same: "Your account has exceeded D1's free tier daily row write limit".

**Fact: the spec's table in §2.4 matches the live pages.** Nothing in it is contradicted. The live pages add three things the spec does not carry: the startup limit is now 1 second; Cloudflare states that server-side rendering "typically" uses 10–20 ms; and the D1 daily limits are counted per account.

**How the CPU limit is enforced — documented.** The CPU section of [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) reads:

> "Most Workers consume very little CPU time. The average Worker uses approximately 2.2 ms per request. Heavier workloads that handle authentication, server-side rendering, or parse large payloads typically use 10-20 ms."
>
> "Each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs over the configured limit. If your Worker starts hitting the limit consistently, its execution will be terminated according to the limit configured."

The metrics page names the mechanism: "In some cases, higher quantiles may appear to exceed CPU time limits without generating invocation errors because of a mechanism in the Workers runtime that allows rollover CPU time for requests below the CPU limit." ([Workers metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/), last updated Jul 1, 2026). Neither page gives a number for the flexibility or the rollover. workerd's open-source header only declares the interface (`enterJs`: "Called just after taking the isolate lock, before executing JavaScript code, to enforce limits on that code execution, particularly the CPU limit.", [limit-enforcer.h](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/limit-enforcer.h)); the production enforcer is not in that file.

**How it is enforced — observed.** Zero terminations in 1,797 requests, including 100 consecutive Cuentas abiertas requests at a 17.67 ms median, and cold requests at 15–27 ms that `wrangler tail` reported as "ok".

**How it is enforced — observed in the developer's other project (added by the lead).** The reference project runs on the same plan, and its own docs record the limit terminating requests in the same two days (`~/coding/mdwn/docs/import.md`). On 2026-10-05, on a Workers Free account: "the first run exposed two `exceededCpu` 503s on the largest invocations". On 2026-10-06: "back-to-back attempts after several heavy runs hit environment-level generic edge 404s and `exceededCpu` 503s even on lightweight requests, which a spaced re-run cleared." Those invocations were far heavier than a page of Bills. **Inference:** the limit is real, a Worker that has overrun for a while loses its allowance, and then cheap requests fail too until it recovers. Gamo's 1.8-times overruns stayed inside the allowance today; that record shows what the far side of it looks like.

**Inference.** The limit is not a hard cut at 10 ms per request. A simple rollover bank does not explain today either: in the 100-run pass, the 100 Vender requests before the list could have banked at most about 350 ms (100 × (10 − 6.47)), the 100 selection POSTs banked nothing, and 100 Cuentas abiertas requests then ran about 770 ms over in total (100 × (17.67 − 10)) without one termination. So the tolerance is wider than the pages suggest, or enforced differently on a low-traffic `workers.dev` deployment. Either way it is undocumented behaviour: Cloudflare can tighten it without contradicting a word of its documentation. Passing today is not evidence that it will pass in a month.

**How fast the D1 limit is enforced.** Not documented. By the row model in §4.3 the account crossed 100,000 rows written at about 15:28 UTC, during the third recorded pass, and the entire 100-run pass that followed (15:29:47–15:32:30, about 33,400 more rows) succeeded; writes were refused only minutes later. **Inference:** enforcement lags by minutes and tens of thousands of rows. A run cannot rely on D1 to stop it at the limit, and cannot rely on being allowed past it.

**Reads after the write limit — observed (added by the lead).** A write was refused at 15:46:57 UTC. Between 15:48:19 and 15:48:49 UTC, 160 requests to `/healthz` answered 200; each is one D1 read, and the route answers 503 when the read fails (`app/backend/health.ts`). So passing the write limit blocked writes and left reads working, at least for those minutes. The pricing page's sentence, "you will not be able to run queries against D1", does not make that distinction.

**What a real busy Day uses.** From data D, a busy Day costs 1,793 rows written (1.8% of the daily limit) and 35,077 rows read (0.7%). At 3,000 requests a day the session row adds 3,000 writes (3%), which is more than the Day's business writes; requests are 3% of the daily quota. Storage is 3.91 MB for the synthetic year against 500 MB per database. **Inference:** if every one of 3,000 requests read as many rows as the busy-Day average (35,077 ÷ 79 requests, counting the ten page reads Abonar makes, is 444), rows read would be 1.33 million, 27% of the limit. That average comes from write-heavy requests and overstates ordinary browsing, but rows read, not rows written, is the D1 quota this app would approach first.

**Permanence and terms.** Cloudflare's stated intention: "Yes, the Workers Free plan will always include the ability to prototype and experiment with D1 for free." ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)). Note the words "prototype and experiment". The [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/) (last updated September 12, 2025) lets a Free Service end on "termination of the Free Service by Cloudflare in our sole discretion" (§2.6) and disclaims liability for Free Services. I found no clause restricting Free to non-commercial use in the pricing page, the limits page, the agreement or the [Developer Platform service-specific terms](https://www.cloudflare.com/service-specific-terms-developer-platform/); the agreement says "You are permitted to perform benchmark tests of our Services." (§2.2.2).

### 2.2 Cloudflare Workers Paid

**Fact.** From [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/):

| Item | Workers Paid |
| --- | --- |
| Price | "a minimum charge of $5 USD per month for an account" |
| Coverage | "The Workers Paid plan includes Workers, Pages Functions, Workers KV, Hyperdrive, and Durable Objects usage"; "D1 is available on both the Workers Free and Workers Paid plans." **Inference** from "for an account": one subscription covers every Worker and every D1 database on that account, and a second Cloudflare account is a second subscription |
| Requests | "10 million included per month", then "+$0.30 per additional million". No daily limit |
| CPU time | "30 million CPU milliseconds included per month", then "+$0.02 per additional million CPU milliseconds" |
| CPU per invocation | "Max of 5 minutes of CPU time per invocation (default: 30 seconds)" |
| D1 rows read | "First 25 billion / month included + $0.001 / million rows" |
| D1 rows written | "First 50 million / month included + $1.00 / million rows" |
| D1 storage | "First 5 GB included + $0.75 / GB-mo"; 10 GB per database |
| D1 queries per invocation | 1,000 |
| D1 Time Travel | 30 days |

**Spend controls — Fact.** There are three, and none is a cap on the bill:

- A per-invocation CPU ceiling: "To prevent accidental runaway bills or denial-of-wallet attacks, configure the maximum amount of CPU time that can be used per invocation by defining limits in your Worker's Wrangler file, or via the Cloudflare dashboard." ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)). The key is `limits.cpu_ms`.
- Budget alerts: "Budget alerts notify you by email when your account-wide usage-based spend crosses a dollar threshold you define." and "Budget alerts are informational only. They do not pause or cap usage." ([Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/), last updated May 29, 2026). They are a day late: "Usage is processed once per day for the prior day's activity, so budget alerts fire the day after the threshold is reached rather than in real time." Pay-as-you-go accounts get one by default "with a $10 account-level threshold" ([Cloudflare changelog](https://developers.cloudflare.com/changelog/post/2026-06-15-budget-alerts-default-on/)).
- I found no setting that stops D1 or Workers at a spend amount.

**This app's bill on Paid — Inference from data D.** Assume every Day is a busy Day of 3,000 requests, for 31 days:

| Meter | Assumed use per month | Included | Share used |
| --- | --- | --- | --- |
| Requests | 3,000 × 31 = 93,000 | 10,000,000 | 0.9% |
| CPU | 93,000 × 18 ms (the worst median in table A) = 1,674,000 CPU-ms | 30,000,000 | 5.6% |
| D1 rows written | (1,793 + 3,000 session rows) × 31 = 148,583 | 50,000,000 | 0.3% |
| D1 rows read | 3,000 × 444 × 31 = 41,292,000 | 25,000,000,000 | 0.17% |
| D1 storage | 3.91 MB per year of records | 5 GB | 0.08% |

Nothing leaves the included amounts, so the bill is the minimum: **$5.00 a month**. Ten times this traffic still would not. For scale, Cloudflare's own example is 15 million requests a month at 7 ms for a total of $8.00 ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)).

### 2.3 Elsewhere at $0 and permanent

Each row is ruled in or out on a fact from the provider's own page.

| Option | Permanent at $0? | Sleep and cold start | Caps and quotas | Commercial use | Card | Verdict for Gamo |
| --- | --- | --- | --- | --- | --- | --- |
| [Vercel Hobby](https://vercel.com/docs/plans/hobby) | "The Hobby plan is **free**" | Not stated on the pages read | 1,000,000 function invocations, "4 CPU-hrs" Active CPU, "360 GB-hrs" memory a month; function duration up to 300 s. Over a limit: "you will have to wait until 30 days have passed before you can use the feature again" | **No.** "**Hobby teams** are restricted to non-commercial personal use only." Commercial usage includes any deployment "used for the purpose of financial gain of **anyone** involved" ([Fair use](https://vercel.com/docs/limits/fair-use-guidelines)) | Not stated | **Out** on its terms: a cafeteria's point of sale is commercial |
| [Netlify Free](https://www.netlify.com/pricing/) | "Free — $0 forever", "300 credits/month", hard limit | Not stated | "Production deploys 15 credits each", "Compute 10 credits per GB-hour", "Bandwidth 20 credits per GB", "Web requests 2 credits per 10,000 requests" ([How credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)) | Not stated | Not stated | **Out.** Twenty production deploys spend the month's credits, and then "all of your web projects (sites/apps) are paused". No SQL database |
| [Deno Deploy Free](https://deno.com/deploy/pricing) | "$0/month" | "Idle apps automatically shut down after ~20-30 seconds" | "1M" requests, "10 hr" CPU, "20GiB" egress a month; no per-request CPU limit stated; 512 MB memory ([limits](https://docs.deno.com/deploy/pricing_and_limits/)) | Not stated | Not stated | A possible host, but it scales to zero after seconds and includes no SQL database (Deno KV only); the database would be Turso or Neon |
| [Render Free](https://render.com/docs/free) | Free instance type | "Render spins down a Free web service that goes 15 minutes without receiving any inbound traffic."; spinning up "takes about one minute" | 750 instance hours a month; "Free web services have an ephemeral filesystem."; free Postgres databases "expire 30 days after creation" | "Do not use them for production applications." | Not stated | **Out** |
| [Koyeb Free Instance](https://www.koyeb.com/docs/reference/instances) | One per organization | "They scale down to zero when they don't receive any traffic for 1 hour." | "512MB of RAM, 0.1 vCPU, and 2GB of SSD"; "can't be used with Volumes" | "should not be used for production applications" | Not stated | **Out** |
| [Google Cloud Run free tier](https://docs.cloud.google.com/free/docs/free-cloud-features) | "The Free Tier has no end date", changeable "with 30 days' advance notice" | "When a revision does not receive any traffic, by default, it is scaled to zero instances." ([autoscaling](https://docs.cloud.google.com/run/docs/about-instance-autoscaling)); a minimum instance costs money | "2 million requests per month. 360,000 GB-seconds of memory, 180,000 vCPU-seconds of compute time. 1 GB of outbound data transfer from North America per month." | No restriction stated | "you need a Google Cloud billing account"; over the limits is "billed at standard rates" | A possible host with cold starts. No free SQL database: the database would be Turso or Neon |
| [AWS Lambda](https://aws.amazon.com/lambda/pricing/) | "The free tier includes one million requests and 400,000 GB-seconds per month." but a new account on the free plan "closes on its own 6 months after you open it or when your credits run out" unless converted to paid ([AWS Free Tier](https://aws.amazon.com/free/)) | Cold starts; Provisioned Concurrency and SnapStart are priced separately | — | Not stated | Not stated | **Out** as permanent $0 without a paid account; no free SQL database |
| [Fly.io](https://docs.fly.io/about/pricing) | "No. New organizations don't have a free tier or a monthly free usage allowance." Trial: "up to 2 hours of Machine runtime or 7 days" | — | — | — | "require a credit card on file" | **Out** at $0 |
| [Railway Free](https://docs.railway.com/reference/pricing/plans) | "$0 / month" with "$1 of free credit per month"; the trial is a one-time $5 for up to 30 days ([free trial](https://docs.railway.com/reference/pricing/free-trial)) | — | "1 vCPU", "0.5 GB" RAM, "0.5 GB" volume per service | — | The trial: "No credit card required." ([pricing](https://railway.com/pricing)) | **Out.** At "$10 / GB / month" of RAM, $1 buys 0.1 GB-month before any CPU: not an always-on Node server |
| [Oracle Cloud Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) (a VM with a SQLite file) | "for the life of the account" | A VM does not sleep, but "Idle Always Free compute instances may be reclaimed by Oracle" when over 7 days the 95th-percentile CPU, the network and the memory utilization are each under 20% | Two AMD micro VMs (1/8 OCPU, 1 GB) and Arm capacity of "the first 1,500 OCPU hours and 9,000 GB hours per month"; 200 GB block storage; "10 TB per month of outbound data" | No restriction found | **unverified** (Oracle's FAQ refused the fetch) | The one $0 option with no per-request cap. The cost is a server to run: OS patches, TLS, deploys, backups. A four-person app meets Oracle's definition of idle, and Arm shapes can be "out of host capacity" |
| [Turso Free](https://turso.tech/pricing) (database) | "$0/month"; "Start free, no credit card required" | "Idle databases cost only storage" | "100" databases, "5GB", "500 Million" rows read and "10 Million" rows written a month | No restriction stated; the Free plan lists no DPA or SOC 2 | No | SQLite-compatible, so the SQL stays. It replaces D1's quota, not the Worker's CPU cap |
| [Neon Free](https://neon.com/pricing) (database) | "The Free plan is permanent (not a trial)"; "no credit card required" | "suspends after 5 min, cannot be turned off" | "100 CU-hours/project", "1 GB/project, 20 GB account total", "5 GB per project" egress; out of compute hours "suspends compute until the next billing period" | Positioned for "Prototypes, side projects, and small teams." | No | Postgres: the SQL is rewritten (§2.5) |
| [Supabase Free](https://supabase.com/pricing) (database) | "$0/month" | "Free projects are paused after 1 week of inactivity" | "500 MB database size", "Limit of 2 active projects", "5 GB egress" | No restriction stated | Not stated | Postgres rewrite, and a closed week pauses it |

**Inference.** No managed platform at $0 is at once permanent, awake, allowed for a business and able to hold the data. Cloudflare Free is the nearest: the same table row for it reads "permanent by stated intention; no sleep; 10 ms CPU per request; no commercial restriction found". The alternatives that survive are a host that scales to zero (Cloud Run, Deno Deploy) paired with Turso, or a VM you operate. Each trades the CPU cap for cold starts or for operations work, and each needs the rewrite in §2.5.

### 2.4 Elsewhere at about $5 a month

| Option | The provider's formula | This app | Notes |
| --- | --- | --- | --- |
| Cloudflare Workers Paid | $5 minimum per account; included usage as in §2.2 | **$5.00** | No code change |
| [Railway Hobby](https://docs.railway.com/reference/pricing/plans) | "$5 / month" including "$5 of resource usage per month". RAM "$10 / GB / month", CPU "$20 / vCPU / month", volume "$0.15 / GB / month", egress "$0.05 / GB". "If your resource usage is $3, your total bill for the cycle will be $5"; at $7 of usage the bill is $7 | **Assumption:** a Node server averaging 0.2 GB of RAM and 0.02 vCPU with a 1 GB volume for a SQLite file is $2.00 + $0.40 + $0.15 = $2.55 of usage, so the bill is **$5.00**. Add a Postgres service of the same size and usage is $5.10, so the bill is $5.10. The memory and CPU figures are assumptions, not measurements | Described as "For indie hackers and developers to build and deploy personal projects." A sleeping service ("Serverless") wakes with "a small delay" and "may return a 502" on the first request ([docs](https://docs.railway.com/reference/app-sleeping)) |
| [Fly.io](https://docs.fly.io/about/pricing) | "`shared-cpu-1x` with 256MB RAM \| $2.19/month" ("512MB RAM \| $3.69/month"); volumes "$0.15/GB per month"; shared IPv4 and IPv6 free; "Dedicated IPv4 addresses are $2/mo."; prices "vary by region" | 256 MB and a 1 GB volume: **$2.34**; with 512 MB: **$3.84** | Card required. Managed Postgres starts at "$38/month", so the database would be a SQLite file on the volume |
| [Hetzner Cloud](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) | CX23 "€5.49" a month and CAX11 "€5.99" in Germany and Finland, for new orders since 15 June 2026, excluding VAT and IPv4; a primary IPv4 is "€ 0.50 ($ 0.60) monthly" ([IP pricing](https://docs.hetzner.com/general/others/ipv4-pricing/)) | **€5.99** with IPv4, plus VAT | European locations only at this price; the cheapest US plan on the same page, CPX11, is now "$20.49" a month. A plain server: everything is yours to run |
| [Render](https://render.com/docs/compute-plans) | Starter web service: 0.5 CPU, 512 MB. Its price, $7 a month, and Postgres `basic-256mb` at $6 are **unverified**: the pricing page is drawn by script and I read them only in a search snippet. Disk "$0.25 per GB per month" ([Render article, July 08, 2026](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses)) | About **$7.25** with a 1 GB disk | Paid instances are not the free type that spins down |

**Inference.** Nothing here is cheaper than Workers Paid once the rewrite is counted. Fly is cheaper on the invoice by $2.66 a month and costs a server, a volume and backups to look after.

### 2.5 What a move would cost this codebase

**Fact, from the repo today.**

| Cloudflare-specific piece | Where | Size |
| --- | --- | --- |
| The `Db` service over the D1 binding | `app/backend/db.ts` (`make`: `first`, `all`, `run`, `batch`) | 105 lines; the only caller of `d1.prepare` and `d1.batch` |
| Runtime cache keyed by the binding | `app/backend/run.server.ts`, `app/context/env.ts` | 2 small files |
| Worker entry and adapter | `workers/app.ts` with `createRequestHandler` from `@react-router/cloudflare` | 57 lines |
| Build and config | `vite.config.ts` (`@cloudflare/vite-plugin`), `wrangler.jsonc`, `worker-configuration.d.ts` | — |
| Vitest Workers pool | `vitest.config.ts` (`cloudflareTest`, `readD1Migrations`), `tests/support/` | 24 of 56 test files import `cloudflare:test` or `cloudflare:workers` |
| Playwright harness | `e2e/fixtures.ts` (`createTestHarness`, the D1 binding for seeding) | 1 file; 9 of 18 specs send SQL through it |
| Scripts | `scripts/seed.ts`, `projections.ts`, `sign-in-code.ts` shell out to `wrangler d1 execute` | 3 of 4 scripts |
| npm scripts | `wrangler types`, `wrangler d1 migrations apply`, `wrangler deploy` | 4 of 20 call wrangler directly |

The SQL is SQLite dialect: about 126 SQL string literals in 17 files under `app/backend`, and 12 migration files holding 50 statements (20 `CREATE TABLE ... STRICT`, 26 `CREATE INDEX`, two of them partial unique indexes). In the backend: `json_each` 10 times and `json_extract` 7, `rowid` 23 times as an ordering tiebreak, `ON CONFLICT` upserts 7 times, conditional `INSERT ... SELECT ... WHERE` throughout, and `db.batch` at 16 call sites as the only form of atomicity. Tests and browser tests carry SQL too: about 101 literals in 23 test files and 74 in 10 e2e files.

**Inference.**

- **To a SQLite-compatible target** (Turso/libSQL, or a SQLite file on a VM or volume) the SQL and the migrations stay. `Db` is rewritten once: libSQL's `batch()` is "multiple SQL statements executed sequentially within an implicit transaction" with "a full rollback" on any failure ([Turso SDK reference](https://docs.turso.tech/sdk/ts/reference)), which is what `db.batch` promises, and `rowsAffected` stands in for `meta.changes`. The larger job is the test bed: 24 test files and the Playwright fixture are written against workerd's local D1.
- **To Postgres** (Neon, Supabase, Railway, Render) every statement is touched at least for placeholders (`?` to `$1`); the `json_each` and `rowid` uses, about 40 sites, need redesign; `STRICT` and SQLite's integer booleans go; migrations are rewritten; batches become transactions.
- **To a Node host** the adapter becomes `@react-router/node` and the entry can use `renderToPipeableStream`, React's faster path (§3.2).

## 3. Question 2 — React and React Router rendering cost

### 3.1 How Workers counts CPU

**Fact.**

- What counts: "CPU time measures how long the CPU spends executing your Worker code. Waiting on network requests (such as `fetch()` calls, KV reads, or database queries) does **not** count toward CPU time." ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). Cloudflare's benchmark post puts it the same way: pricing "is based on CPU time – that is, time spent actually executing JavaScript code, as opposed to time waiting for things" ([Cloudflare blog, October 14, 2025](https://blog.cloudflare.com/unpacking-cloudflare-workers-cpu-performance-benchmarks/)).
- Startup: "A Worker must parse and execute its global scope (top-level code outside of handlers) within 1 second." and "To reduce startup time, avoid expensive work in global scope. Move initialization logic into your handler or to build time." ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). Two primary sources differ here by date: a Cloudflare post of September 26, 2025 says startup CPU time was "increased from 200ms to 400ms" ([Eliminating cold starts 2](https://blog.cloudflare.com/eliminating-cold-starts-2-shard-and-conquer/)); the limits page, updated Sep 5, 2026, says 1 second.
- A cold start has phases: "fetching the script source code, compiling the source code, performing a top-level execution of the resulting JavaScript module, and finally, performing the initial invocation to serve the incoming HTTP request." (same post).
- Isolate lifetime: no figure is published. "Isolates are resilient and continuously available for the duration of a request, but in rare instances isolates may be evicted."; the listed reasons are machine resource limits, a suspicious script and individual resource limits ([How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/), last updated Sep 18, 2026).
- Local development does not enforce the configured limits: "Limits are only enforced when deployed to Cloudflare's network, not in local development." ([Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)).

**Not documented.** Whether global-scope start-up time is charged to the first request's CPU time, and how a dynamic `import()` evaluated inside a handler is accounted. I found no statement on either in the limits, pricing, metrics or how-it-works pages.

**Inference.** The template's `build: () => import(...)` moves the evaluation of the 1.3 MB server build out of global scope and into the first request of each isolate, exactly as the limits page advises for the startup limit. That request then pays for it as request CPU, which matches the 15–27 ms cold invocations we saw. In a four-person app requests arrive in bursts between idle gaps, so a larger share of real requests will be cold than in a 100-run loop; the warm medians in table A understate what the first tap after a quiet period costs.

**Does Cloudflare publish guidance for SSR frameworks on the Free plan?** None found. The limits page's sentence that SSR "typically" uses 10–20 ms is the only statement. Cloudflare's [React Router guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/) (last updated Jun 19, 2026) and its [best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) (last updated Sep 24, 2026) do not mention CPU time or the Free plan.

### 3.2 React's renderer on Workers

**Fact: which build runs.** `node_modules/react-dom/package.json` maps `"./server"` to `./server.edge.js` under the `workerd` condition, and to `./server.node.js` under `node`. `server.edge.js` exports `renderToReadableStream`, `resume`, and the legacy `renderToString` and `renderToStaticMarkup`. It does not export `renderToPipeableStream`.

**Fact: how the Workers build turns strings into bytes** (`node_modules/react-dom/cjs/react-dom-server.edge.production.js`):

- `stringToChunk(content)` is `return textEncoder.encode(content);` (lines 171–173). Each call allocates a new `Uint8Array`.
- `pushStringAttribute` (line 837) pushes five chunks per attribute, two of them fresh encodes: `attributeSeparator, stringToChunk(name), attributeAssign, stringToChunk(escapeTextForBrowser(value)), attributeEnd`. The attribute's name is encoded again on every element.
- `pushTextInstance` (line 744) encodes every text node: `target.push(stringToChunk(escapeTextForBrowser(text)))`.
- Tags are the exception: `startChunkForTag` and `endChunkForTag` cache one precomputed chunk per tag name.
- `writeChunk` (lines 135–158) copies each chunk into a 4,096-byte view with `currentView.set(chunk, writtenBytes)` and enqueues the view when it fills; only chunks larger than 4,096 bytes skip the copy.
- `renderToReadableStream` (line 7795) returns `new ReadableStream({ type: "bytes", pull: ... }, { highWaterMark: 0 })`.
- The file calls `stringToChunk(` on about 80 lines; the Node build's compiled file calls it on none.

**Contradiction with the hypothesis given.** The view is 4,096 bytes, not 2 KB, in the installed 19.3.0 build; upstream `main` has `const VIEW_SIZE = 4096;` ([ReactServerStreamConfigEdge.js](https://github.com/facebook/react/blob/main/packages/react-server/src/ReactServerStreamConfigEdge.js)). The rest of the hypothesis holds: cost follows the number of attributes and text nodes.

**Fact: the Node build does less work per string** (`react-dom-server.node.production.js`). `stringToChunk` is the identity there and was compiled away (zero call sites; `pushTextInstance` at line 694 pushes the string itself). `writeChunk` (lines 53–113) writes a string straight into the 4,096-byte view with `textEncoder.encodeInto(chunk, target)`: no intermediate array and no copy. Upstream `main` shows the same split ([ReactServerStreamConfigNode.js](https://github.com/facebook/react/blob/main/packages/react-server/src/ReactServerStreamConfigNode.js)).

**Fact: legacy `renderToString` never encodes.** In `react-dom-server-legacy.browser.production.js`, `renderToStringImpl` (line 6915) collects output with `result += chunk`, and `pushStringAttribute` (line 513) pushes plain strings.

**Inference: what that means for one Bill row.** By my count of the JSX in `app/routes/open-bills.tsx`, a row is 8 elements carrying 10 attributes (`data-bill-id`; `href`, `class` and `data-discover` on the link; six `class`) and 4 text nodes: 24 `TextEncoder.encode` calls and about 78 chunk copies. Two hundred rows are about 4,800 encodes and 15,600 copies, which is consistent with `TextEncoder.encode` being the largest self-time item in profile B.

**Is this a known cost? Fact.**

- React's own docs say of the Web Streams APIs: "Node.js also includes these methods for compatibility, but they are not recommended due to worse performance. Use the dedicated Node.js APIs instead." ([react.dev, Server APIs](https://react.dev/reference/react-dom/server)).
- The Node path got `encodeInto` in [facebook/react#24291](https://github.com/facebook/react/pull/24291) (merged April 11, 2022), which reports, under `autocannon -c 5 -d 30`: before "2249ms, 2 req/sec"; after buffering "250ms, 20 req/sec"; after `encodeInto` "146ms, 34 req/sec", because it "allows us to write directly to the view buffer that will end up getting streamed instead of encoding into an intermediate buffer and then copying that data". The Edge config still does the intermediate encode and copy.
- [facebook/react#36139](https://github.com/facebook/react/pull/36139), "[Fizz] Reduce chunk push overhead in HTML serialization" (opened March 25, 2026), proposed "`pushStringAttribute`: 5 pushes → 1 concatenated string push" and measured +27% to +55% operations per second with `renderToPipeableStream` on Node v24. A React maintainer answered "If you open a change with just the attribute improvements I think we can land that." It was closed as stale on July 5, 2026 and is not in 19.3.0.
- Cloudflare, on Web Streams and SSR: "Streaming SSR is a particularly painful case. A typical SSR stream might render thousands of small HTML fragments"; "I've seen SSR workloads where garbage collection accounts for a substantial portion (up to and beyond 50%) of total CPU time per request"; "Developers sometimes find that buffering the entire response is actually faster than streaming through Web streams" ([Cloudflare blog, February 27, 2026](https://blog.cloudflare.com/a-better-web-streams-api/)).

**The 2025 Cloudflare post on CPU benchmarks — Fact.** [Unpacking Cloudflare Workers CPU Performance Benchmarks](https://blog.cloudflare.com/unpacking-cloudflare-workers-cpu-performance-benchmarks/) (Kenton Varda, October 14, 2025) answered an independent benchmark in which "initial results showed Cloudflare Workers performing worse than Node.js on Vercel at a variety of CPU-intensive tasks, by a factor of as much as 3.5x". What Cloudflare found and changed: warm-isolate scheduling, so a request no longer waits behind a CPU-heavy one in the same isolate; V8 young-generation tuning from 2017, removed for an "approximately 25% boost"; needless buffer copies and stream adapters in OpenNext; a `JSON.parse` reviver slowdown, patched in V8; and, for the React SSR test, a benchmark error, since "when NODE_ENV is not set, React defaults to 'dev mode'". Its conclusion: "Cloudflare now performs on par with Vercel in every benchmark case except the one based on Next.js." On React it says the framework's streams are "value-oriented rather than byte-oriented" in places and that Cloudflare plans "to start submitting patches to Next.js and React". It names no React patch and gives no table of results after the fixes. The benchmark it answers, [t3dotgg/cf-vs-vercel-bench](https://github.com/t3dotgg/cf-vs-vercel-bench), is third-party; its README still shows the earlier figures (React SSR: Cloudflare 0.476 s mean, Vercel 0.138 s).

**What React's docs say about choosing an API — Fact.** `renderToReadableStream` is for "environments with Web Streams, which includes browsers, Deno, and some modern edge runtimes"; `renderToPipeableStream` for Node.js; `renderToString` and `renderToStaticMarkup` are "Legacy Server APIs for non-streaming environments" with "limited functionality compared to the streaming APIs" ([react.dev](https://react.dev/reference/react-dom/server)). "`renderToString` does not support streaming or waiting for data." and "If a component suspends, `renderToString` immediately sends its fallback as HTML." ([renderToString](https://react.dev/reference/react-dom/server/renderToString)).

**Caution on the 3.4× fit — Inference.** The multiplier compares a warm Node process on a developer laptop with Cloudflare's servers. It mixes hardware, JIT warmth in short-lived isolates and renderer build; it is not evidence that Workers is 3.4 times slower than another host.

### 3.3 What React Router adds, and its cheaper modes

**`<Link>` during server rendering — Fact.** `LinkWithRef` (`node_modules/react-router/dist/production/lib/dom/lib.js:287`) runs, for every link: a context read, `parseToInfo`, `useHref`, `useLocation`, `usePrefetchBehavior` (two `useState`, one `useRef`, two `useEffect`; `dom/ssr/components.js:28`), `useLinkClickHandler` (`useNavigate`, `useLocation`, `useResolvedPath`, `useCallback`; line 608) and `mergeRefs`; then it renders an `<a>` with an extra `data-discover="true"` attribute. `useHref` and `useLinkClickHandler` each call `useResolvedPath` (`hooks.js:530`), which runs `JSON.stringify(getResolveToMatches(matches))` on every call and `JSON.parse` plus `resolveTo` inside a `useMemo` that always computes on the server. So each link resolves its path twice.

**The hydration payload — Fact.** For a document request, `renderHtml` in `server-runtime/server.js:233` builds `serverHandoffStream: encodeViaTurboStream(state, ...)` from the loader and action data. The vendored turbo-stream `encode` flattens that data and enqueues `textEncoder.encode(...)` bytes. `ServerRouter` (`dom/ssr/server.js:32`) renders `StreamTransfer` (`dom/ssr/single-fetch.js:27`) inside `Suspense`; it reads those bytes, decodes them back to text and emits `<script>window.__reactRouterContext.streamController.enqueue(...)</script>` with `JSON.stringify` and `escapeHtml`, which React then encodes again. The data is in the response twice, once as markup and once as script, because the browser needs it to rebuild the same tree when it hydrates: "Loader data is automatically serialized from loaders and deserialized in components." (`node_modules/react-router/docs/start/framework/data-loading.md`).

**What a hydrated phone requests — Fact.** In `requestHandler` (`server-runtime/server.js:106`), a path ending in `.data` goes to `handleSingleFetchRequest`; only other paths reach `handleDocumentRequest`, the one place that calls the app's `entry.server.tsx`. A `.data` response is `new Response(encodeViaTurboStream(result, ...))` with `Content-Type: text/x-script` (`generateSingleFetchResponse`, `server-runtime/single-fetch.js:132`). No React rendering happens. The docs agree: "On data requests (`GET /route.data`) for client-side navigations, the handler is the `action`/`loader`, because that's all that is included in the response" (`docs/how-to/middleware.md`). A `<Form method="post">` in a hydrated page sends `POST <path>.data`; `singleFetchAction` runs the action with `skipRevalidation: true`, and the browser then revalidates the loaders with a `GET .data`. That is two Worker requests, two session rows and no HTML.

**A small fixed cost that is the template's — Fact.** `createRequestHandler` (`server-runtime/server.js:152`) calls `derive(_build, mode)` on every request when `build` is a function, rebuilding the route objects and the static handler each time. The app passes a function, as Cloudflare's template does. **Inference:** the whole `/healthz` request is 0.25 ms in profile B, so this is less than that.

**Modes that avoid a per-request server render — Fact.**

| Mode | What it does | Do server loaders and actions still work? |
| --- | --- | --- |
| SPA mode, `ssr: false` | "With this set to false, the server build will no longer be generated." | **No.** "You cannot include a `loader` in any other routes in your app when using SPA Mode", and "`headers`/`action` functions are prohibited in all routes because there will be no runtime server on which to run them" (`docs/how-to/spa.md`, `docs/how-to/pre-rendering.md`). This app's loaders and actions talk to D1, so it would need a separate API, which spec §3.1 rules out |
| Pre-rendering | "a build-time operation that generates static HTML and client navigation data payloads for a list of URLs" (`docs/start/framework/rendering.md`) | Only at build time for the listed paths. Every screen here depends on who is signed in and on live data; only Entrar could be pre-rendered |
| `clientLoader` with `HydrateFallback`, under `ssr: true` | "Routes can also use client data loading with `clientLoader` to avoid server rendering/fetching for their portion of the UI." (`rendering.md`). With `clientLoader.hydrate = true` and a fallback, the server renders the fallback and the browser renders the route from `serverLoader()` (`docs/how-to/client-data.md`) | **Yes.** `ServerRouter` drops that route's data from the render but it stays in the payload (`dom/ssr/server.js:36–42`). The first paint is a skeleton and the route no longer works without JavaScript |
| React Server Components | "React Server Components support is experimental and subject to breaking changes in minor/patch releases." (`docs/how-to/react-server-components.md`) | Unstable in 8.4.0 (`unstable_reactRouterRSC`); not an option for an app that must not be an experiment |

Cloudflare adds a limit of its own: "SPA mode and prerendering are not currently supported when using the Cloudflare Vite plugin." ([React Router guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/), last updated Jun 19, 2026). React Router 8.0.0 changed how pre-rendering is built (`@react-router/dev` changelog); whether Cloudflare's sentence still holds for 8.4.0 with plugin 1.62.5 is **unverified** and was not tested.

**`renderToPipeableStream` on Workers.** **Fact:** it is not reachable through `react-dom/server` under the `workerd` condition; `react-dom/server.node` is a separate export whose build requires `util`, `crypto`, `async_hooks` and `stream` (lines 12–17). Cloudflare lists those Node APIs as supported and enables Node compatibility by default "For compatibility dates of `2026-08-04` or later" ([Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)); this repo's date is 2026-10-01. Neither React nor Cloudflare documents the combination. **Measured locally (§3.4):** the Node build rendered a standalone list inside a local workerd and cost 27–37% less than the Workers build. **unverified:** that it works inside React Router's `entry.server.tsx`, and that the gain holds on Cloudflare. **Inference:** `renderToString` is not a drop-in either: `StreamTransfer` suspends until the payload stream is read, and `renderToString` "immediately sends its fallback as HTML", so the hydration data would never reach the browser.

**What Cloudflare's template uses — Fact.** [cloudflare/templates, react-router-starter-template](https://github.com/cloudflare/templates/blob/main/react-router-starter-template/app/entry.server.tsx) calls `renderToReadableStream` from `react-dom/server`, and its `workers/app.ts` passes `() => import("virtual:react-router/server-build")`. React Router's own default for non-Node runtimes is the same (`node_modules/@react-router/dev/dist/config/defaults/entry.server.web.tsx`). This app follows the template; it differs only in using the `@react-router/cloudflare` wrapper, which calls the same handler.

#### Document render versus the data request a navigation makes (added by the lead)

**Method.** The built server bundle loaded in Node 24.21, with SQLite standing in for D1 and the seeded year loaded; 100 warm-up requests, then the median of 300, the two forms interleaved. SQLite's own time is included, which Cloudflare does not charge to the Worker. A laptop, warm: read the ratios.

| Screen | Document (ms) | `.data` request (ms) | Ratio | Bytes, document → data |
| --- | --- | --- | --- | --- |
| Vender | 0.73 | 0.31 | 2.4× | 39,129 → 5,636 |
| Cuentas abiertas, 200 Open Bills | 2.89 | 0.93 | 3.1× | 176,730 → 39,127 |
| A Customer's page, 30 Open Bills | 0.92 | 0.37 | 2.5× | 40,255 → 6,260 |
| Día, busiest Day | 0.75 | 0.40 | 1.9× | 30,754 → 5,232 |
| Cuentas, 50 rows | 1.19 | 0.52 | 2.3× | 53,629 → 9,853 |
| Inventario | 1.35 | 0.53 | 2.6× | 79,899 → 16,483 |
| Historial, 50 rows | 1.57 | 0.89 | 1.8× | 43,830 → 9,707 |
| Ten-Item selection with Payment (POST) | 0.94 | 0.38 | 2.5× | 39,742 → 397 |
| Mi día, a small page | 0.49 | 0.19 | 2.6× | 11,533 → 948 |
| Usuarios, a small page | 0.44 | 0.14 | 3.1× | 16,333 → 1,101 |
| Diferencias (not in the proof) | 3.30 | 1.39 | 2.4× | 196,348 → 45,648 |
| Por cobrar (not in the proof) | 1.67 | 0.45 | 3.7× | 85,549 → 13,626 |
| `/healthz` (no session, no HTML) | 0.17 | — | — | 11 |

**Reading it.**

- A document costs 1.8–3.7 times the data request for the same screen. The proof times only documents.
- The smallest signed-in document costs about 0.45 ms here against 0.17 ms for `/healthz`: the shell, the session and the hydration scaffolding are a fixed cost of every document.
- Two screens outside the proof are heavier than most of the nine. Diferencias renders the seeded year's 12 Counts with every Item, 720 rows and 196 KB, and `RECENT_COUNTS` in `app/backend/counts.ts` lets it show 20; Por cobrar renders 126 rows, 86 KB. Both are bounded, as spec §2.4 asks, and both are large.
- These are local figures. What a data request costs on Cloudflare has not been measured.

### 3.4 Alternatives that would keep a Worker and D1

"Workers support" means a first-party statement, not reputation. No row has a first-party rendering benchmark on workerd.

| Option | How server output is produced, per its own docs or source | Workers support | Benchmark with numbers |
| --- | --- | --- | --- |
| React 19.3, `renderToReadableStream` (today) | Element tree to one byte chunk per string, copied into 4,096-byte views (§3.2) | Cloudflare's template | Ours: tables A and B, and the benchmark below |
| React, Node build | Strings written with `encodeInto` into the view (§3.2) | Not exported under `workerd`; importable as `react-dom/server.node` with Node compatibility, where it ran in a local workerd. **unverified** inside React Router's entry and on Cloudflare | [react#24291](https://github.com/facebook/react/pull/24291): 20 to 34 req/sec on Node from `encodeInto`. Locally, 27–37% cheaper than the Workers build |
| [Hono `hono/jsx`](https://hono.dev/docs/guides/jsx) | String concatenation: `JSXNode.toStringToBuffer` appends with ``buffer[0] += `<${tag}` `` ([src/jsx/base.ts](https://github.com/honojs/hono/blob/main/src/jsx/base.ts)) | Listed in [Cloudflare's framework guides](https://developers.cloudflare.com/workers/framework-guides/) | None on its JSX guide; measured below |
| [Preact with `preact-render-to-string`](https://github.com/preactjs/preact-render-to-string) | "Render JSX and Preact components to an HTML string."; stream variants also exist | A library; no adapter needed | None in the README; the repo has a `benchmarks` directory. Measured below |
| [SvelteKit](https://svelte.dev/docs/kit/adapter-cloudflare) | `render` from `svelte/server` "Returns an object with `body` and `head` properties" ([docs](https://svelte.dev/docs/svelte/svelte-server)) | "To deploy to Cloudflare Workers or Cloudflare Pages, use `adapter-cloudflare`." | None in the docs |
| [SolidStart](https://docs.solidjs.com/solid-start/reference/server/create-handler) | Modes `"sync"` (`renderToString`), `"async"` and `"stream"` (default); `renderToString` "renders HTML to a string synchronously on the server" ([docs](https://docs.solidjs.com/reference/rendering/render-to-string)) | "Solid" is in Cloudflare's framework guides | None in the docs |
| [Astro](https://docs.astro.build/en/guides/integrations-guide/cloudflare/) | Not read from source | "This adapter allows Astro to deploy your on-demand rendered routes and features to Cloudflare"; in Astro 6 `astro dev` runs in workerd | None in the docs |
| Template strings, with [htmx](https://htmx.org/docs/) if wanted | String concatenation by construction; with htmx "on the server side you typically respond with HTML, not JSON" | Any Worker | Measured below |
| [TanStack Start](https://tanstack.com/start/latest/docs/framework/react/guide/hosting) | React's renderer, so the per-string cost is unchanged (**Inference**; not read from its source). It can skip rendering per route: `ssr: 'data-only'` runs the loader on the server and will "Disable server-side rendering of the route component" ([Selective SSR](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr)); in SPA mode "No SSR doesn't mean giving up server-side features!" ([SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode)) | Cloudflare is one of its "Official Hosting Partners"; setup "uses Vite through `@cloudflare/vite-plugin`" | None in the docs |
| [Remix 3](https://github.com/remix-run/remix) | Its own "Component runtime with server rendering and browser hydration", not React | The README says its packages "work seamlessly across Node.js, Bun, Deno, Cloudflare Workers"; the repo is "under active development". ADR 0005's two blockers were not re-checked: **unverified** | None |

**Third-party but reproducible, on Node, with string APIs.** Platformatic's [SSR performance showdown](https://blog.platformatic.dev/ssr-performance-showdown) ([repository](https://github.com/platformatic/ssr-performance-showdown)) rendered a page of 2,398 `div` elements on a "2020 MacBook Air M1 with 8GB RAM, Node v22" and reports requests per second: fastify-html 1,088; Vue 1,028; Svelte 968; Solid 907; Preact 717; React 572 (React 19 RC, `renderToString`); EJS 443. Author and date were not shown on the page. It is not workerd, not streaming and not React's Workers build, so it bounds nothing here; it suggests that, on Node, template strings are about twice React's string renderer rather than ten times. The local benchmark below, on this app's attribute-heavy rows, measured 4.5 times.

**Inference.** Every row that is not React replaces the client as well: React Router's client-side navigation, pending UI and optimistic updates (spec §3.4) come from the same framework that renders on the server. A string renderer makes the server cheap by making that part yours to rebuild. TanStack Start keeps React; its `ssr: 'data-only'` is the same idea as React Router's `clientLoader` with a fallback (§3.3), so moving to it would change the framework without changing the renderer.

#### Local renderer benchmark (added by the lead)

**Method.** The Cuentas abiertas list as `app/routes/open-bills.tsx` marks it up, 9 attributes and 4 text nodes per row, with a plain `<a>` in place of React Router's `<Link>`, built as one tree and given to each renderer. Every variant ends in response bytes, and the six full-markup variants produce byte-identical output: 32,289 bytes for 50 rows and 129,065 for 200. Versions: react and react-dom 19.3.0, as the app; preact 11.0.0 with preact-render-to-string 6.8.0; hono 4.13.13; production builds. In Node 24.21: 300 warm-up renders, then the median of 400. In workerd: a scratch Worker run by wrangler 4.147.0's local runtime, `compatibility_date` 2026-10-01 with `nodejs_compat`, 40 renders per request, timed from outside with the time of an empty request subtracted, median of 25. A laptop with a warm JIT: read the ratios, not the absolute figures.

| µs per render | Node, 50 rows | Node, 200 rows | workerd, 50 rows | workerd, 200 rows |
| --- | --- | --- | --- | --- |
| React `renderToReadableStream` from `react-dom/server.edge` (what the app runs) | 294 | 1,015 | 425 | 1,484 |
| React `renderToPipeableStream` from `react-dom/server.node` | 177 | 808 | 266 | 1,085 |
| React `renderToString`, then one encode | 84 | 424 | 85 | 365 |
| Preact `renderToString`, then one encode | 99 | 398 | 91 | 352 |
| Hono `hono/jsx` to a string, then one encode | 115 | 452 | 113 | 419 |
| A hand-written template string with escaping, then one encode | 25 | 95 | 22 | 80 |
| React Workers build, lean rows (1 attribute and 4 text nodes per row, styled by structure) | 98 | 333 | 111 | 530 |
| React Node build, lean rows | 77 | 272 | 101 | 349 |

**Reading it.**

- React's rendering is not slow. `renderToString` costs what Preact and Hono's JSX cost on the same tree.
- The streaming byte path is what costs. In workerd, `renderToReadableStream` takes 4.1 times as long as React's own `renderToString` for the same 200 rows, and 18 times a template string. The string renderers cost the same in Node and in workerd; the two streaming ones are 34–50% slower in workerd than in Node.
- React Router needs a streaming API (§3.3), so the app cannot simply call `renderToString`.
- Two levers exist inside React. The Node build is 27–37% cheaper than the Workers build in workerd. Rows with fewer attributes are 2.8–3.8 times cheaper, which is what §3.2's source reading predicts: 22 encodes per row become 6.
- Row count is the third lever: 50 rows cost 3.5 times less than 200.
- What this does not show: Cloudflare's hardware, cold isolates, or a whole request. The render is 40–55% of a request (profile B), so a renderer four times faster would remove about a third to two fifths of a request's CPU, not three quarters.

### 3.5 Our doing versus inherent

Only what the sources above support.

| Item | Whose | Evidence | What changes it |
| --- | --- | --- | --- |
| 6–18 ms of CPU for a server-rendered page | Inherent to SSR; normal anywhere without a 10 ms cap | Cloudflare: SSR "typically use 10-20 ms" (§2.1). Elsewhere the same work is a rounding error: at 18 ms a request, Vercel Hobby's "4 CPU-hrs" is 800,000 requests a month and Workers Paid's 30 million CPU-ms is 1.67 million | Nothing needs to, off Workers Free |
| One encode and one copy per attribute name, attribute value and text node | Inherent to React's Workers build | §3.2; 14% self time on Cuentas abiertas (profile B) | Fewer elements and attributes; another renderer; upstream change |
| `<Link>` resolving its path twice | Inherent to React Router 8.4 | §3.3; 17% on the 200-row list (profile B) | Fewer links per page, by paging |
| Loader data sent as HTML and as a payload | Inherent to hydrating SSR | §3.3; about 12% (profile B) | `clientLoader` with a fallback sends it once |
| Server build evaluated in the first request of an isolate | Inherent to Cloudflare's template | §3.1; cold requests at 15–27 ms | A static import would move it to startup; its accounting is undocumented |
| An unpaged list of 200 Open Bills | **Ours** | 17.67 ms and 177 KB; the 50-row page of Cuentas is 7.60 ms. Spec §2.4: "long lists are paged" | Page it at 50 |
| Document POSTs that answer with a page | **Ours** | `action` in `app/routes/home.tsx:135` returns data, so a document POST re-renders Vender: 10.35 ms against 6.47 ms for the GET. The Count, which answers 302, is 4.96 ms with the largest write of the nine | Redirect after a document POST. The limit is per request, so a 5 ms POST followed by a 6.5 ms GET passes where one 10.35 ms request does not |
| The proof times full documents | **Ours** | After first load a phone sends `.data` requests, which render no HTML (§3.3). The gate measures the most expensive form of each request: locally a document costs 1.8–3.7 times its data request | Time `.data` requests as well, and decide which the gate means |
| Two heavy screens outside the proof | **Ours** | Diferencias (720 rows, 196 KB) and Por cobrar (126 rows, 86 KB) cost more locally than most of the nine requests (§3.3) | Page or trim them; decide whether the gate covers them |
| A D1 write on every request | **Ours** | §1 C. It costs rows, not CPU: 3,000 requests are 3,000 rows a day, more than a busy Day's business writes, and it turns a write-quota block into a total outage | Touch the session only when `last_used_at` is older than some hours |
| Rebuilding the static handler on every request | The template's | §3.3 | Under 0.25 ms in Node; not worth acting on first |

**Inference on the gate.** Spec §10.7 asks for a median under 10 ms on document requests. That is the spec's own bar. It is not Cloudflare's rule, which has no median in it, and it is not what a hydrated phone sends. It is stricter than what was enforced today and it still does not tell us what will be enforced tomorrow.

## 4. Question 3 — tests versus provider limits

### 4.1 D1 accounting

**Fact**, from [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [D1 metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/):

- Rows read: "Rows read measure how many rows a query reads (scans), regardless of the size of each row." A full scan of a 5,000-row table "would count as 5,000 rows read". "Row size or the number of columns in a row does not impact how rows are counted."
- Rows written: "Rows written measure how many rows were written to D1 database. Write operations include `INSERT`, `UPDATE`, and `DELETE`."
- Indexes count: "Indexes will add an additional written row when writes include the indexed column, as there are two rows written: one to the table itself, and one to the index."
- Per query: "Every query returns a `meta` object that contains a total count of the rows read (`rows_read`) and rows written (`rows_written`) by that query." and "Row counts are a precise count of how many rows were read (scanned) or written by that query."
- Wrangler and the dashboard count: "Yes, any queries you run against your database, including inserting (`INSERT`) existing data into a new database, table scans (`SELECT * FROM table`), or creating indexes count as either reads or writes." An import with `wrangler d1 execute --file` is therefore writes; ours reported 71,084.
- Limits, reset, scope and failure: as in §2.1. "Metrics can be queried (and are retained) for the past 31 days."

**Not documented.** How `UPDATE ... RETURNING` is counted, and how quickly a daily limit takes effect. **Measured locally (§4.3):** the local D1 reports one row written for the session `UPDATE ... RETURNING`.

**Inference from the busy-Day figure.** A model that counts one row for the table plus one for every index entry written, the implicit index of a `TEXT PRIMARY KEY` included, one row for an upsert that updates, and one row for a session touch, predicts 1,792 rows for the busy Day's 69 requests and ten page reads. Cloudflare reported 1,793. So the primary-key index counts, an `UPDATE` that sets `state` rewrites the two indexes that hold it, and the session `UPDATE ... RETURNING` is one row written. A side finding: `INDEX_ENTRIES` in `app/backend/seed.ts:395` gives `counts` and `count_lines` 2 entries each, but migration 0013 adds an index to each, and the busy-Day figure reconciles only with 3.

### 4.2 What is local and costs nothing

**Fact: Cloudflare's local development is a simulator.** "All resources your Worker is bound to in your Wrangler configuration are simulated locally." The exception is opt-in: "Remote bindings are bindings that are configured to connect to the deployed, remote resource during local development instead of the locally simulated resource.", and "Interactions with remote Cloudflare services through these connections will incur standard operational costs for those services (such as KV operations, R2 storage/operations, AI requests, D1 usage)." ([Local development](https://developers.cloudflare.com/workers/development-testing/), last updated August 20, 2026). For D1: "Note that `wrangler dev` separates local and production (remote) data. A local session does not have access to your production data by default." ([D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/)).

**Fact: this repo's D1 binding is not remote.** `wrangler.jsonc` sets no `remote` key on `DB`; the schema describes that key as "Whether the D1 database should be remote or not in local development" (`node_modules/wrangler/config-schema.json`). The top-level database id is all zeros and "only names the local SQLite file".

**Fact: the test tools are the ones Cloudflare recommends, and they are local.** "For most projects, use the Workers Vitest integration for unit tests and the `createTestHarness()` API for integration tests." ([Workers testing](https://developers.cloudflare.com/workers/testing/), last updated Jul 27, 2026).

- Vitest: the package is `@cloudflare/vitest-plugin`, 1.3.6 installed; Cloudflare's docs name it as the successor of `@cloudflare/vitest-pool-workers`. It "Runs tests fully-locally using Miniflare" and "Implements isolated per-test-file storage" ([Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)). Its `remoteBindings` option defaults to `true` (`dist/pool/index.mjs:64294`), but `pickRemoteBindings` (line 62506) selects only bindings that set `remote` or have no local simulator, so D1 stays local here. `applyD1Migrations` "Applies all un-applied `migrations` to database `db`" (`types/cloudflare-test.d.ts`); `tests/support/setup.ts` calls it against the local binding.
- Playwright: wrangler's typings describe `createTestHarness` as "Creates a local test server for running Workers." and say of `reset()` that "Storage is recreated" (`node_modules/wrangler/wrangler-dist/cli.d.ts:1097` and `:1040`). `e2e/fixtures.ts` gives it the built config, `build/server/wrangler.json`, which also has no remote binding.

**Fact: what each npm script touches.**

| Script | Talks to Cloudflare? | What it costs the account |
| --- | --- | --- |
| `dev` | No. Vite with workerd and the local D1 under `.wrangler/` | Nothing |
| `build`, `build:production` | No | Nothing |
| `typecheck` | No | Nothing |
| `test`, `test:watch` | No. workerd through Miniflare, a local D1 per test file | Nothing |
| `test:e2e` | No. A local test server and a local D1 per test | Nothing |
| `verify` | No. It is `typecheck` and `test` | Nothing |
| `db:migrate`, `seed`, `seed:local`, `projections:verify`, `projections:rebuild`, `sign-in-code` | No. Each passes `--local`, or only writes `seed.sql` | Nothing |
| `db:migrate:production` | **Yes**, `--env production --remote` | Rows written for each table and index created |
| `seed:production` | **Yes**, a remote import of `seed.sql` | **71,084 rows written**, 71% of a Free day |
| `projections:verify:production` | **Yes**, remote reads | Rows read in proportion to the whole history |
| `projections:rebuild:production` | **Yes**, remote writes | Rows written for every projection it rewrites |
| `sign-in-code -- --production` | **Yes** | A few rows |
| `deploy:production` | **Yes**, uploads the Worker | No rows, no requests |
| `proof` | Only what its `--url` points at. A deployed Worker: **yes**. `http://localhost:5173`: no | Against a deployment, about 334 rows written per run of the nine requests (§4.3), and Worker requests |

Two facts about the working tree today. `wrangler.jsonc` has an uncommitted change that points `env.production` at the disposable proof database in the developer's personal account, so every `:production` script acts on that account until it is reverted. And the repo has **no CI configuration at all**: no `.github`, no other pipeline file; spec §3.6 says "There is no CI."

**What local runs cannot show.** Cloudflare's CPU metric, and the limit: "Limits are only enforced when deployed to Cloudflare's network, not in local development." ([Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)). CPU time on Cloudflare's hardware is the only part of §10.7 that needs a deployment.

### 4.3 What hit the limit today

**Rows written per request — Inference from the schema, checked against the busy Day** (§4.1) and confirmed by the local measurement below:

| Request | Rows written | How |
| --- | --- | --- |
| Each of the six reads | 1 | The session touch |
| Ten-Item selection with Payment | 74 | 1 session; 5 for the Bill (row, primary-key index, 3 indexes); 10 Lines × 5; 10 Stock upserts; 5 for the Payment; 3 for the Bill update (row and the 2 indexes holding `state`) |
| Abonar, as scripted (one Payment) | 10 | 1 for the page read and 1 for the POST's session; 5 for the Payment; 3 for the Bill update |
| Count of 60 Items | 244 | 1 session; 3 for the Count; 60 Count lines × 3; 60 Stock upserts |
| **One run of all nine** | **334** | The Count is 73% of it, the sale 22% |

**The day, in UTC, from the result files' timestamps:**

| Time | Event | Rows written | Running total |
| --- | --- | --- | --- |
| about 15:18 | Seed import | 71,084 (reported) | 71,084 |
| 15:19:54–15:20:29 | Pass of 21 runs | 21 × 334 = 7,014 | 78,098 |
| 15:22:12–15:23:42 | Pass of 50 runs | 16,700 | 94,798 |
| 15:23:53–15:24:11 | Busy Day | 1,793 (reported) | 96,591 |
| 15:28:02–15:28:42 | Pass of 21 runs | 7,014 | **103,605** |
| 15:29:47–15:32:30 | Pass of 100 runs | 33,400 | **137,005** |
| minutes later | Every write refused | | |

Not counted: an earlier runner execution whose results were overwritten ("run 1" in ticket 22), which adds about 7,000 if it completed; and the migrations, sign-ins and sign-in codes, which are tens of rows.

**Findings.**

- The limit was exhausted by the proof kit, not by the app: about 137,000 rows against 100,000, or 76 busy Days of writes in fifteen minutes.
- The seed alone is 71% of a Free day. The kit run once as designed (seed, one 21-run pass, busy Day) is about 79,900 rows and fits. Running the passes four times did not: the 100-run pass by itself is a third of a day.
- By this model the account went over at about 15:28:30, during the Counts of the third recorded pass. The 100-run pass then wrote about 33,400 more rows without a failure. Enforcement lagged by at least four minutes; if the uncounted first execution completed, by longer.
- The limit is account-wide. For the rest of the UTC day no D1 database on the developer's personal account can be written, whatever app it belongs to.
- That account holds another project's production database (added by the lead). `wrangler d1 list` on 2026-10-06 shows `gamo-cafe-proof` beside `mdwn-db-production` and four more databases. So the proof took that project's production writes down with it, from some time after 15:32 UTC until 00:00 UTC; the live site was not checked. It was the second day running: that project's docs say of 2026-10-05 UTC that a restore rehearsal "was blocked by the account's D1 Free daily row-write limit (error code `7500`, shared with production Cron writes)" (`~/coding/mdwn/docs/operations.md`).
- Every limit either project reached on 2026-10-05 and 2026-10-06 was reached by a proof or a rehearsal: two D1 write blocks and the `exceededCpu` 503s of §2.1. None was reached by ordinary use (added by the lead).
- The app turned "cannot write" into "cannot open": `authenticate` is an `UPDATE`, so every signed-in request answered 500.

#### Rows written per proof request (added by the lead)

**Method.** A temporary copy of `tests/proof-budget.test.ts` that reported the counting D1's figures for each request, in the local workerd D1 with the whole year loaded. The copy was removed afterwards.

| Request | Statements | Rows read | Rows written |
| --- | --- | --- | --- |
| Vender | 2 | 185 | 1 |
| Ten-Item selection with Payment | 9 | 351 | 74 |
| Cuentas abiertas | 2 | 517 | 1 |
| Pay a Customer with 30 Open Bills (one centavo) | 9 | 1,298 | 9 |
| Día for the busiest Day | 4 | 919 | 1 |
| A page of Cuentas | 2 | 518 | 1 |
| Inventario | 3 | 440 | 1 |
| A Count of every Item | 6 | 249 | 244 |
| A page of Historial | 7 | 1,514 | 1 |
| **The nine together** | | **5,991** | **333** |

**Reading it.**

- The measurement matches the model above row for row: 333 for the nine, and 334 with the Customer page the runner reads before each Abonar.
- A read-only request writes exactly one row, the session touch. The six of them cost 6 rows a run; the Count costs 244 and the sale 74.
- With no import that day, the Free limit allows 299 runs of the nine. On the import's day it allows 86.
- The nine read 5,991 rows a run, so 192 runs are 1.15 million rows read before counting the Customer page read ahead of each Abonar: about a quarter of the daily 5 million. Rows written is the quota a proof exhausts.

### 4.4 Keeping proof runs apart from ordinary tests

**What primary sources recommend — Fact.**

- Local simulators for tests: the Vitest integration and `createTestHarness`, quoted in §4.2. This repo already does exactly that.
- Separate resources per environment: "To protect production data, you can create a development or staging environment and specify different resources in your Wrangler configuration than you would use for production." ([Local development](https://developers.cloudflare.com/workers/development-testing/)); D1 shows a different `database_id` per environment ([D1 environments](https://developers.cloudflare.com/d1/configuration/environments/)); for previews, "To isolate KV, D1, R2, or another account-level resource, bind the Preview to a separate resource." ([Cloudflare changelog](https://developers.cloudflare.com/changelog/post/2026-09-22-worker-previews/)). A separate database protects data. It does not protect quota, which is per account.
- Separate accounts: "Use profiles when you work across more than one Cloudflare account on the same machine"; "keep staging and production in different accounts, then bind a profile to each. Pair a profile with an `account_id` in your Wrangler configuration file so a command cannot reach the wrong account." ([Wrangler authentication profiles](https://developers.cloudflare.com/workers/wrangler/profiles/), last updated Aug 12, 2026).
- Benchmarks are allowed: "You are permitted to perform benchmark tests of our Services." ([Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/) §2.2.2). The same agreement forbids scripts that "produce multiple accounts" (§2.2.1(e)); one account for Gamo and one for proofs, each made by hand, is not that.
- Undo: `wrangler d1 time-travel restore YOUR_DATABASE --timestamp=UNIX_TIMESTAMP` returns a database to a minute within the last 7 days on Free ([Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)). It restores data, not quota.
- I found no Cloudflare page on load testing Workers or D1.

**On a paid plan — Fact.** There are no daily D1 limits, so a runaway run is a bill, not an outage: "$1.00 / million rows" written beyond 50 million a month and "$0.001 / million rows" read beyond 25 billion ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)). **Inference:** today's 137,000 rows are 0.27% of the included writes; a dollar of overage takes a million rows beyond the first 50 million, about 4,100 Counts of every Item. The alert that would tell you arrives the next day (§2.2).

**Recommendation.**

1. **Leave ordinary tests as they are.** They cannot reach a provider limit. Keep it so by never setting `remote: true` on the D1 binding and never adding a `:production` script to `verify`.
2. **Treat the proof as a release gate run by hand, never as a test.** It already is a separate script. If CI is added one day, it runs `verify` and `test:e2e` only.
3. **Give the proof an account of its own**, neither Gamo's nor one holding another live D1 database, with a Wrangler profile and a pinned `account_id` so a `:production` script cannot land in the wrong place. After launch the production account's quota is the cafeteria's working day.
4. **Budget the run before starting.** Seed 71,084, plus 334 per run of the nine requests, plus 1,793 for the busy Day. Seed on one UTC day and measure on the next, or seed once and keep the database: later passes then cost about 7,000 rows per 21 runs.
5. **Spend the remote run on CPU only, and spend rows where they buy precision.** The spec asks for at least 20 runs. Twenty-one-run medians moved by several ms between passes (Historial: 10.31 and 14.92 in table A), so more runs of a request near the line are worth having; but a read-only request costs one row a run while the Count costs 244. A hundred runs of the six reads are 600 rows; twenty-one runs of the three writers are about 6,900. The runner takes one `--runs` for all nine today, so this needs a count per request. Statements, rows read and rows written per request are measured locally from `meta` by `tests/proof-budget.test.ts`, at no cost.
6. **Rehearse locally first.** `npm run dev` with `npm run proof -- --url=http://localhost:5173` runs the whole kit against the local D1, as the README says. It shows failures and row counts, not CPU.
7. **Make the app survive a write block.** If the session is touched only when it is hours old, an exhausted quota stops sales being recorded but staff can still read Bills, and 3,000 daily writes go away.

Other providers' equivalents matter only for options that survive §2.3. Turso's free quota is monthly rather than daily ("10 Million" rows written), which removes the one-afternoon failure but not the need to keep proofs out of the production database.

## 5. Open questions / unverified

**Contradicted by a live page or by source.**

- The hypothesis that React's Workers build copies into a 2 KB view: the installed build and upstream `main` use 4,096 bytes (§3.2).
- The brief's "30 Payments across 30 Bills": the scripted Abonar request writes one Payment. §1 D is corrected, and the busy-Day figure and the local measurement agree (§4.3).
- The 2026-09-15 research for another project: Neon Free storage is now "1 GB/project, 20 GB account total", not 0.5 GB; Fly's `shared-cpu-1x` 256 MB is $2.19 a month, not about $2.02. Its Vercel and Netlify entries, then unverified, are now sourced (§2.3).
- Startup time: a Cloudflare post of September 2025 says 400 ms; the limits page now says 1 second (§3.1).
- Nothing in spec §2.4's table is contradicted.

**Unverified.**

- The size of Cloudflare's CPU "flexibility" and "rollover", and whether enforcement differs for low-traffic Workers. Undocumented. The community thread that discusses it refused the fetch (HTTP 403).
- Whether start-up CPU is charged to the first request, and how a dynamic `import()` in a handler is accounted. Undocumented.
- How fast D1 enforces a daily limit. Whether reads keep working for the rest of the day once only the write limit is passed: they did for the minutes observed (§2.1), and the docs say "you will not be able to run queries against D1".
- Whether the other project's live site actually refused writes this afternoon. Its production database is in the blocked account (§4.3); nobody looked at the site.
- How production D1 counts `UPDATE ... RETURNING`. The local D1 reports one row written (§4.3), and the model in §4.1 fits Cloudflare's busy-Day total at one.
- Whether "SPA mode and prerendering are not currently supported" still holds for React Router 8.4.0 with `@cloudflare/vite-plugin` 1.62.5. Not tested.
- Whether React's Node build (`react-dom/server.node`, `renderToPipeableStream`) works inside React Router's `entry.server.tsx` on Workers, and whether its local gain of 27–37% (§3.4) holds on Cloudflare.
- What a `.data` request costs on Cloudflare. It is measured locally only (§3.3).
- Why Cloudflare's CPU is about 3.3 ms plus 3.4 times the Node figure. Not established.
- Render's instance prices ($7 Starter, $6 Postgres): the pricing page is drawn by script; the figures come from a search snippet. Hetzner's and Cloudflare's marketing pricing pages were unreadable for the same reason; the figures used come from their documentation pages.
- Whether Oracle requires a card at sign-up (its FAQ refused the fetch), and whether a card is required for Vercel, Netlify, Deno Deploy, Render, Koyeb or Supabase free plans: not stated on the pages read.
- Per-request CPU limits on Deno Deploy: none stated on its pricing page.
- ADR 0005's two reasons against Remix 3 on Workers. Not re-checked.
- The memory and CPU a Node build of this app would use on Railway or Fly. The figures in §2.4 are assumptions.
- The earlier runner execution whose results were overwritten: its row count is unknown.

**Blocked by a denied tool call.** None. Some fetches failed for reasons that were not permissions: `community.cloudflare.com` and `oracle.com/cloud/free/faq` returned 403; `render.com/pricing`, `hetzner.com/cloud` and `cloudflare.com/plans/developer-platform` returned pages without their figures; `cloud.google.com/run/pricing` was truncated, so Cloud Run's figures come from Google's free-tier page; the Cloudflare template is no longer in `remix-run/react-router-templates` (404) and was read from `cloudflare/templates`.

## Sources (primary)

All accessed 2026-10-06.

**Cloudflare**

- <https://developers.cloudflare.com/workers/platform/limits/>
- <https://developers.cloudflare.com/workers/platform/pricing/>
- <https://developers.cloudflare.com/workers/observability/metrics-and-analytics/>
- <https://developers.cloudflare.com/workers/observability/errors/>
- <https://developers.cloudflare.com/workers/reference/how-workers-works/>
- <https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/>
- <https://developers.cloudflare.com/workers/wrangler/configuration/>
- <https://developers.cloudflare.com/workers/wrangler/environments/>
- <https://developers.cloudflare.com/workers/wrangler/profiles/>
- <https://developers.cloudflare.com/workers/wrangler/commands/d1/>
- <https://developers.cloudflare.com/workers/development-testing/>
- <https://developers.cloudflare.com/workers/testing/>
- <https://developers.cloudflare.com/workers/testing/vitest-integration/>
- <https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/>
- <https://developers.cloudflare.com/workers/testing/test-harness/>
- <https://developers.cloudflare.com/workers/best-practices/workers-best-practices/>
- <https://developers.cloudflare.com/workers/framework-guides/>
- <https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/>
- <https://developers.cloudflare.com/workers/runtime-apis/nodejs/>
- <https://developers.cloudflare.com/d1/platform/pricing/>
- <https://developers.cloudflare.com/d1/platform/limits/>
- <https://developers.cloudflare.com/d1/observability/metrics-analytics/>
- <https://developers.cloudflare.com/d1/reference/faq/>
- <https://developers.cloudflare.com/d1/reference/time-travel/>
- <https://developers.cloudflare.com/d1/best-practices/local-development/>
- <https://developers.cloudflare.com/d1/configuration/environments/>
- <https://developers.cloudflare.com/billing/manage/budget-alerts/>
- <https://developers.cloudflare.com/changelog/post/2026-06-15-budget-alerts-default-on/>
- <https://developers.cloudflare.com/changelog/post/2026-04-13-billable-usage-dashboard-and-budget-alerts/>
- <https://developers.cloudflare.com/changelog/post/2026-09-22-worker-previews/>
- <https://www.cloudflare.com/terms/>
- <https://www.cloudflare.com/service-specific-terms-developer-platform/>
- <https://blog.cloudflare.com/unpacking-cloudflare-workers-cpu-performance-benchmarks/>
- <https://blog.cloudflare.com/a-better-web-streams-api/>
- <https://blog.cloudflare.com/eliminating-cold-starts-2-shard-and-conquer/>
- <https://github.com/cloudflare/workerd/blob/main/src/workerd/io/limit-enforcer.h>
- <https://github.com/cloudflare/templates/blob/main/react-router-starter-template/app/entry.server.tsx>
- <https://github.com/cloudflare/templates/blob/main/react-router-starter-template/workers/app.ts>

**React and React Router**

- <https://react.dev/reference/react-dom/server>
- <https://react.dev/reference/react-dom/server/renderToReadableStream>
- <https://react.dev/reference/react-dom/server/renderToString>
- <https://github.com/facebook/react/blob/main/packages/react-server/src/ReactServerStreamConfigEdge.js>
- <https://github.com/facebook/react/blob/main/packages/react-server/src/ReactServerStreamConfigNode.js>
- <https://github.com/facebook/react/pull/24291>
- <https://github.com/facebook/react/pull/36139>
- Installed source: `node_modules/react-dom/package.json`, `server.edge.js`, `cjs/react-dom-server.edge.production.js`, `cjs/react-dom-server.node.production.js`, `cjs/react-dom-server-legacy.browser.production.js`
- Installed source: `node_modules/react-router/dist/production/lib/server-runtime/server.js`, `server-runtime/single-fetch.js`, `server-runtime/routes.js`, `dom/lib.js`, `dom/ssr/server.js`, `dom/ssr/single-fetch.js`, `dom/ssr/components.js`, `hooks.js`, `vendor/turbo-stream-v2/turbo-stream.js`
- Installed docs: `node_modules/react-router/docs/start/framework/rendering.md`, `data-loading.md`, `actions.md`, `docs/how-to/spa.md`, `pre-rendering.md`, `client-data.md`, `middleware.md`, `react-server-components.md`, `docs/upgrading/future.md`
- Installed source: `node_modules/@react-router/cloudflare/dist/index.js`, `node_modules/@react-router/dev/dist/config/defaults/entry.server.web.tsx`, `node_modules/@react-router/dev/CHANGELOG.md`

**Test tooling**

- Installed source: `node_modules/@cloudflare/vitest-plugin/dist/pool/index.mjs`, `dist/pool/index.d.mts`, `types/cloudflare-test.d.ts`
- Installed source: `node_modules/wrangler/wrangler-dist/cli.d.ts`, `cli.js`, `node_modules/wrangler/config-schema.json`

**Other hosts and databases**

- <https://vercel.com/docs/plans/hobby>
- <https://vercel.com/docs/limits/fair-use-guidelines>
- <https://www.netlify.com/pricing/>
- <https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/>
- <https://deno.com/deploy/pricing>
- <https://docs.deno.com/deploy/>
- <https://docs.deno.com/deploy/pricing_and_limits/>
- <https://render.com/docs/free>
- <https://render.com/docs/compute-plans>
- <https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses>
- <https://www.koyeb.com/docs/reference/instances>
- <https://www.koyeb.com/pricing>
- <https://docs.cloud.google.com/free/docs/free-cloud-features>
- <https://docs.cloud.google.com/run/docs/about-instance-autoscaling>
- <https://aws.amazon.com/lambda/pricing/>
- <https://aws.amazon.com/free/>
- <https://docs.fly.io/about/pricing>
- <https://docs.railway.com/reference/pricing/plans>
- <https://docs.railway.com/reference/pricing/free-trial>
- <https://docs.railway.com/reference/app-sleeping>
- <https://railway.com/pricing>
- <https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>
- <https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/>
- <https://docs.hetzner.com/general/others/ipv4-pricing/>
- <https://turso.tech/pricing>
- <https://docs.turso.tech/sdk/ts/reference>
- <https://neon.com/pricing>
- <https://neon.com/docs/introduction/plans>
- <https://supabase.com/pricing>

**Alternative renderers**

- <https://hono.dev/docs/guides/jsx>
- <https://github.com/honojs/hono/blob/main/src/jsx/base.ts>
- <https://github.com/preactjs/preact-render-to-string>
- <https://svelte.dev/docs/kit/adapter-cloudflare>
- <https://svelte.dev/docs/svelte/svelte-server>
- <https://docs.solidjs.com/solid-start/reference/server/create-handler>
- <https://docs.solidjs.com/reference/rendering/render-to-string>
- <https://docs.astro.build/en/guides/integrations-guide/cloudflare/>
- <https://htmx.org/docs/>
- <https://tanstack.com/start/latest/docs/framework/react/guide/hosting>
- <https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr>
- <https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode>
- <https://github.com/remix-run/remix>

**Third-party, reproducible; not primary**

- <https://blog.platformatic.dev/ssr-performance-showdown> and <https://github.com/platformatic/ssr-performance-showdown>
- <https://github.com/t3dotgg/cf-vs-vercel-bench>
