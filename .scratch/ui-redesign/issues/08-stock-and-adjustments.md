# 08: Inspect Stock and record Adjustments

**What to build:** An Admin opens Inventario, finds an Item, understands its recorded Stock and warnings, and records or cancels an Adjustment through a focused, understandable flow. Establish the redesigned Stock entry point; retain working paths to existing Conteo and Diferencias until ticket 09 completes them.

**Blocked by:** 01 — Sign in and navigate the redesigned app.

**Status:** resolved

**Spec:** [UI redesign](../spec.md) §§2.4, 4, 6–10.

- [x] Inventario is a readable, searchable list of stock-tracked Items with Existencias, optional Minimum and distinct at/below-Minimum and negative-Stock warnings. Warnings use words as well as color.
- [x] Registrar entrada and Contar existencias are prominent. Merma, Consumo interno, Adjustment cancellation and contextual Diferencias access are discoverable without expanding every form at once.
- [x] Recording an Adjustment clearly identifies the Item, reason, positive whole-unit quantity and optional note. Entrada adds units; Merma and Consumo interno subtract them. Explain the effect before the final action.
- [x] Cancelling an Adjustment requires the existing reason and reverses its effect under existing rules; no direct editing of the Stock number or deletion of facts is introduced.
- [x] Immediate local pending feedback precedes server confirmation. Do not optimistically change Stock; preserve input on refusal and handle uncertain outcomes without claiming success/failure or blindly creating another Adjustment. Safe retries of creation retain submission identity/content.
- [x] Newly recorded/cancelled Adjustments remain attributable and visible through existing History. The redesigned Historial is not a prerequisite for preserving those records.
- [x] Stock remains authoritative and uncached according to the app's current contract. Zero/negative Stock is a warning, never a reason to prevent selling.
- [x] Useful empty/search-no-results/loading/error/success states use the shared accessible form patterns. Keyboard focus, mobile keyboard and sticky navigation do not obscure quantity entry or actions.
- [x] Browser tests cover search, both warning types, all three Adjustment reasons and cancellation, validating resulting Stock and History facts. Verify Worker refusal, duplicate submission protection, large/long content and small/enlarged-text layouts.
- [x] Run focused tests and project verification; preserve request budgets and server-enforced Stock ownership by domain operations. No production changes are part of this ticket.

## Answer

Inventario is a shadcn screen built like Cuentas, and a change of Stock is sent the way Abonar is: frozen at the tap, and said only as what is known.

- **The list** (`app/routes/inventario.tsx`) is one card per stock-tracked Item: its name, **Existencias** large, **Mínimo** or "Sin mínimo", and in words **Reponer** (at its Minimum or under), **Bajo cero** and **Retirado**. A line over it counts the first two. The search is the screen's own, over every Item, ignoring case and accents; nothing is asked of the server and it is kept while a step is open. No form is on the list.
- **The ways in**: **Registrar entrada** and **Contar existencias** lead. A row opens the step for its Item. "Registrar merma o consumo interno", "Ajustes recientes" and "Diferencias de los conteos" are one link each. Conteo and Diferencias are as they were.
- **The steps** are addresses of the same screen: `?paso=ajustar` (with `producto` and `motivo` when the link knows them), `?paso=ajustes`, `?paso=cancelar&ajuste=…`. The step that adjusts has the Item, the reason as three choices that say "Suma unidades" or "Resta unidades", the units and the note, then what it will do ("Suma 4: Agua pasa de 6 a 10 en existencias", with "Queda bajo cero" when it does) and one action named by its effect ("Registrar merma de 2"). The step that cancels shows the Adjustment, says what cancelling reverses, owes its reason and has "Cancelar entrada de 4".
- **Recording** is `~/shared/stock-change` (`stockChangeAfter`: editing, recording, unknown, confirmed), sent with `sendForRecord` to the new `/inventario/ajustar` (`app/routes/resources/record-stock-change.ts`), which answers the Item's Stock as the change left it. The page has no action any more. No Stock on screen moves before the answer; a refusal keeps what was typed and reads the screen again; an unknown outcome is never called failed and is retried as the very same snapshot, under the same submission key. A cancellation needs no key: sent again after a lost answer it is refused as a second, and the route answers it as cancelled when the Adjustment carries this Admin's own cancellation with the same reason (`adjustmentStanding` in `~/backend/inventory`).
- **Nothing about Stock changed**: `recordAdjustment` and `cancelAdjustment` are untouched, a Worker is refused the screen, its steps and the route (403), and Historial shows every Adjustment and cancellation as before.

Changed outside the screen:

- `Notice` breaks a long word instead of letting it stick out of a 320px phone with text twice as large.
- The tests that posted to `/inventario` send to `/inventario/ajustar` (`recordStockChange` in `tests/support/sales.ts`); the browser tests of Historial, Conteo and the pending UI drive Inventario with `e2e/support/stock.ts`.
- The browser test of a restored document sending a changed Adjustment under a used key is gone: no screen renders an Adjustment's key any more. `tests/submissions-routes.test.ts` still holds the rule through the Worker.

Results, 2026-10-08: `npm run verify` — 73 files, 800 tests passed. `npm run test:e2e` — 328 passed (Android and iPhone shapes). New: `tests/stock-change.test.ts` (16 tests). Rewritten: `e2e/inventario.spec.ts` (9 tests), `tests/inventario.test.ts`.

Left open:

- Without JavaScript an Adjustment can no longer be recorded: the steps render, their action needs the browser's `fetch`. Cuenta's Payment and Abonar made the same trade.
- A second tap on a way back while the first is still loading goes back twice (`navigate(-1)`), as on Cliente. The review named it; neither screen was changed.
- A read that fails after a refusal is the shared error screen, as on Cuenta and Cliente; no browser test of it here.
- Zero Stock with no Minimum carries no warning: spec §5.8 flags at or below the Minimum and below zero, nothing else.
- When two fields are missing each says so and the first takes the keyboard; there is no separate error summary.
- Only the 50 most recent Adjustments can be cancelled from the screen, as before.
- The review also named duplication left alone: the reason choice's label classes are PaymentEntry's, and the sign of a reason is asked in four places.
- No automated accessibility scan, screen reader or real device: that is ticket 12's.
