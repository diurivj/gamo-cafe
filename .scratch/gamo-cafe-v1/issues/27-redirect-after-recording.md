# 27 — Answer every recorded form with a redirect

Status: resolved
Blocked by: —
Spec: [`../spec.md`](../spec.md) §3.4, §8.1, §8.3

## What to build

Several actions answer success with data, so a document POST re-renders the page and a reload submits the form again. The Count already redirects; the others should.

- Every action that records something answers success with `redirect(...)`: Vender (Dejar abierta, Cobrar, adding to a Bill), Abonar on a Customer's page, the forms on Cuenta, Inventario's Adjustment and its cancellation, and the Admin forms on Clientes, Productos and Usuarios. A refusal still answers 400 with its Spanish message on the same form.
- What the screen says afterwards ("Cuenta pagada: $…", "Abono de $… registrado.") travels with the redirect in a short-lived cookie that the next loader reads and clears, in one small server module that every route uses. The message is never built from the URL.
- Vender still empties the selection and starts a new form after a recorded sale, and still shows the recorded Bill's id on the status message for the browser tests.
- Update `tests/proof-budget.test.ts` for the statuses that become 302.

## Acceptance criteria

- [x] A document POST that records something answers 302, and the page it lands on shows the same message as today, once.
- [x] Reloading that page, or going back and forward, neither repeats the message nor records anything.
- [x] With JavaScript loaded the same forms behave as before to the User: pending text at once, then the message.
- [x] A refused submission keeps the form's contents and shows its message.
- [x] `npm run verify` and the Playwright suite pass.

## Comments

- 2026-10-06: Opened from the research (§3.5) and the decision to follow form best practices throughout.
- 2026-10-06: Resolved. See the answer below.

## Answer

Every action that records something now answers success with a redirect; a refusal still answers 400 with its message as action data.

**The flash module is `app/flash.server.ts`.** A route uses it in three places:

- the action returns `redirectWithFlash(to, flash)`, where `to` is a path of the app and `flash` is `{ message?, form?, billId?, code? }`;
- the loader of the page at `to` returns `flash: takeFlash(context)`, which is the flash plus an `id` that is new for every recorded form, or `null`;
- the component renders `flash?.message` in its `role="status"` element, and keys a form on `flash.id` to start it over.

`flashMiddleware` is the second middleware of `app/root.tsx`. It reads the cookie `gamo_flash` (`HttpOnly`, `Secure`, `SameSite=Lax`, 60 seconds) on a GET and appends the clearing `Set-Cookie` to the response of the request whose loader called `takeFlash`. The cookie holds the path it is for, so another page neither shows nor clears it. A loader needs no `data(...)` or headers of its own. In tests, `landing(who, response)` in `tests/support/auth.ts` asserts the 302 and requests the page it lands on with the cookie the redirect set.

Where each form lands:

| Form | Redirects to | Flash |
| --- | --- | --- |
| Vender: Dejar abierta, Cobrar | `/` | the message and `billId` (still `data-bill-id` on the status) |
| Vender: adding to a Bill | `/?billId=<id>` | the same |
| Cuenta: Cobrar, Cliente y nota, the three corrections | `/cuentas/<id>` | the message |
| Customer: Abonar | `/clientes/<id>` | the message |
| Customer: rename, retire, restore | `/clientes/<id>` | none, as before |
| Inventario: Adjustment and its cancellation | `/inventario` | `form`, so that form starts over; no message, as before |
| Productos: every form | `/productos` | `form` |
| Producto: retire, restore | `/productos/<id>` | none |
| Usuarios: every form | `/usuarios` | the notice, or `code` (name and sign-in code) |

For the tickets that build on this:

- **28**: a repeated submission must answer "the same redirect and the same message". The messages are built in the action from the operation's result, so an operation that returns the first result again gets that for free. `flash.id` is new for every redirect; do not use it as the submission key. A new form after a recorded sale is the remount Vender already does on `flash.id` (`formKey` in `app/routes/home.tsx`), which is where a new key belongs.
- **30, 31**: a page's loader runs again after the redirect, and `takeFlash` gives `null` on every later run, so any revalidation removes the message. A loader that is skipped with `shouldRevalidate` keeps showing the flash it last returned, and the cookie stays until it expires; a route that takes a flash has to revalidate after its own form.

Things a later reader should know:

- `takePayment` now also returns `total` and `owed` after the Payment, so Cuenta's action can build "Cuenta pagada: $…" and "Abono de $… registrado. Debe $…" without reading the Bill again.
- A new sign-in code now travels in the flash cookie for one request, in the Admin's own browser, instead of in the response body. It is not stored anywhere and only its hash is in D1, so the page cannot read it back another way.
- `pagePath` in `app/session.server.ts` is exported; the flash module uses it to match the cookie's path against a `.data` request.
- The Worker redirects that already existed are unchanged and carry no message: a full Payment or a Line removal that leaves the Bill Paid sends a Worker to Cuentas abiertas, and an Admin who makes themselves a Worker goes to Vender.
- Without JavaScript a refused form is rendered again from the server and loses what was typed, as before this ticket; with JavaScript it keeps it. `e2e/redirect-after-recording.spec.ts` covers the reload, back and forward, the refusal, and a document POST with JavaScript disabled.
