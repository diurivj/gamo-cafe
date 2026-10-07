# 10: Manage Items and Categories

**What to build:** An Admin can maintain the catalog through an approachable Productos list and Item detail forms, understand consequential settings, and verify that changes appear correctly in selling and Stock. Redesign the catalog journey without adding photo management or changing recorded history.

**Blocked by:** 01 — Sign in and navigate the redesigned app.

**Status:** ready-for-agent

**Spec:** [UI redesign](../spec.md) §§2–4, 7–10.

- [ ] Clearly distinguish catalog management from selecting Items to sell. Provide readable active/retired Item and Category management with discoverable creation, editing and permitted retirement/restoration.
- [ ] Item forms retain name, positive price, Category, stock-tracked flag, optional Minimum and applicable starting Stock. Labels and validation explain meaning rather than exposing implementation terms.
- [ ] Preserve case/accent-insensitive active Item-name uniqueness and existing Category constraints/order. Category controls do not depend on precise drag gestures or hover.
- [ ] Explain that new prices affect future Lines, retiring an Item removes it from selling without erasing past records, and changing stock tracking does not rewrite past Stock movements.
- [ ] Starting Stock remains an Entrada when applicable, not a direct projection edit. Historical Lines retain their original prices; existing Stock/history can still be reconstructed.
- [ ] Category additions/renames do not require an illustration. Names and prices remain sufficient for recognition; no Item-photo storage or catalog redesign beyond the agreed scope is introduced.
- [ ] Forms provide immediate pending feedback, clear server-confirmed results, retained input on validation refusal and understandable unavailable/retired states. Do not optimistically present starting Stock as recorded.
- [ ] End-to-end tests cover Item/Category creation and editing, ordering, applicable retirement/restoration, duplicate/constraint refusal, Stock settings and visibility in the existing selling/Stock screens. Those screens' redesign tickets do not gate this behavior.
- [ ] Verify Admin-only server enforcement, 320 px/enlarged-text forms, long names, keyboard operation, labels and error focus. Avoid generic dense tables or color-only status.
- [ ] Run focused tests and project verification; no change to historical domain facts or production catalog data is authorized.
