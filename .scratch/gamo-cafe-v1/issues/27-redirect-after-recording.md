# 27 — Answer every recorded form with a redirect

Status: ready-for-agent
Blocked by: —
Spec: [`../spec.md`](../spec.md) §3.4, §8.1, §8.3

## What to build

Several actions answer success with data, so a document POST re-renders the page and a reload submits the form again. The Count already redirects; the others should.

- Every action that records something answers success with `redirect(...)`: Vender (Dejar abierta, Cobrar, adding to a Bill), Abonar on a Customer's page, the forms on Cuenta, Inventario's Adjustment and its cancellation, and the Admin forms on Clientes, Productos and Usuarios. A refusal still answers 400 with its Spanish message on the same form.
- What the screen says afterwards ("Cuenta pagada: $…", "Abono de $… registrado.") travels with the redirect in a short-lived cookie that the next loader reads and clears, in one small server module that every route uses. The message is never built from the URL.
- Vender still empties the selection and starts a new form after a recorded sale, and still shows the recorded Bill's id on the status message for the browser tests.
- Update `tests/proof-budget.test.ts` for the statuses that become 302.

## Acceptance criteria

- [ ] A document POST that records something answers 302, and the page it lands on shows the same message as today, once.
- [ ] Reloading that page, or going back and forward, neither repeats the message nor records anything.
- [ ] With JavaScript loaded the same forms behave as before to the User: pending text at once, then the message.
- [ ] A refused submission keeps the form's contents and shows its message.
- [ ] `npm run verify` and the Playwright suite pass.

## Comments

- 2026-10-06: Opened from the research (§3.5) and the decision to follow form best practices throughout.
