# 05: Find a Customer and collect outstanding money

**What to build:** A User finds or adds a Customer, understands what they owe and records one handover across their Open Bills through Abonar. Redesign Clientes and Customer detail, including the Admin management actions and permitted history, using the payment interaction established by ticket 02. Existing Bill detail links work independently of ticket 03's redesign.

**Blocked by:** 02 — Record a sale through confirmation-first checkout.

**Status:** ready-for-agent

**Spec:** [UI redesign](../spec.md) §§4–8, 10.

- [ ] Clientes supports accessible search and adding a Customer, shows existing matches before creation, and preserves case/accent-insensitive duplicate-name rules and useful validation.
- [ ] Customer detail leads with identity and current Owed, then Open Bills and a clearly discoverable Abonar action. Preserve note/context, grouped handover history and Admin-only past Bills.
- [ ] Abonar defaults to all current Owed and accepts a smaller positive amount, with Efectivo/Transferencia and optional cash-change help. Explain that it pays the oldest Open Bills first.
- [ ] One handover records one Payment per affected Bill, all or nothing, with correct authorship and grouping. An overpayment or stale Bill set changes nothing and gives a useful message. Part cash/part transfer remains sequential handovers.
- [ ] Pending/confirmed/refused/unknown states use the established payment behavior. Preserve submitted context and reuse the original identity/content for a safe retry; never optimistically reduce Owed or create duplicate Payments.
- [ ] Admins can rename, retire and restore Customers with clear consequences. A retired Customer is unavailable for new Bills but their existing debts remain collectable. Workers cannot perform restricted management or see restricted past Bills.
- [ ] Customer selection/creation within selling retains the same accessible labels, recognition and validation patterns without losing the sale draft.
- [ ] Retain applicable paging, accessible Cargar más, filters/return position, and useful empty/loading/error states. Provide clear routes between Customer, Open Bills and collection without requiring repeated trips through Más.
- [ ] Browser tests cover search/add/duplicate refusal, oldest-first partial/full Abonar, mixed-method sequential handovers, stale submissions, safe retry and retire/restore permissions. Assert actual Payment/Bill results and test mobile, keyboard and enlarged-text usability.
- [ ] Run focused tests and project verification; preserve existing request budgets and domain semantics. No new Customer features or production changes are included.
