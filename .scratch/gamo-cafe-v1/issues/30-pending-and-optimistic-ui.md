# 30 — Acknowledge every tap: pending and optimistic UI

Status: resolved
Blocked by: 27
Spec: [`../spec.md`](../spec.md) §3.4, §2.2

## What to build

Spec §3.4 asks that every tap be acknowledged at once. Make it true screen by screen, with one rule about money.

- **Vender:** the selection empties the moment Dejar abierta or Cobrar is submitted, the screen says the sale is being recorded, and the next selection can start at once. If the server refuses, the selection comes back with the message. The screen says "pagada" or "registrado" only after the server confirms.
- **Harmless and reversible changes** show their result at once and revert on refusal: retiring and restoring a Customer, an Item's Minimum, a User's role and active state.
- **Money and Stock** (a Payment, Abonar, a correction, an Adjustment, a Count) show a pending state on the control that was tapped and never their result before the server confirms.
- Use React Router's fetchers and `useNavigation`; no client-side store.

## Acceptance criteria

- [x] Every submit control in the app shows a pending state within one frame of the tap, tested in the browser suite with a delayed response.
- [x] On Vender a second sale can be started while the first is still being recorded, and both are recorded.
- [x] A refused sale restores the selection it emptied.
- [x] No screen shows a Payment, an Abono or a Stock change as recorded before the response arrives.

## Comments

- 2026-10-06: Opened from the decision to follow the best patterns for forms. Blocked by 27 because the messages move to the redirect there.
- 2026-10-06: Resolved. See the Answer.

## Answer

Every tap is acknowledged at once, in one of three ways. The README ("Writing a route") says which a new form takes.

**1. `SubmitButton` (`app/components/submit-button.tsx`) is every submit button of the app.** The one that was tapped is `aria-busy`, disabled and pulsing from the tap until the answer is on the page; the others are disabled meanwhile. It sets its own pending state in the turn of the tap, because the router publishes its state in a transition, which is not guaranteed to land in the next frame. `tests/submit-controls.test.ts` fails on a submit button written by hand. It shows that a form is on its way and nothing else, which is all a Payment, an Abono, a correction, an Adjustment or a Count shows before the answer.

**2. A fetcher form shows a harmless change at once**: retiring and restoring a Customer (`app/routes/customer.tsx`), and a User's role and active state (`UserRow` in `app/routes/users.tsx`). The page renders what `fetcher.formData` asks for; a refusal shows `fetcher.data.error` and the page is back to what the server has. "Usuario desactivado." and "Ahora es …" still arrive with the redirect.

**3. Vender sends each sale in a fetcher of its own** (`send`, `answered` and `SaleBeingRecorded` in `app/routes/home.tsx`). The selection, the Customer, the note and the Payment fields empty at the tap, "Registrando venta de $…" is listed, and the two buttons stay enabled. A refused sale puts back its selection with the message; its Customer, note, method and amount come back too unless another selection was started meanwhile, in which case the units join that one and its form is left alone.

Not done, and why:

- **An Item's Minimum is not optimistic.** It has no form of its own: it is a field of the Item's form on Producto, and saving that form leaves the page for Productos, so there is no screen on which the new Minimum could show before the answer. Its **Guardar** is pending like every other. Showing it at once needs a Minimum form on a page that stays, on Inventario or the Productos list, which is a new control and an operation of its own; that is a decision for a ticket, not something this one adds on the side.

Things a later reader should know:

- `redirectWithFlash` now answers with `replace` (the `X-Remix-Replace` header). A `<Form>` that posts to its own page replaced the history entry already; a fetcher's redirect pushed one, so every sale added a Vender to the back button. An action a fetcher sends that redirects without a flash uses `replace(...)` itself (the Customer's retire and restore). A document request ignores the header.
- The router follows a fetcher's redirect only if no navigation began after the fetcher was sent. With two sales on their way, the second answer's redirect is dropped, and its message would wait in the cookie. `SaleBeingRecorded` notices that its fetcher never was `loading` and Vender revalidates once, which fetches the message. Vender also keeps the last message it was given (`said`), because that revalidation, or any other, brings a `null` flash.
- One message can still be lost: the flash is one cookie, so when two sales are confirmed within the same moment, the load that shows the first can clear the second's before it is read. Both sales are recorded and both leave the list; only the words of one are missing. A flash per sale would need the cookie to hold more than one.
- A User who opens another screen before a sale is answered stays there. A recorded sale's message waits in its cookie and shows when Vender is next opened, within the minute the cookie lasts. A refusal is not shown at all, and the selection is gone with the page; it was the same before this ticket, when the tap on another screen interrupted the form's navigation. A failed request (no connection) reaches the error boundary, also as before, and the selection is not restored. Both were checked in a browser.
- With ticket 28 (merged in): a submission key is made by the loader, which runs after each recorded form. Vender sends the next sale before that, and two sales with one key would be recorded as one. So Vender's form key is its submission key: the first form has the loader's, and `send` makes the key of each later form in the browser with `newId()`. The fetcher that carries a sale has the same key. A refused sale that is put back gets a new key; nothing was recorded under its old one.
- Dejar abierta and Cobrar are disabled while nothing is selected. The selection empties at the tap, so the second tap of a double tap sends nothing.
- With ticket 31 (merged in): the Items are the loader of the layout `sell-items`, which runs again after a refused form. When a sale is refused because an Item was retired meanwhile, that Item is gone from the screen and so from the selection that comes back; the rest of it returns. The revalidation that fetches a waiting message (above) also reads the Items again, once, and only when two sales overlapped.
- `e2e/support/held.ts` (`holdSubmissions`) holds the page's POSTs, and with `{ loads: true }` its data loads, until the test releases them. `e2e/pending-ui.spec.ts` taps each control with a real tap and reads it when the browser is about to paint the next frame. A scripted `element.click()` hides a real fault here: between the listeners of a real tap the browser runs microtasks, so a button that disables itself in the form's own `submit` listener is disabled before the router reads the form, and its `name` and `value` (the `intent`) are left out. That is why the button listens on `window`.
