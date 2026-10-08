# 01: A React Router 8 review gate for this repo

**What to build:** A repo-local agent skill that checks a reviewed diff against React Router 8 Framework Mode and this app's Workers/D1 stack, run after every code review and reported apart from Standards and Spec. It is this repo's version of `~/coding/mdwn/.agents/skills/rr8-post-review/SKILL.md`: the same four steps (pin the scope, resolve the actual contract, check every touched boundary, report evidence), rewritten for what gamo-cafe is.

**Blocked by:** nothing.

**Status:** ready-for-agent

**Reference:** `~/coding/mdwn/.agents/skills/rr8-post-review/SKILL.md` and the "Post-review RR8 gate" section of `~/coding/mdwn/AGENTS.md`.

- [ ] Add `.agents/skills/rr8-post-review/SKILL.md`. Keep mdwn's structure and its rule that a `fetch()` or a `useEffect` is not itself a finding: name the lifecycle or security consequence first.
- [ ] Replace mdwn's contract sources with this repo's: `package.json` and the lockfile for the installed React Router version, `react-router.config.ts`, `app/routes.ts`, the README sections "Writing a route", "The look and the navigation", "One submission per form", "Paged lists" and "Request budgets", ADR 0005 and ADR 0006, and the UI redesign spec §6 and §9. API claims come from the installed version's types and the current React Router docs, never from memory.
- [ ] Replace mdwn's boundary checks with this repo's:
  - **Loading:** route data comes from a `loader`; every loader starts with `requireUser`; an Admin read refuses a Worker with 403 through the `screen.tsx` boundary; nothing about Bills, Payments or Stock is cached or skipped by `shouldRevalidate`; `Cache-Control: no-store` holds.
  - **Mutations:** a form is `<Form>` or `fetcher.Form` with `SubmitButton`, answered by a route `action` through `run` with an exhaustive error map and a Notice. Vender, Cuenta's Payment, Cuenta's corrections and Abonar send with `sendForRecord` on purpose (UI redesign §6); check them against that documented exception, and flag any new use of it that the README does not name.
  - **Server and browser:** no Effect import in `app/shared/` or components; server-only modules stay out of the client bundle; a Worker's loader data carries no Admin label, path or figure.
  - **Stack:** D1 only through the `Db` service; facts and projections in one batch; one submission per key; same-origin non-GET requests; the route guard and permissions matrix tests cover any new route.
- [ ] Drop what does not apply here: SSR privacy with `clientLoader` and `HydrateFallback`, WebAuthn, WebCrypto, IndexedDB, Drizzle.
- [ ] Keep the four results: **Pass**, **Findings**, **Not applicable**, **Unverified**. Each finding gives severity, `file:line`, the repo rule or official source it breaks, a reproducible consequence and the RR8-native alternative.
- [ ] Add a "Post-review RR8 gate" section to `AGENTS.md` and `CLAUDE.md` that tells an agent to load the skill after every code review and report its result separately.
- [ ] Run the skill once against the last redesign commit (`ea5dfd4`) as a proof and append what it reported under `## Comments`. Do not fix what it finds here: that is ticket 02.
