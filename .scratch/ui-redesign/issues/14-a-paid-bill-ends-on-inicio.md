# 14: A Payment that closes its Bill ends on Inicio

**What to build:** On Cuenta, a Payment that leaves the Bill owing nothing closes it, and there is nothing left to do on that screen. Take the User to Inicio and say there that the Bill is paid and closed, with the amount, the method, the Customer and, for cash, the change to hand over. A Payment for part of what is owed keeps its result on Cuenta; Vender's sale and Abonar are unchanged.

**Blocked by:** none

**Status:** resolved

**Spec:** [UI redesign](../spec.md) §5.4, §6.1.

- [x] Once the server confirms a Payment that leaves nothing owed, the User lands on Inicio, whose read counts the Payment. Its words are **Cuenta pagada y cerrada.** with the amount, the method and the Customer, and the focus is on them.
- [x] The cash change stays in sight on Inicio until the User goes on (§5.4). Nothing takes it away by itself.
- [x] It is said once: not by a reload, not by Back and Forward, not in another tab. The URL and the browser's storage hold none of it.
- [x] Back from Inicio is the Bill: an Admin's to open; for a Worker, the screen that says it is no longer open (spec §4.1). A Worker is never sent into a Bill they may not open.
- [x] When the read of Inicio fails, what stands in still says what was recorded, change included, and gives way to Inicio once it can be read (§6.1).
- [x] A Payment confirmed after its step was left, or while a read of the Bill was on its way, still closes the Bill and ends on Inicio, and is recorded once.
- [x] A partial Payment, Vender's sale and Abonar keep their result on their own screen.
- [x] The tour has the landing for both roles; the accessibility scan and the layout sweep pass on it. Full suites pass.

## Answer

When the answer to a Payment says `paid`, Cuenta (`app/routes/bill.tsx`) navigates to `/inicio`, replacing the Cobrar step's history entry, with `carry(outcome)` as the navigation's state. `~/shared/recorded` holds the result in the page's memory and the state only an id, so only that navigation can say it. Inicio (`app/routes/inicio.tsx`) reads it with `useCarried(useLocation())`, says it over its cards with the `Change` card, and focuses it before the shell would focus `<main>`. It is forgotten as it is shown, and gone from the screen when the User moves to another entry. The result is held by `useRecorded` on Cuenta while Inicio is read and on Inicio after, so `ErrorScreen` keeps saying it, and now shows the change too.

`billPaymentOutcome` says a closing Payment as **Cuenta pagada y cerrada**: "$23.50 por transferencia. La cuenta de Familia Ruiz ya no debe nada." A partial one is unchanged: **Pago registrado**, "… todavía debe $X."

Decided here, and worth a look:

- **Inicio, not Cuentas abiertas.** The request named the home page. Inicio is where a User lands after Entrar, and its figures count the Payment just taken.
- **The result shows on Cuenta for as long as Inicio is read**, then Inicio says it. A slow connection shows the result, not a blank.
- **Replace, not push.** Back is the Bill, not a Cobrar step for a Bill that owes nothing.
- **In memory only.** The redesign's notice rules keep a result off the URL and out of storage (§6.1, §6.2), so a reload on Inicio says nothing. The landing is the one Notice that leaves its screen, and the spec now says so.
- **Only Cuenta.** Vender's result already offers **Nueva venta**, which is the next thing to do after a sale, and Abonar's offers **Ver cliente**. Neither was asked for.

Tests: `tests/bill-payment.test.ts` (the closing outcome's words). In the browser, `e2e/cuenta-cobrar.spec.ts`: a Worker lands on Inicio, focused, with Cobraste hoy counting the Payment, Back says the Bill is no longer open, and Forward says nothing again; an Admin with $50.00 change goes back to the Bill; a refusal, then the Payment typed again against the changed Bill; a Payment confirmed by its retry after its step was left; one answered while a held read of the Bill was on its way; the 320px keyboard run with a long Customer name. `e2e/after-recording.spec.ts` adds a closing Payment whose Inicio cannot be read. `e2e/support/bill.ts` has `payInFull`, `closedNotice` and `backToBill`; `corrections`, `historial`, `journeys` and `payments` use them. The tour has the landing for both roles. `e2e/support/held.ts` now lets go of a held read the page gave up on (another navigation replaced it), which Playwright had already let go of.

Results, 2026-10-15: `npm run verify` — 77 files, 884 tests passed. `npm run test:e2e` — 427 passed, 1 skipped. Nothing was deployed and nothing ran against production.

Left open:

- A reload on Inicio, or a tab closed, loses the words, as it does for every confirmed result. The Payment is recorded and Inicio's figures count it; the change has to be worked out again.
- What a screen reader says as Inicio's notice takes the focus is for a person to hear: added to verification.md §7.1.
