# 10: Manage Items and Categories

**What to build:** An Admin can maintain the catalog through an approachable Productos list and Item detail forms, understand consequential settings, and verify that changes appear correctly in selling and Stock. Redesign the catalog journey without adding photo management or changing recorded history.

**Blocked by:** 01 — Sign in and navigate the redesigned app.

**Status:** resolved

**Spec:** [UI redesign](../spec.md) §§2–4, 7–10.

- [x] Clearly distinguish catalog management from selecting Items to sell. Provide readable active/retired Item and Category management with discoverable creation, editing and permitted retirement/restoration.
- [x] Item forms retain name, positive price, Category, stock-tracked flag, optional Minimum and applicable starting Stock. Labels and validation explain meaning rather than exposing implementation terms.
- [x] Preserve case/accent-insensitive active Item-name uniqueness and existing Category constraints/order. Category controls do not depend on precise drag gestures or hover.
- [x] Explain that new prices affect future Lines, retiring an Item removes it from selling without erasing past records, and changing stock tracking does not rewrite past Stock movements.
- [x] Starting Stock remains an Entrada when applicable, not a direct projection edit. Historical Lines retain their original prices; existing Stock/history can still be reconstructed.
- [x] Category additions/renames do not require an illustration. Names and prices remain sufficient for recognition; no Item-photo storage or catalog redesign beyond the agreed scope is introduced.
- [x] Forms provide immediate pending feedback, clear server-confirmed results, retained input on validation refusal and understandable unavailable/retired states. Do not optimistically present starting Stock as recorded.
- [x] End-to-end tests cover Item/Category creation and editing, ordering, applicable retirement/restoration, duplicate/constraint refusal, Stock settings and visibility in the existing selling/Stock screens. Those screens' redesign tickets do not gate this behavior.
- [x] Verify Admin-only server enforcement, 320 px/enlarged-text forms, long names, keyboard operation, labels and error focus. Avoid generic dense tables or color-only status.
- [x] Run focused tests and project verification; no change to historical domain facts or production catalog data is authorized.

## Answer

Productos and Producto are shadcn screens, with every form in a step of its own. They stay `<Form>`s answered by the page's action with a notice, not `sendForRecord`: a catalog change is no Bill, Payment or Count, and the forms still work without JavaScript. The README's "Productos: the catalog and its steps" is the guidance.

- **Productos** (`app/routes/productos.tsx`) says it is the catalog and that sales are recorded in Vender. The list is each active Category with the Items it sells — name, price, "Mínimo 6", "Lleva inventario" or "Sin inventario" — then **Productos retirados**, apart and marked in words. No form is on it. **Agregar producto** and **Categorías** lead it.
- **Agregar producto** (`?paso=nuevo`) has Nombre, Precio, Categoría, **Lleva inventario**, and, only while that is ticked, Mínimo and Existencias iniciales. It stays after each Item, empty, for the next. What it recorded comes from the operation's answer: "Se agregó «Agua mineral». Se registró una entrada de 24 en existencias." The Entrada is said only for an Item that counts its units, and nothing says so while the form is on its way.
- **Categorías** (`?paso=categorias`) lists them in Vender's order, each with "2 de 3 · 4 productos", **Subir** and **Bajar** (one place per tap, no drag, no hover) and the way into its own step; then **Nueva categoría** and the retired ones. A Category needs only its name.
- **One Category** (`?paso=categoria&id=…`) renames it and retires or restores it. One with active Items says how many and what to do first, and has no action; the operation refuses it again.
- **Producto** (`app/routes/producto.tsx`) says whether the Item is on Vender, and what a change does not reach, where the change is made: a new price is for what is sold from now on, switching stock tracking modifies nothing recorded, retiring takes it off Vender and erases nothing. Saving stays on the Item and says "Cambios guardados." (it used to go back to the list without a word). An Item in a retired Category says so in place of **Restaurar producto**; a name taken since is said when the restore is refused. Stock is not changed here: a link opens the Item's step on Inventario.
- **A refusal names its field.** `Refusal` in `app/catalog-forms.server.ts` gained `field`; `app/components/field-error.tsx` shows the reason under that field, marks it invalid and described by it, and takes the keyboard there. What was typed stays.
- **Nothing in `app/backend/` changed.** Starting Stock is still the Restock `addItem` writes in the Item's own batch; Lines keep their price; no fact and no projection is touched by these screens.

Found on the way:

- The old Productos lost what was typed when a refusal followed a recorded Item: its form was keyed by the last answer. The first browser test of the new step caught it; the forms that start over are now keyed by the last form recorded.
- The review found three more, all fixed: a sentence that said a restored Category "vuelve a Vender" (one with no active Item is not on Vender; Categorías now says so), the keyboard left on nothing when a move took a Category to an end of the list (its other button takes it), and a retired Item's page offering a restore its retired Category would refuse.

Changed outside the screens:

- New `app/components/back-link.tsx` and `app/components/field-error.tsx`; `ItemFields` is built from the shadcn fields. The box is the browser's own checkbox, so it ticks without a script and CSS can show the Stock fields by it.
- `e2e/fixtures.ts`: `addCategory(name, { retired })` and `addItem({ retired })`. New `e2e/support/catalog.ts`.
- The Productos tests of `e2e/pending-ui.spec.ts` and `e2e/reuse.spec.ts` drive the new steps; `tests/ui-spanish.test.ts` and `tests/reuse.test.ts` sweep them; `tests/permissions-matrix.test.ts` reads the retirement's own notice.

Results, 2026-10-08: `npm run verify` — 74 files, 839 tests passed. `npm run test:e2e` — 350 passed (Android and iPhone shapes). Rewritten: `e2e/productos.spec.ts` (8 tests per phone shape); extended: `tests/productos.test.ts` (25 tests). An earlier full run had one failure, Conteo's 320px test on the iPhone shape, in a file this ticket does not touch; it passed four times alone and in the next full run.

Left open:

- Without JavaScript a refused form comes back with its fields as stored, not as typed: the action does not send the typed values back. It was so before.
- A form that gets no answer at all is the shared error screen, as for every `<Form>`. Sent again, a new Item is refused by its own name, which is how the Admin learns the first one was recorded.
- Saving a name that only differs from the stored one by its spaces leaves the spaces in the field until the page is read again.
- A field holding a name longer than itself scrolls it, as any text field does; the heading above has it whole.
- Productos has no search of its own, unlike Inventario: Categories group it and the browser's search finds a name.
- The review named duplication left alone: the row that is a card and a link, and the line with a chevron, are written again here as on Clientes and Inventario; `BackLink` is what Conteo's own way back is, and Conteo was not moved to it.
- `FormRefusal.field` is a `string` in the browser and `CatalogField` on the server.
- No automated accessibility scan, screen reader or real device: focus, names, keyboard, 320px and 200% text are asserted in `e2e/productos.spec.ts`; the rest is ticket 12's.

