# 30 — Acknowledge every tap: pending and optimistic UI

Status: ready-for-agent
Blocked by: 27
Spec: [`../spec.md`](../spec.md) §3.4, §2.2

## What to build

Spec §3.4 asks that every tap be acknowledged at once. Make it true screen by screen, with one rule about money.

- **Vender:** the selection empties the moment Dejar abierta or Cobrar is submitted, the screen says the sale is being recorded, and the next selection can start at once. If the server refuses, the selection comes back with the message. The screen says "pagada" or "registrado" only after the server confirms.
- **Harmless and reversible changes** show their result at once and revert on refusal: retiring and restoring a Customer, an Item's Minimum, a User's role and active state.
- **Money and Stock** (a Payment, Abonar, a correction, an Adjustment, a Count) show a pending state on the control that was tapped and never their result before the server confirms.
- Use React Router's fetchers and `useNavigation`; no client-side store.

## Acceptance criteria

- [ ] Every submit control in the app shows a pending state within one frame of the tap, tested in the browser suite with a delayed response.
- [ ] On Vender a second sale can be started while the first is still being recorded, and both are recorded.
- [ ] A refused sale restores the selection it emptied.
- [ ] No screen shows a Payment, an Abono or a Stock change as recorded before the response arrives.

## Comments

- 2026-10-06: Opened from the decision to follow the best patterns for forms. Blocked by 27 because the messages move to the redirect there.
