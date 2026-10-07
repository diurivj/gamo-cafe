# 13: Prepare the full-app pilot

**What to build:** Provide a ready-to-run, safe full-app pilot kit for an older Admin and a low-digital-confidence Worker (or comparable representatives), so the human facilitator can observe complete journeys without coaching. Prepare data, tasks and an evidence template; actual pilot sessions and User feedback remain human work, not something an autonomous agent may claim to have performed.

**Blocked by:** 12 — Verify the complete redesigned experience.

**Status:** ready-for-agent

**Spec:** [UI redesign](../spec.md) §§1, 10.3, 11.

- [ ] The kit explicitly gates pilot use on completion of the whole redesign and technical verification, not just selling or a few polished screens. Reference the verification evidence and disclose remaining non-blocking limitations.
- [ ] Prepare reproducible local/test setup with realistic Spanish names/prices, cash and transfer examples, named/anonymous Open Bills, older debt, low/negative Stock and Items suitable for a partial Count. Include safe isolated reset/repeat guidance; never use live Payments or production data.
- [ ] Prepare role-appropriate test access without publishing sensitive credentials. Explain the setup to the facilitator, separately from participant task prompts, so the ordinary sign-in experience remains testable.
- [ ] Participant scripts cover cash sale/change, transfer sale, correction before payment, staged request failure/recovery, leaving/finding/paying an Open Bill, own Day activity, finding a less-frequent tool through Más and returning to selling.
- [ ] Admin tasks additionally cover explaining Cobrado versus Vendido, inspecting low Stock, recording an Entrada and completing a small Count. Do not ask Workers to perform forbidden tasks.
- [ ] Prompts describe goals, not the exact buttons to click. Facilitator instructions distinguish observation from coaching and record assistance rather than quietly turning assisted completion into success.
- [ ] Provide an evidence template for device/browser, task completion/time, assistance, hesitation, navigation errors, amount/method mistakes, understanding of pending/recorded outcomes, and category-illustration recognition. Validate the assumed dominance of immediate payment rather than treating it as measured fact.
- [ ] Acceptance requires each representative to complete their role's core tasks independently. Duplicate-payment behavior or unresolved misunderstanding of recorded/pending states is a blocker; record defects and retest affected tasks after fixes. Do not invent a task-speed target before observing realistic usage.
- [ ] Dry-run the setup and scripts against the completed test app, checking feasibility, expected amounts/Stock and isolation from production. A developer/agent dry run is labeled as such, never as a representative-user session.
- [ ] Handoff clearly separates this ticket's deliverable (prepared kit) from human pilot execution and later refinement. No fabricated results, automatic deployment or claim of completed usability validation.
