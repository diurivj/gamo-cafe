# 12: Verify the complete redesigned experience

**What to build:** Demonstrate that the entire redesigned app works as one coherent, accessible experience for both roles and fix integration gaps. Produce reproducible evidence for the full-app pilot gate. This complements the tests in every implementation ticket; it is not permission to defer local testing or merely recolor uncovered screens.

**Blocked by:** 04 — Correct a Bill and understand its History; 05 — Find a Customer and collect outstanding money; 06 — Understand Día and Mi día; 07 — Review all Bills and outstanding debts; 09 — Count Stock and inspect Discrepancies; 10 — Manage Items and Categories; 11 — Manage Users and access.

**Status:** ready-for-human

**Spec:** [UI redesign](../spec.md) §§2, 7–11.

- [x] Account for every user-facing screen and shared/global surface in the spec, including applicable empty/populated/loading/refused/unknown/confirmed states. No destination retains an unreviewed old experience beneath the new navigation.
- [x] Cross-journey tests cover sign-in → selling → Payment → figures/Stock, Open Bills → collection/Abonar, corrections → History/figures, catalog changes → selling, Count → Discrepancies, and User access changes → subsequent navigation.
- [x] Run the complete project verification and browser E2E suites for both roles. Preserve server permission, attribution, money/Stock, concurrency, request-budget and read-only-request guarantees; explain intentional replacements of old overlapping-sale assertions rather than deleting unrelated coverage.
- [x] Deterministically exercise double taps, held requests, refusal, failure before recording, lost answers after recording, and failed revalidation after confirmed mutation. Verify actual facts and no duplicate writes, not only screenshots or success wording.
- [x] Verify navigation/Back/deep links, unfinished-work handling, list paging/filter/position restoration and cross-tab Notice ownership throughout the integrated app.
- [x] Run automated accessibility checks on all redesigned routes' principal states and shared interactive states, fix violations and record the scope/limits of automation. Check applicable WCAG 2.2 AA criteria rather than treating an automated pass as conformance proof.
- [ ] Complete and record keyboard-only and screen-reader checks of navigation, sign-in, selling/payment, reporting and a Stock task. Inspect names, reading order, announcements, dialogs and visible focus. If required assistive tooling is unavailable, record that as outstanding; do not mark this ticket complete without the required evidence.
- [ ] Verify 320 px reflow, representative Android/iPhone and laptop layouts, portrait/landscape, 200% text, custom text spacing, reduced motion, contrast, long text/large amounts and mobile keyboard/safe-area interactions. No sticky bar hides content, actions or focus.
- [x] Check interaction responsiveness with controlled delays and an available older/lower-powered phone or documented throttled fallback. Record environment and method; emulation is not real-device proof. Avoid arbitrary live-network timing assertions or new stale-money caching.
- [x] Fix integration/accessibility blockers within the agreed scope and rerun affected checks. Document changed behavior, evidence, remaining non-blocking limitations and the pilot-readiness decision. Unavailable checks are not passes.
- [x] Do not deploy or touch production data. Full technical verification precedes the pilot; passing this ticket does not claim representative Users have already validated usability.

## Answer

The automated verification is done and passes; the ticket is **not complete**. Two boxes stay open because they need a person and a phone: the keyboard and screen-reader passes by hand, and the on-screen keyboard and safe area on a real device. The record, with how to run everything again and the script for what is owed, is [`verification.md`](../verification.md). Its decision: **not ready to invite pilot Users until §7 of that file is filled in**; nothing found so far blocks the pilot.

What was added:

- **An inventory that runs.** `e2e/support/tour.ts` lists every screen in each state a User meets it in — 150 stops per phone shape: both roles, signed out, and an app with nothing recorded — opened in a cafeteria that `e2e/support/cafe.ts` fills through the app's own routes. A new screen or state gets a stop and is then scanned and measured with the rest.
- **`e2e/accessibility.spec.ts`**: axe-core on every stop, WCAG 2.0–2.2 A and AA and best practices, both engines. Nothing is left but what was set aside on purpose: the two unnamed focus guards Base UI puts around a dialog on Safari.
- **`e2e/layout.spec.ts`**: every stop at 320px, with text twice as large, with a reader's text spacing, on its side and on a laptop: nothing cut or scrolling sideways, 48px targets, the focus in sight and under no bar.
- **`e2e/journeys.spec.ts`**: one day on two phones across every screen, ending on the tables and on `projections:verify`'s own statement finding no difference.
- **A sale with the keyboard alone** in `e2e/vender.spec.ts`.
- **`e2e/after-recording.spec.ts`**: the read after each confirmed result fails, for every recording screen but Vender (which has none); and the double tap on a correction and on a cancellation.
- **`e2e/perception.spec.ts`**: the edge of each control and the focus mark at 3:1, reduced motion, zoom and keyboards, and a tap answered by the next frame with the processor six times slower.
- **`e2e/reading-order.spec.ts`**: the accessibility tree of sign-in, the navigation, a sale, Día and an Adjustment.

What the checks found, all fixed (verification.md §5):

- A destructive button or badge was under 4.5:1. `--destructive` is darker.
- Amounts were cut by their card with large text or four digits: Cuenta, Cliente, Cuentas abiertas, Vender's review and total, the change. They wrap now (`figureRow`, `amount`).
- The focus went under Conteo's sticky bar at ordinary text size, and under Vender's with a reader's spacing. Both bars now measure themselves (`StickyBar`, `--bar-height`), and what sticks stops sticking when the two would take more than half the screen.
- WebKit left a focused field under the bar; the shell brings it clear.
- A button, a title, a link of Más and a payment method could be wider than their room with large text.

Taken from what earlier tickets left open:

- **Cuenta lost a confirmed Payment or correction** (and the change to hand back) when a read of the Bill already on its way landed after the answer. It keeps it now, as Cliente does (ticket 05's note). Two tests, seen failing first.
- **The read after a confirmed result, when it fails**, landed on "puede que sí se haya guardado". The screen that stands in now keeps saying what was recorded and that it is not to be repeated (`~/shared/recorded`; spec §6.1; tickets 03, 05, 08, 09).
- **A Worker pressing Back after a Bill's last Payment** got "No tienes acceso a esta página". It says the Bill is no longer open and leads to Cuentas abiertas; still a 403 (tickets 03 and 04).

Decided here, and worth a look:

- **The sticky total can stop sticking.** With text twice as large on a small phone the two bars took 471 of 568px. Rather than cover the Items, the total then rests after the list. `e2e/navigation.spec.ts`' large-text test asserted it stuck; it now asserts it is reachable and clear of the bar.
- **Cuenta's result now stays through the browser's Back** from its step, not only through a read that was already on its way: it gives way to **Ver cuenta** or the list, as Cliente's does. That is wider than ticket 05's note.
- **The shell brings every focused field into the clear room, on every engine.** It is there for WebKit; where the browser already did it, nothing moves.
- **A long amount breaks across lines** at that size instead of shrinking. It follows what `FiguresPanel` and Por cobrar already did.
- **A new dev dependency**, `@axe-core/playwright`. The scan the spec asks for needs an engine; nothing ships with the app.
- **The review step and a destination are timed, not asserted, under the throttle.** They are address changes the router gets to when it does; spec §9's next-frame rule is about a unit added and an action submitted, and those are asserted.

Results, 2026-10-09: `npm run verify` — 74 files, 846 tests passed. `npm run test:e2e` — 417 passed, 1 skipped (the CPU throttle is Chromium's). Nothing was deployed and nothing ran against production.

Left open:

- Everything in verification.md §7: screen reader, keyboard by hand, a real phone, an older phone.
- Not in the tour, so not scanned or measured: a list's second page, a Count on its way, the results of the remaining corrections.
- `beforeunload` is tested on Vender only.
- `tapAndSeeNextFrame` is now in `e2e/support/frame.ts`; the six specs that each carry a copy were not moved to it.
- `e2e/support/cafe.ts` posts the forms as the screens build them, written out again; a change to a form's fields has to be made there too.

