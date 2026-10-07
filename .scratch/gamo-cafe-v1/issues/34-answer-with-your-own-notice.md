# 34 — Every recorded form answers with its own notice

Status: resolved
Blocked by: none
Spec: [`../spec.md`](../spec.md) §3.4

## What to build

Ticket 33 gave Vender's browser-sent sales their own answer: `answerWithFlash` puts the words in the action's response, and the fetcher that sent the sale reads them from there. Give every recorded form the same treatment, and rename the mechanism.

- **The answer is the transport.** A request the browser's router sent is answered with what was recorded; the screen that sent the form reads it (`useActionData()` for a `<Form>`, `fetcher.data` for a `<fetcher.Form>`). A document request — JavaScript off, the browser posted the page itself — still gets the redirect and the cookie; that is the cookie's only job left.
- **The term is "notice", not "flash".** Rename it everywhere it names the mechanism: `app/flash.server.ts` → `app/notice.server.ts`; `Flash` → `Notice`; `TakenFlash` → `TakenNotice`; `answerWithFlash` → `answerWithNotice`; `takeFlash` → `takeNotice`; `flashMiddleware` → `noticeMiddleware`; the cookie `gamo_flash` → `gamo_notice`. The exported `redirectWithFlash` goes away: every recorded form answers through `answerWithNotice`, and the private redirect builder serves the document path. Comments, README and tests use the new word. Resolved tickets keep the old word as history; this ticket's Answer notes the rename.
- **Every screen follows.** Cuenta (`app/routes/bill.tsx`: the Payment, the Customer and note, and the corrections), Cliente (`app/routes/customer.tsx`: Abonar, and the retire/restore fetcher), Inventario (`app/routes/inventario.tsx`: the Adjustment and its cancellation), Productos (`app/routes/productos.tsx`: every form), Usuarios (`app/routes/users.tsx`: add a User, a new code, sign out everywhere, and each row's role/active fetcher). Vender already does this; it only takes the new name.
- **The forms that reset** (`fresh` in `inventario.tsx` and `productos.tsx`) read the notice from the answer as well as from the loader, so a recorded form starts over either way.
- **Usuarios lifts the row's notice.** The role and active forms are per-User fetchers (`UserRow`), and the words are shown by the page; the row reports its answer to the page the way `SaleBeingRecorded` reports to `answered`.

## Acceptance criteria

- [x] With JavaScript on, every recorded form shows its message on the screen that sent it, and the response sets no cookie. A second tab cannot take the message.
- [x] Every document POST (JavaScript off) still answers 302 and the page it lands on shows the same message once; reload and Back record nothing again, and the message is never in the URL.
- [x] Refusals behave as today: 400, the Spanish message on the same form, what was typed kept.
- [x] A recorded form still starts over (`fresh`), and the one-time sign-in code on Usuarios still shows once and is never in the URL.
- [x] `flash` no longer names the mechanism in code, tests, README or comments; resolved tickets keep their history.
- [x] The full suite passes: `npm run verify` and Playwright.

Constraints a later reader should keep in mind:

- Route modules read the notice's shape and the `useSaidNotice` hook from `~/shared/notice`; `~/notice.server` owns the answer, the cookie and the middleware, and stays server-only. The client reads the notice from the router's data, never from the server module.
- The notice in the router's data survives the loader revalidation that follows the action (React Router keeps the action data while the page reloads); do not take it from the loader a second time.
- Do not re-break `shouldRevalidate` on `shell` and `sell-items`, the submission keys (tickets 28, 32) or ticket 26's read-only loaders.
- A document POST is still cookie-based by necessity; the cookie lasts a minute and is cleared by the request that took it.

## Comments

- 2026-10-06: Opened from the review of ticket 33. The owner accepted the trade-off that the words live in the router's answer and are lost if the screen is left before the answer arrives, in exchange for the code being simpler.
- 2026-10-06: Resolved. See the Answer.

## Answer

Every recorded form now answers the request that sent it, and the mechanism is called a **notice**. `answerWithNotice(request, to, notice)` in `app/notice.server.ts` is the one answer builder: a data request gets `{ notice }` in the action's own data; a document request gets the redirect and the cookie. Ticket 33's Vender path is the same code with the new name.

Where each screen reads its notice (§ = the answer it sent):

| Screen | Forms | From |
| --- | --- | --- |
| Vender | each sale in its own fetcher | `fetcher.data.notice` |
| Cuenta | the Payment, Cliente y nota, and the corrections | `useActionData()?.notice` |
| Cliente | Abonar | `useActionData()?.notice` |
| Cliente | retire and restore | the `customer-state` fetcher's `data.notice` |
| Inventario | the Adjustment and its cancellation | `useActionData()?.notice`, merged into `fresh` |
| Productos | every form | `useActionData()?.notice`, merged into `fresh` |
| Usuarios | add a User, a new code, sign out everywhere | `useActionData()?.notice` |
| Usuarios | a role or active state | the row's fetcher reports its `data.notice` to the page, which shows it |

A screen where several answers can arrive (`/clientes/<id>`, `/usuarios`, and Vender's `said`) keeps the last notice it was given through `useSaidNotice` in `~/shared/notice.ts`: the loader's notice first, then each answer once, when it first appears. So a later answer replaces the words, a row's fetcher can report its own answer up, and a loader revalidation does not take the message away. The loader's `takeNotice` stays for document POSTs, and `noticeMiddleware` still clears the cookie once.

The rename: `app/flash.server.ts` → `app/notice.server.ts`; `Flash` → `Notice`; `TakenFlash` → `TakenNotice`; `answerWithFlash` → `answerWithNotice`; `takeFlash` → `takeNotice`; `flashMiddleware` → `noticeMiddleware`; the cookie `gamo_flash` → `gamo_notice`. The exported `redirectWithFlash` is gone: every recorded form goes through `answerWithNotice`, and the private redirect builder serves the document path. A browser that still holds a `gamo_flash` cookie ignores it and lets it expire; a notice in flight across a deploy is lost, which is safe because a notice only changes words.

What did not change:

- Refusals: 400 with the Spanish message on the form, what was typed kept.
- The forms whose landing page is a different screen — Conteo's confirmation to Diferencias, a Customer added to their page, an Item to Productos — keep a plain `redirect(...)`, because they have no words and the redirect is their navigation. The Cliente edit (Nombre and Nota) has no words either (ticket 27), so it keeps its `replace(page)` and only revalidates.
- The submission keys (tickets 28, 32), the `shouldRevalidate` on `shell` and `sell-items` (ticket 31), and the document path's reload and Back rules (ticket 27).
- The owner accepted that the words live in the router's answer: a screen the User leaves before the answer arrives gets no notice. That is the price of the simpler code; the document path keeps the cookie's minute.

Tests: `tests/notice.test.ts` (renamed from `tests/flash.test.ts`) adds Abonar over a data request — the notice in the response, no cookie, and no later load shows it; `e2e/redirect-after-recording.spec.ts` adds "a recorded form's words reach the tab that sent it, and no other" on the Cliente screen, which fails on the ticket-33 code and passes here. `npm run verify` (613 unit tests) and Playwright (168 tests) pass. README and `app/notice.server.ts` use the new rule and the new word; the resolved tickets keep "flash" as history.
