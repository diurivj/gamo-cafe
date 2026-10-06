# 33 — Every recorded answer reaches the screen it belongs to

Status: ready-for-agent
Blocked by: none
Spec: [`../spec.md`](../spec.md) §3.4

## What to build

The flash is one cookie per browser (`app/flash.server.ts`). Two shapes of loss follow, both recorded in ticket 30's Answer as accepted or as a side effect:

- Two sales confirmed in the same moment on Vender: the load that shows the first clears the cookie before the second's message is read, so one recorded sale shows no words. Both are recorded and both leave the list.
- Another tab on the same path can take a message the first tab's action left: the message shows where it was not meant to, or nowhere.

Every recorded action must reach the screen it was recorded from, exactly once, and no other screen. The mechanism is the implementation's choice.

## Acceptance criteria

- [ ] Two sales recorded together on Vender (two fetchers) each show their own words; neither is lost, and neither shows the other's.
- [ ] A second tab on the same path cannot consume a message the first tab's action left; the first still shows it, once.
- [ ] A reload after the message shows none (once-only stays), and the message is never in the URL.
- [ ] Refusals and the other routes' messages behave as they do today: `tests/flash.test.ts` and `e2e/pending-ui.spec.ts` stay green, extended for the new cases.
- [ ] The flash's `id` and the form-keying that uses it (`fresh` in `app/routes/inventario.tsx`) still work.

Constraints a later reader should keep in mind:

- `takeFlash` is read by every loader the redirect lands on; the answer must survive the revalidations ticket 31 kept, and must not re-break the `shouldRevalidate` on `shell` and `sell-items`.
- Vender's `SaleBeingRecorded` (`app/routes/home.tsx`) already notices a dropped redirect and revalidates once to fetch a waiting message. A design that puts the words in the fetcher's own answer would simplify that, and must still keep a reload from recording twice (ticket 27).

## Comments

- 2026-10-06: Opened from the two-axis review of tickets 26–31 (Spec axis). Ticket 30's Answer documents the single-cookie loss; the review added the second-tab case.
