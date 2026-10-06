# 33 — Every recorded answer reaches the screen it belongs to

Status: resolved
Blocked by: none
Spec: [`../spec.md`](../spec.md) §3.4

## What to build

The flash is one cookie per browser (`app/flash.server.ts`). Two shapes of loss follow, both recorded in ticket 30's Answer as accepted or as a side effect:

- Two sales confirmed in the same moment on Vender: the load that shows the first clears the cookie before the second's message is read, so one recorded sale shows no words. Both are recorded and both leave the list.
- Another tab on the same path can take a message the first tab's action left: the message shows where it was not meant to, or nowhere.

Every recorded action must reach the screen it was recorded from, exactly once, and no other screen. The mechanism is the implementation's choice.

## Acceptance criteria

- [x] Two sales recorded together on Vender (two fetchers) each show their own words; neither is lost, and neither shows the other's.
- [x] A second tab on the same path cannot consume a message the first tab's action left; the first still shows it, once.
- [x] A reload after the message shows none (once-only stays), and the message is never in the URL.
- [x] Refusals and the other routes' messages behave as they do today: `tests/flash.test.ts` and `e2e/pending-ui.spec.ts` stay green, extended for the new cases.
- [x] The flash's `id` and the form-keying that uses it (`fresh` in `app/routes/inventario.tsx`) still work.

Constraints a later reader should keep in mind:

- `takeFlash` is read by every loader the redirect lands on; the answer must survive the revalidations ticket 31 kept, and must not re-break the `shouldRevalidate` on `shell` and `sell-items`.
- Vender's `SaleBeingRecorded` (`app/routes/home.tsx`) already notices a dropped redirect and revalidates once to fetch a waiting message. A design that puts the words in the fetcher's own answer would simplify that, and must still keep a reload from recording twice (ticket 27).

## Comments

- 2026-10-06: Opened from the two-axis review of tickets 26–31 (Spec axis). Ticket 30's Answer documents the single-cookie loss; the review added the second-tab case.
- 2026-10-06: Resolved. See the Answer.

## Answer

Vender's recorded sales are now answered by the request that sent them, so there is no browser-wide place for one sale's words to lose or take another's. The other routes keep the redirect and the cookie they have today.

**The mechanism is `answerWithFlash(request, to, flash)` in `app/flash.server.ts`.** A request the browser's router sent — a data request, asking for `path.data` — is answered with the flash in the action's own data: `{ flash }`. Only the screen that submitted the form receives it. A document request (a browser without JavaScript posted the page itself) still gets the redirect `redirectWithFlash` always gave, with the flash in the cookie. `redirectWithFlash` is unchanged and the other routes still call it. `isDataRequest` in `app/session.server.ts` is the one place that knows a data request's path, beside `pagePath`, which uses the same suffix.

Vender's action (`app/routes/home.tsx`) returns `answerWithFlash(request, selection.billId ? "/?billId=…" : "/", { message, billId })`. `SaleBeingRecorded` no longer watches for a followed or dropped redirect: when its fetcher is idle, `fetcher.data.flash` is this sale's own flash, and `answered` puts it in `said`. Refusals are unchanged (400 with the message on the form). `useRevalidator` and the `landed` bookkeeping are gone.

Where the two shapes of loss went:

- **Two sales at once.** Each sale has its own fetcher, and each fetcher's answer carries only its own words. There is no cookie for a load of the first to clear before the second reads it. Both recorded sales show their own message; neither can show the other's.
- **A second tab.** Nothing is written to shared storage on this path, so a second tab on `/` has nothing to take; the tab that recorded the sale still shows it, once.
- **Reload and Back.** A fetcher's POST is not a history entry (ticket 27's guarantee), so a reload is a plain GET that records nothing, and the message never appears in the URL.
- **A document POST (no JavaScript)** is unchanged: the redirect carries the flash in the cookie, and the page it lands on takes it once.

**Boundary a later reader should keep in mind.** The other routes' forms still answer with `redirectWithFlash` (the acceptance criteria ask them to behave as they do today). Their messages therefore still travel in the one browser-wide cookie, and the second-tab window — the moment between the redirect response setting the cookie and the landing load clearing it — remains possible there. Making them tab-safe the same way would mean every screen reading the flash the action answered with (`actionData.flash`, or a fetcher's `data.flash`) in addition to the loader's `takeFlash`, including the forms on `/usuarios`, whose messages are lifted out of per-User fetchers; this ticket does not do that. A document POST, whatever the route, is cookie-based by necessity: the browser, not the router, follows it.

Behaviour a later reader should know:

- The screen has one message line. Two answers landing in the same frame show the later message; each answer still carries its own words, and the old failure — a recorded sale with no words at all, or another sale's — cannot happen. `e2e/vender-pending.spec.ts` releases the two held sales one at a time and reads each message.
- A sale whose screen is gone before the answer arrives no longer waits in a cookie for the next Vender visit (ticket 30's note): the words exist only in the fetcher's answer, and the sale is still recorded and on the Bill. A failed request is the router's error page, as before, and the selection is still not restored.
- `takeFlash`, `flashMiddleware`, the `id`, and `fresh` are untouched; the answer survives ticket 31's revalidations because it lives in `said` (React state), not in the loader.

Tests: `tests/flash.test.ts` gained "a sale the browser sends" (its own words in the answer and no cookie, and no later load shows them; two sales' answers carry only their own words; a document POST still redirects and shows once). `tests/reuse.test.ts` measures the sale's own answer, and the post-sale loader still runs only the session's read. `e2e/vender-pending.spec.ts` gained "a sale's words reach the Vender tab that recorded it, and no other" (two pages of one context, the second reloading while the first's answer is held; it fails on the old code). `npm run verify`, 612 unit tests, and 166 Playwright tests pass. README's "Writing a route" and `app/flash.server.ts`'s module comment record the exception.
