# 08: Inspect Stock and record Adjustments

**What to build:** An Admin opens Inventario, finds an Item, understands its recorded Stock and warnings, and records or cancels an Adjustment through a focused, understandable flow. Establish the redesigned Stock entry point; retain working paths to existing Conteo and Diferencias until ticket 09 completes them.

**Blocked by:** 01 — Sign in and navigate the redesigned app.

**Status:** ready-for-agent

**Spec:** [UI redesign](../spec.md) §§2.4, 4, 6–10.

- [ ] Inventario is a readable, searchable list of stock-tracked Items with Existencias, optional Minimum and distinct at/below-Minimum and negative-Stock warnings. Warnings use words as well as color.
- [ ] Registrar entrada and Contar existencias are prominent. Merma, Consumo interno, Adjustment cancellation and contextual Diferencias access are discoverable without expanding every form at once.
- [ ] Recording an Adjustment clearly identifies the Item, reason, positive whole-unit quantity and optional note. Entrada adds units; Merma and Consumo interno subtract them. Explain the effect before the final action.
- [ ] Cancelling an Adjustment requires the existing reason and reverses its effect under existing rules; no direct editing of the Stock number or deletion of facts is introduced.
- [ ] Immediate local pending feedback precedes server confirmation. Do not optimistically change Stock; preserve input on refusal and handle uncertain outcomes without claiming success/failure or blindly creating another Adjustment. Safe retries of creation retain submission identity/content.
- [ ] Newly recorded/cancelled Adjustments remain attributable and visible through existing History. The redesigned Historial is not a prerequisite for preserving those records.
- [ ] Stock remains authoritative and uncached according to the app's current contract. Zero/negative Stock is a warning, never a reason to prevent selling.
- [ ] Useful empty/search-no-results/loading/error/success states use the shared accessible form patterns. Keyboard focus, mobile keyboard and sticky navigation do not obscure quantity entry or actions.
- [ ] Browser tests cover search, both warning types, all three Adjustment reasons and cancellation, validating resulting Stock and History facts. Verify Worker refusal, duplicate submission protection, large/long content and small/enlarged-text layouts.
- [ ] Run focused tests and project verification; preserve request budgets and server-enforced Stock ownership by domain operations. No production changes are part of this ticket.
