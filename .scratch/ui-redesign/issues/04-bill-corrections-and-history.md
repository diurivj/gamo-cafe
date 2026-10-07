# 04: Correct a Bill and understand its History

**What to build:** A User can correct a Bill within their permissions, understand the consequence before committing a consequential action, and an Admin can inspect the preserved record in Historial. Complete the correction areas of the redesigned Cuenta and the full History experience without treating records as deletable.

**Blocked by:** 03 — Find an Open Bill and collect a Payment.

**Status:** ready-for-agent

**Spec:** [UI redesign](../spec.md) §§2.4, 6–8, 10.

- [ ] Separate correction controls from routine selling/payment actions. Identify the affected Bill, Line or Payment and describe the consequence with a specific action label.
- [ ] A Worker can remove a Line only while the Bill has no effective Payment. An Admin needs a reason when removing a Line after Payment, removing a Payment or voiding a Bill; preserve all existing server gates and stale-revision protection.
- [ ] Refuse removing a Line if it would put the Bill total below paid money, with a useful explanation. Do not invent partial-Line edits or weaken existing correction rules.
- [ ] Bill cancellation clearly explains its effect on figures and Stock and that it cannot be undone. Do not offer an unsupported undo. Avoid repetitive generic dialogs for ordinary reversible editing.
- [ ] Pending and error feedback never presents a correction or Stock change as recorded before confirmation. Preserve necessary form context and do not blindly replay an unknown consequential operation as a new action.
- [ ] Historial covers removed Lines/Payments, Voided Bills, Customer/note changes, Adjustments and cancelled Adjustments, retaining affected records, author, time and required reason in readable Spanish.
- [ ] Original facts remain visible where appropriate. Corrections update the correct original Days' figures and restore Stock according to existing rules, not a newly invented UI calculation.
- [ ] History remains Admin-only, newest-first and cursor-paged, with accessible Cargar más, useful empty/error states, and coherent return navigation.
- [ ] End-to-end tests connect allowed corrections to Bill figures, Stock and History, and verify forbidden actions remain rejected. Cover keyboard confirmation/focus, long reasons, small screens and enlarged text.
- [ ] Run focused tests and project verification; record evidence without rewriting historical issue outcomes or deploying.
