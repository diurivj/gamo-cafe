# 12: Verify the complete redesigned experience

**What to build:** Demonstrate that the entire redesigned app works as one coherent, accessible experience for both roles and fix integration gaps. Produce reproducible evidence for the full-app pilot gate. This complements the tests in every implementation ticket; it is not permission to defer local testing or merely recolor uncovered screens.

**Blocked by:** 04 — Correct a Bill and understand its History; 05 — Find a Customer and collect outstanding money; 06 — Understand Día and Mi día; 07 — Review all Bills and outstanding debts; 09 — Count Stock and inspect Discrepancies; 10 — Manage Items and Categories; 11 — Manage Users and access.

**Status:** ready-for-agent

**Spec:** [UI redesign](../spec.md) §§2, 7–11.

- [ ] Account for every user-facing screen and shared/global surface in the spec, including applicable empty/populated/loading/refused/unknown/confirmed states. No destination retains an unreviewed old experience beneath the new navigation.
- [ ] Cross-journey tests cover sign-in → selling → Payment → figures/Stock, Open Bills → collection/Abonar, corrections → History/figures, catalog changes → selling, Count → Discrepancies, and User access changes → subsequent navigation.
- [ ] Run the complete project verification and browser E2E suites for both roles. Preserve server permission, attribution, money/Stock, concurrency, request-budget and read-only-request guarantees; explain intentional replacements of old overlapping-sale assertions rather than deleting unrelated coverage.
- [ ] Deterministically exercise double taps, held requests, refusal, failure before recording, lost answers after recording, and failed revalidation after confirmed mutation. Verify actual facts and no duplicate writes, not only screenshots or success wording.
- [ ] Verify navigation/Back/deep links, unfinished-work handling, list paging/filter/position restoration and cross-tab Notice ownership throughout the integrated app.
- [ ] Run automated accessibility checks on all redesigned routes' principal states and shared interactive states, fix violations and record the scope/limits of automation. Check applicable WCAG 2.2 AA criteria rather than treating an automated pass as conformance proof.
- [ ] Complete and record keyboard-only and screen-reader checks of navigation, sign-in, selling/payment, reporting and a Stock task. Inspect names, reading order, announcements, dialogs and visible focus. If required assistive tooling is unavailable, record that as outstanding; do not mark this ticket complete without the required evidence.
- [ ] Verify 320 px reflow, representative Android/iPhone and laptop layouts, portrait/landscape, 200% text, custom text spacing, reduced motion, contrast, long text/large amounts and mobile keyboard/safe-area interactions. No sticky bar hides content, actions or focus.
- [ ] Check interaction responsiveness with controlled delays and an available older/lower-powered phone or documented throttled fallback. Record environment and method; emulation is not real-device proof. Avoid arbitrary live-network timing assertions or new stale-money caching.
- [ ] Fix integration/accessibility blockers within the agreed scope and rerun affected checks. Document changed behavior, evidence, remaining non-blocking limitations and the pilot-readiness decision. Unavailable checks are not passes.
- [ ] Do not deploy or touch production data. Full technical verification precedes the pilot; passing this ticket does not claim representative Users have already validated usability.
