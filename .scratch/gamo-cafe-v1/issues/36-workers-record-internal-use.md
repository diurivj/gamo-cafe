# 36 — Workers record Internal use

Status: resolved
Blocked by: none
Spec: [`../spec.md`](../spec.md) §4.1, §4.2, §5.8, §6.1

## What to build

The owner asked that normal employees can add internal consumption. A Worker records an Internal use — units of a stock-tracked Item that staff consumed or gave away — and is still shown no Stock. Restock, Waste, cancelling any Adjustment and Counts stay an Admin's, and so does Inventario.

- **A screen of its own**, Consumo interno (`/consumo-interno`), for every User: one step (the Item, the units, an optional note, what it will do in words), then its result. It is a link of Más for both roles.
- **An operation of its own**, `recordInternalUse`: the Adjustment `recordAdjustment` writes, with the reason already said, by whoever is signed in. `recordAdjustment` keeps its Admin gate for every reason.
- **Nothing of Stock** on the screen, in its answer or in its refusals (spec §4.2).
- **The recording screens' rules**: frozen at the tap with a submission key, sent with `sendForRecord`, said as on its way, refused, unknown or confirmed, and not left by accident while it is on its way.

## Acceptance criteria

- [x] A Worker records an Internal use from Más; Stock goes down by its units, the Adjustment carries the Worker as its author, and Inventario and Historial show it under their name. An Admin cancels it there.
- [x] Nothing on the screen, its answer or its refusals shows a Stock number.
- [x] A Worker is still refused, on the server, a Restock, a Waste, cancelling any Adjustment (their own Internal use included) and a Count.
- [x] A double tap, and a retry after a lost answer, record one Internal use.
- [x] On its way, refused, unknown and confirmed are said as on Inventario; a Worker is told that only an Admin can cancel it, and to ask one when its outcome is unknown, since Historial is not theirs.
- [x] The §4.1 matrix, its test, README and CONTEXT.md say the new rule.
- [x] The full suite passes: `npm run verify` and Playwright.

## Comments

- 2026-10-15: Opened from the owner's request ("make normal employees to be able to add internal consumption"), together with UI redesign ticket 14, and resolved in the same session. See the Answer.

## Answer

Any User records an Internal use on **Consumo interno** (`app/routes/consumo-interno.tsx`), sent to `/consumo-interno/registrar` (`app/routes/resources/record-internal-use.ts`). The operation is `recordInternalUse` in `app/backend/inventory.ts`; it and `recordAdjustment` share one private body (`adjustmentBy`), so the fact, the Stock statements and the submission (kind `"adjustment"`, no migration) are the same, and only the gate differs. The screen's state is `internalUseAfter` in `app/shared/internal-use.ts`.

Decided here, and worth a look:

- **A screen of its own, not Inventario opened to Workers.** Inventario is Stock from top to bottom; a Worker's step would have had to hide every number on it. Consumo interno shows none to anyone, and an Admin can still record one from Inventario as before.
- **Más:** an Admin's under **Inventario** (Inventario, Consumo interno, Diferencias); a Worker's in a new group, **Registrar**, after **Clientes y tu día**. It has a cup drawing of its own. Inicio's cards and Mi día are unchanged.
- **Only active stock-tracked Items are offered** (`internalUseItems`, names only). A retired Item's leftovers stay an Admin's, on Inventario. The units start empty: no default count is guessed.
- **A Worker cannot take one back.** Cancelling stays `cancelAdjustment`'s, Admin only, for their own Internal use too. The step says so before the action, and the result tells them to ask an Admin.
- **The Worker's role on Usuarios** now reads "Vende, cobra, registra el consumo interno y ve su propio día."

Tests: `tests/internal-use.test.ts` (the reducer, the draft, the snapshot and what it says), `tests/consumo-interno.test.ts` (the route), `tests/inventory.test.ts` (`recordInternalUse` and `internalUseItems`; a Worker refused `recordAdjustment` for every reason), `tests/permissions-matrix.test.ts` (both routes classified; the new row, and the renamed Admin row with a Worker's Waste and cancellation of their own Internal use refused), `tests/worker-visibility.test.ts` (no Stock on the page or in the answer), `tests/navigation.test.ts`, `tests/ui-spanish.test.ts`, `tests/usuarios.test.ts`, `tests/reuse.test.ts` (`no-store`). In the browser, `e2e/consumo-interno.spec.ts`: a Worker from Más to an Admin cancelling it on Inventario; on its way, frozen, the question before leaving, a lost answer retried once; what is missing and a refusal that reads the Items again; an Admin's unknown outcome pointing to Historial. The tour (`e2e/support/tour.ts`) has the screen's six states for both roles and the empty one, so the accessibility scan and the layout sweep cover them.

Results, 2026-10-15: `npm run verify` — 77 files, 884 tests passed. `npm run test:e2e` — 427 passed, 1 skipped. Nothing was deployed and nothing ran against production.

Left open:

- A Worker sees their own Internal use only on its result. Mi día could list it with their Lines and Payments.
- `recordInternalUse` accepts a retired stock-tracked Item when a hand-made request names one; the screen never offers it, and the Stock movement is legitimate either way.
- The §10.7 request budget does not measure Consumo interno; its read is one statement over the catalog, like Inventario's.
