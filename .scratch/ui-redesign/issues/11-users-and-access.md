# 11: Manage Users and access

**What to build:** An Admin can add a User, provide their sign-in code, understand and change roles/status, and revoke sessions through a readable Usuarios experience. Connect code issuance to the redesigned Entrar journey while retaining every access safeguard.

**Blocked by:** 01 — Sign in and navigate the redesigned app.

**Status:** resolved

**Spec:** [UI redesign](../spec.md) §§2.4, 4, 6–10.

- [x] Usuarios clearly identifies each User, role and active state with readable text. Add User and code issuance are discoverable without confusing a staff User with a Customer.
- [x] Issued codes are readable, understandable and usable by the recipient through Entrar, with their one-time/expiration meaning explained. Preserve the existing code format, expiry, storage and session model.
- [x] Role changes, activation/deactivation and signing out everywhere state their actual consequences. Deactivation still revokes access; harmless changes may use existing reversible optimism but confirmation/error wording must remain truthful.
- [x] Preserve the last-active-Admin rule, including concurrent requests, and server enforcement of every Admin action. A Worker cannot obtain these controls or sensitive data through direct requests.
- [x] Role changes or session revocation on another phone are reflected on the affected User's next request according to existing behavior, without leaving a misleading navigation/access state.
- [x] Pending feedback is immediate and local. Server refusal restores authoritative state and explains the next action; success Notices/code display remain associated with the submitting action rather than another tab.
- [x] Browser tests follow Admin add/issue code → recipient sign-in and exercise role/status/session changes, expired/used codes and last-Admin refusal. Existing authentication/rate-limit guarantees remain tested.
- [x] Cover empty/loading/error states, long User names, readable codes, keyboard/focus, 320 px layout, enlarged text and screen-reader naming. Salir and destructive access actions are not confused with ordinary primary task actions.
- [x] Run focused tests and project verification. Use test Users only; do not issue production credentials, publish codes or alter live sessions.

## Answer

Usuarios is a shadcn screen with every form in a step of its own, as Productos is. The forms stay `<Form>`s answered by the page's action with a notice. Nothing in `app/backend/` changed: the code's format, its 10 minutes, the hashes that are stored, the sessions and the last-active-Admin rule are as they were. The README's "Signing in" is the guidance.

- **Usuarios** (`app/routes/users.tsx`) says who it lists — those who work with the app and sign in with a code — and that Customers are added on Clientes. The list is the active Users, then **Usuarios desactivados**, apart and marked in words; each row has the name, the role and "Eres tú". No form is on it. **Agregar usuario** leads it.
- **Agregar usuario** (`?paso=nuevo`) has Nombre and Rol, with what each role may do under the field. It answers with the new User's code and stays, empty, for the next one. A name that is missing or taken is said on the field, which takes the keyboard and keeps what was typed.
- **One User** (`?paso=usuario&id=…`) names them and shows role and state as words, then a part for each action, each saying what it does before it is tapped: **Dar código nuevo** (other phones keep their session), the role (what it gives or takes, seen on their next tap, nobody signed out), **Cerrar sesión en todos los teléfonos**, and **Desactivar usuario** (sessions and unused codes end, records stay) or **Reactivar usuario**. On the Admin's own step each says what it does to them. The step is the confirmation; no dialog asks again. The two that take access away are `destructive` buttons.
- **The code** is two groups of four in an `<output>`, spelled for a screen reader, with how it is typed on Entrar, that it works once, for 10 minutes, and is not shown again. It travels only in the answer of the form that issued it. It stays through the forms sent after it and goes when the User is deactivated, which ends it; it does not come back on reactivation.
- **The last active Admin**'s step says so and offers neither a change of role nor a deactivation. A page that still offered one is refused by the operation; the Users are read again after a refusal (`shouldRevalidate`), so the step is then what the server has, and the refusal takes the keyboard.
- **A Worker** is refused by `requireAdminUser` before a form is read (a form nobody understands was a 400 for them, and is a 403 now) and by `requireAdmin` in every operation.

Decided here, and worth a look:

- **No optimism any more.** The old rows showed a role and the active state before the server answered. The ticket allows keeping that; this drops it. Both decide who gets in, deactivation is not harmless, and the rest of the redesign says what happened only once it did. Every button is pending from the tap ("Desactivando…"), and nothing else moves. This reverses v1 issue 30 for Users: its two tests left `e2e/pending-ui.spec.ts`, and `e2e/usuarios.spec.ts` holds the new behavior. The README's optimism rule now names only a Customer's retirement.
- **No dialog before deactivating or signing out everywhere**, including for oneself. The only Admin who signs themselves out everywhere is told nobody else can give them a code, and to give themselves one first; the action is still offered, since it is what a lost phone needs.

Found on the way:

- The first browser run showed a code that deactivation had ended coming back when the User was reactivated. It is kept off.
- The review found sentences that were false in a corner, all fixed: "su sesión sigue abierta" on a deactivated User's role, "Díselo" on the Admin's own code, "necesita un código nuevo" after a sign-out (a code issued just before still works), and a grammar mix on the only Admin's step. It also found a refusal that left the keyboard on nothing when the tapped button went away with the page read again.

Changed outside the screen:

- `~/shared/role` gained `roleMeans`. New `e2e/support/users.ts`.
- `tests/permissions-matrix.test.ts`: a Worker's POST to `/usuarios` is 403. `tests/ui-spanish.test.ts` sweeps the steps. `tests/submit-controls.test.ts` expects more than 15 `<SubmitButton` uses, not 20: a User's five forms are written once.
- `e2e/reuse.spec.ts` drives the role change from the User's step.

Results, 2026-10-08: `npm run verify` — 74 files, 845 tests passed. `npm run test:e2e` — 356 passed (Android and iPhone shapes). Rewritten: `e2e/usuarios.spec.ts` (9 tests per shape: add → code → Entrar on another phone, a used and an expired code, sign-out, deactivate and reactivate, role on another phone, last-Admin refusal from a stale page, self sign-out, pending, Worker, 320px with text twice as large and the keyboard alone). Extended: `tests/usuarios.test.ts`, `tests/last-admin.test.ts`. The rate limit stays in `e2e/sign-in.spec.ts` and `tests/sign-in.test.ts`, untouched. Only test Users were made; nothing ran against production.

Left open:

- Self-deactivation with another Admin present has no browser test; its wording and the operation's are covered separately.
- The action does not check that a form's `userId` is the step's: a hand-made POST to one User's step about another is recorded and its notice shows under the wrong name. An Admin may do either anyway.
- Without JavaScript a refused form comes back with its fields as stored, not as typed, as on Productos.
- The review named duplication left alone: `stepOf`/`stepHref` and the effect that takes the keyboard to a new step's heading are written again here as on Productos (seven routes have that effect now, and a shared hook is due); `title` is in two e2e supports; `e2e/reuse.spec.ts` still opens its own second phone.
- No automated accessibility scan, screen reader or real device: focus, names, keyboard, 320px and 200% text are asserted in `e2e/usuarios.spec.ts`; the rest is ticket 12's.
