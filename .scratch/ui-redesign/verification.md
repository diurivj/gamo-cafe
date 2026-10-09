# UI redesign — verification of the complete experience

The record ticket 12 asks for (spec §10.1, §10.2): what was checked across the whole app, how to run it again, what it found, and what is still owed. A check that could not be run is listed as owed, never as passed.

Recorded 2026-10-09 on branch `gamo-cafe-v1`. Nothing was deployed and no production data was touched: every run used the local Worker (`workerd`) with a fresh local D1 per test.

## 1. Pilot-readiness decision

**Not ready to invite pilot Users yet.** The automated verification is complete and passes. Three checks the spec requires need a person or a device and have not been done (§7): a screen-reader pass, a keyboard pass by hand, and a real phone (keyboard, safe area, touch). Ticket 12 stays open until they are recorded here. An older phone has not been tried either; the spec accepts the documented throttled fallback of §4.10 in its place, and says what that is not.

Nothing found so far blocks the pilot. Everything the automated checks found was fixed (§5).

## 2. How to run it again

```sh
npm run verify      # typecheck, then 74 files / 846 tests in workerd against a real local D1
npm run test:e2e    # builds, then 418 browser tests: 209 per phone shape
```

| | |
| --- | --- |
| Machine | Apple M5 Pro, macOS 27.0.1, Node 24.21.0 |
| Browsers | Playwright 1.63.0: Chromium as `android` (Pixel 7, 412×839), WebKit as `iphone` (iPhone 15, 393×659). Laptop width (1280×800) is a shape of the layout sweep and of `smoke.spec.ts` and `navigation.spec.ts` |
| Accessibility engine | axe-core 4.13.0 through `@axe-core/playwright` |
| Result | `npm run verify`: 846 passed. `npm run test:e2e`: 417 passed, 1 skipped (the CPU throttle is Chromium's, so it does not run on WebKit) |

Both shapes are emulation: a desktop browser engine in a phone's viewport, with touch. Neither is a phone.

## 3. Every screen, in every state

`e2e/support/tour.ts` is the inventory: one stop per screen state, each opened from an address in a cafeteria that `e2e/support/cafe.ts` fills through the app's own routes (two Users, Stock above its Minimum, at it and below zero, a Bill in each state, a correction of each kind, Adjustments standing and cancelled, a Count with a shortage, a surplus and no difference, a long Customer name, a long Item name and a four-digit price).

| Walk | Stops | What it holds |
| --- | --- | --- |
| Signed out | 5 | Entrar; a refused code; too many refused codes; a session that ended; a path the app does not have |
| Admin, selling | 17 | Inicio, Más; Vender with nothing chosen, a selection, a search with no match; the review with cash handed over, a part over the total, a transfer with the Customer's matches; both questions before work is discarded; a sale on its way, of unknown outcome, refused; Pago registrado with change, for a part, Cuenta abierta; adding to an Open Bill |
| Admin, figures and Stock | 25 | Mi día; Día, with every part open, with a range that cannot be; Cuentas and filtered to nothing; Por cobrar; Inventario, its search, the Adjustment step (empty, below zero, nothing typed), recent Adjustments, a cancellation, one already cancelled, an Adjustment on its way and of unknown outcome, Entrada registrada; Conteo, an unreadable field, the review, a Count of unknown outcome, Conteo registrado; Diferencias; Historial |
| Admin, catalog and Users | 17 | Productos, adding an Item, a name taken, Categorías, a Category that cannot be retired; Producto stock-tracked, not tracked with a long name, retired; Usuarios, adding one, a name taken, a Worker's step, the only Admin's own step, a new code; a record that is not there, a path that is not there, a screen that failed to load |
| Admin, Bills and Customers | 26 | Cuentas abiertas and a search with no match; Cuenta Open, Partially paid, Paid, Voided, with removed records; Cobrar, a part that cannot be read, a Payment on its way, of unknown outcome with the question before leaving, Pago registrado with change; each correction's step, one that is blocked, a reason missing, a correction on its way; Clientes, matches, a name offered to be added; Cliente owing, with a long name, retired; Abonar, one of unknown outcome; Abono registrado |
| Worker | 39 | Inicio, Más, Mi día; the 15 selling stops and the 18 of Bills and Customers a Worker may open; an Admin's screen refused; a Bill that is no longer Open; a Payment for a Bill another phone closed |
| Nothing recorded yet | 21 | Every list and figure of an app its first Admin has just opened, and the five a Worker finds |

150 stops per phone shape. A new screen, step or state gets a stop in `tour.ts` and is then scanned and measured with the rest.

Spec §7's rows map onto them: Entrar (signed out); Shell and Más (selling, Worker); Inicio; Vender; Cuentas abiertas; Cuenta; Clientes; Cliente; Mi día; Día; Cuentas; Por cobrar; Inventario; Conteo; Diferencias; Historial; Productos; Producto; Usuarios; shared surfaces (the three error stops, the Customer picker on the review and on Cuenta, `PaymentEntry` on Vender, Cuenta and Abonar, the notices, `ConfirmDialog`, and **Cargar más**, which `load-more.spec.ts` drives).

Not stops, so neither scanned nor measured, and covered only by their screen's own spec: the second page of a list after **Cargar más**; a Count while it is on its way; the result of each remaining correction and of a cancellation; every refusal a rule can give beyond the ones above. Loading states are the shell's "Cargando…" (`navigation.spec.ts`) and the dimmed figures while Día or Cuentas read another range (`dia.spec.ts`, `cuentas-admin.spec.ts`, `pending-ui.spec.ts`).

## 4. What each check is, and what it found

### 4.1 Journeys across screens — `e2e/journeys.spec.ts`

One day on two phones, by the navigation a User has, ending on the facts. An Admin signs in with a code and adds two Items on Productos; adds a Worker on Usuarios, whose shown code signs him in on the other phone; the Worker sells in cash with change, by transfer, and leaves a Bill Open; Mi día, Inicio, Día, Por cobrar and Inventario each show it (and "Reponer" in words at the Minimum); he finds the Bill in Cuentas by Customer, takes a part, and the rest is an Abonar on Cliente; he removes a wrong Line, the Admin collects that Bill, removes the Payment and voids it, and Historial, Día, Mi día and Inventario follow; the Admin restocks, counts, and reads the shortage on Diferencias; a new price reaches the Worker's next sale and no Bill already recorded; the Worker is made an Admin, a Worker again and then deactivated, and his navigation follows on his next tap, the last one landing on Entrar.

It ends by reading the tables: five Bills and six Payments, each once, each by who recorded it; unit prices as they were when sold; Stock; and `verifyProjectionsSql` (`npm run projections:verify`'s own statement) finding no projection that disagrees with the facts. No page raised a script error.

The six journeys the ticket names are each also followed, with their rules, by a spec of their own:

| Journey | Also in |
| --- | --- |
| Sign-in → selling → Payment → figures and Stock | `sign-in`, `vender`, `payments`, `mi-dia`, `dia`, `inventario` |
| Open Bills → collection and Abonar | `cuentas`, `cuenta-cobrar`, `abonar`, `por-cobrar` |
| Corrections → Historial and figures | `corrections`, `historial`, `mi-dia` |
| Catalog changes → selling | `productos`, `reuse` |
| Count → Diferencias | `conteo` |
| User access → later navigation | `usuarios`, `reuse` |

### 4.2 Sending, and what can go wrong with it

Every screen that records with `sendForRecord`, against the six things the ticket lists. Each cell is a browser test that holds, fails or loses the request on purpose and then reads the tables.

| | Double tap | Held: pending, frozen, nothing shown as recorded | Refused | Failed before recording | Answer lost after recording, retried once | A read that fails after it is confirmed |
| --- | --- | --- | --- | --- | --- | --- |
| Vender: a sale | `vender-recovery` | `vender-recovery` | `vender-recovery` | `vender-recovery` | `vender-recovery` | `vender-recovery` (no read exists) |
| Cuenta: a Payment | `one-submission` | `cuenta-cobrar` | `cuenta-cobrar` | `cuenta-cobrar` | `cuenta-cobrar` | `after-recording` |
| Cuenta: a correction | `after-recording` | `corrections` | `corrections` | `corrections` | `corrections` | `after-recording` |
| Cliente: an Abonar | `abonar` | `abonar` | `abonar` | `abonar` | `abonar` | `after-recording` |
| Inventario: an Adjustment | `inventario` | `inventario` | `inventario` | `inventario` | `inventario` | `after-recording` |
| Inventario: a cancellation | `after-recording` | `inventario` | `inventario` | — | `inventario` | `after-recording` |
| Conteo: a Count | `conteo` | `conteo` | `conteo` | `conteo` | `conteo` | `after-recording` |

The dash: a request dropped before it reaches the server is exercised for the Adjustment, which is sent by the same code from the same screen; the cancellation has no browser test of that one case.

What "a read that fails after it is confirmed" does: nothing is read after a confirmed result until the User asks, so with every page read failing the result, its figures and its change stay. The read the User then asks for (**Ver cuenta**, **Ver cliente**, **Volver a Inventario**) fails into the shared screen inside the navigation, which now keeps saying what was recorded — "Pago registrado. $20.00 en efectivo…", then "Eso quedó registrado: no lo repitas" — instead of "puede que sí se haya guardado"; **Volver a intentar** shows the record, and the tables hold it once.

The `<Form>`s that are not money or Stock (Productos, Usuarios, Cliente y nota, a Customer's name) are pending from the tap and refused on their field: `pending-ui`, `productos`, `usuarios`, `bill-edits`, `redirect-after-recording`.

Kept, unchanged, from before the redesign: permissions (`tests/permissions-matrix.test.ts`, `route-guard`, `worker-visibility`), attribution, money and Stock rules, concurrency (stale revisions, two phones), the §10.7 request budgets and the no-write-on-read rule (`tests/proof-budget.test.ts`, `reuse`). No test was deleted in this ticket. The overlapping-sale assertions of v1 issue 30 were replaced in ticket 02 by `vender-recovery.spec.ts` (one sale at a time), and Usuarios' optimistic rows in ticket 11 by `usuarios.spec.ts`; both tickets say so.

### 4.3 Navigation, Back, lists, tabs

| | Where |
| --- | --- |
| Both roles' destinations, Más, deep links, what is refused or missing | `navigation`, `tests/navigation.test.ts` |
| Back between a screen's steps keeps what was typed; leaving unfinished work asks; leaving something on its way says it is not cancelled | `vender-recovery`, `cuenta-cobrar`, `corrections`, `abonar`, `inventario`, `conteo` |
| The browser is asked to warn before the page is closed (`beforeunload`) | `vender-recovery` only; the other screens share `useLeaveGuard` and have no test of it |
| A reload or Back and Forward on a result records nothing again | `redirect-after-recording`, `vender-recovery` |
| Paging, filters, scroll position and the way back to a list as it was | `load-more`, `cuentas-admin`, `por-cobrar`, `cuenta-cobrar` |
| A recorded form's words reach the tab that sent it and no other | `redirect-after-recording`, `tests/notice.test.ts` |

### 4.4 Automated accessibility scan — `e2e/accessibility.spec.ts`

axe-core on all 150 stops, on both engines, with its rules for WCAG 2.0, 2.1 and 2.2 at A and AA and its best practices. **No violation is left.**

Found and fixed: the destructive `Button` and `Badge` (red on a tint of itself) were under 4.5:1 on Cuentas, Inventario, Conteo's review, Diferencias and Usuarios. `--destructive` is darker now.

Set aside, on purpose: Base UI closes a dialog's focus trap with two empty spans, which on Safari are `role="button"` with no name so that VoiceOver's cursor stops at them. They are the library's. What VoiceOver says at a dialog's edge is on the list for the person who listens (§7.1).

**What a scan is not.** It checks what can be computed: names exist, roles and states are valid, text contrast, structure, duplicate ids. It does not tell whether a name is the right one, whether the order makes sense aloud, whether an announcement comes when it should, or whether anyone can work with the result. A clean scan is not conformance with WCAG 2.2 AA.

### 4.5 Layout — `e2e/layout.spec.ts`

Each of the 150 stops is opened once and measured in five shapes, on both engines:

| Shape | Criterion |
| --- | --- |
| 320×568 | Reflow, WCAG 1.4.10 |
| 320×568 with `html { font-size: 200% }` | Resize text, 1.4.4, at the hardest width |
| 320×568 with a reader's text spacing | 1.4.12 |
| 568×320 | Orientation, 1.3.4; also as short as a phone whose keyboard is up |
| 1280×800 | Laptop |

Measured in each: nothing scrolls sideways; no text is wider or taller than a box that cuts it; every control a finger aims at is at least 48×48px; and each control, given the focus in turn, is in sight and under neither the navigation bar nor anything that sticks (2.4.11, and spec §4.1). A control taller than the room there is must show a part a finger could find.

A link inside a sentence ("los clientes se anotan en Clientes") is as tall as its line, about 22px. WCAG 2.5.8 exempts it and so does the measure.

Found and fixed, all of them with text twice as large or with a long amount, on a 320px phone:

- **Amounts were cut by their card**: a Bill's **Debe**, **Cambio**, the Lines and Payments of Cuenta and of the review, a Customer's **Debe** and their Abonos, the rows of Cuentas abiertas, Vender's total. A four-digit amount at that size is wider than the card, and the card hides what sticks out. They wrap now (`figureRow` and `amount` in `~/components/styles`).
- **A button was wider than its dialog**: "Salir y descartar" at 200%. A `touch` button now keeps to its room and breaks a word that does not fit.
- **Más**, **Inicio**'s first card and a payment method's card had a word wider than their room. A long title word broke the page's width on WebKit.
- **The focus went under Conteo's bar** at ordinary text size, on a 320px phone and on a laptop, whenever the bar was taller than the fixed room the page left for it (two lines, or the message about a field that cannot be read). Vender's total did the same with a reader's text spacing. The bar now says how tall it is (`StickyBar`), and so does the navigation bar.
- **With text twice as large the two bars took 471 of a phone's 568px.** What sticks now stops sticking when it and the navigation bar would take more than half of the screen's height, and rests after the list.
- **WebKit left a focused field under the bar**: it reveals a field's caret without minding `scroll-padding`. The shell brings a focused field into the clear room, and what has the focus is brought clear again when a bar grows under it.

### 4.6 What a scan cannot judge and a browser can measure — `e2e/perception.spec.ts`

- **Non-text contrast (1.4.11) and the focus mark (2.4.7)**: the edge of a field, a select, a radio, an unselected choice and an outline button are at least 3:1 against the page; the selected choice is told by a darker, heavier edge and by weight, not by color alone; a focused field's edge darkens to at least 7:1 with a ring around it; a plain link's outline is at least 2px and 3:1.
- **Reduced motion (2.3.3)**: with `prefers-reduced-motion: reduce`, no animation or transition on Vender's step, its dialog or its result lasts longer than a millisecond, and none of them is waited for.
- **Zoom and keyboards (1.4.4, 1.3.5)**: the viewport tag does not limit zoom; the code field is `one-time-code`, with no length limit or input mode that would refuse a paste; money fields ask for a decimal keyboard and units for a numeric one, and none is a `type="number"` field.
- **Text contrast** is the scan's (§4.4).

### 4.7 The WCAG 2.2 AA criteria that apply, and how each was checked

"Scan" is §4.4, "layout" §4.5, "measured" §4.6, "tree" §4.8, "keys" §4.9. **Owed** means only a person can tell (§7). Criteria about audio, video, timing, flashing, CAPTCHA and drag gestures do not apply: the app has none.

| Criterion | Checked by | State |
| --- | --- | --- |
| 1.1.1 Non-text content | Scan; drawings are decorative beside text | Passes what a scan can tell |
| 1.3.1 Info and relationships, 1.3.2 Meaningful sequence | Scan, tree | Tree as expected; how it reads aloud is **owed** |
| 1.3.4 Orientation, 1.4.10 Reflow | Layout | Pass |
| 1.3.5 Identify input purpose | Measured (the code field) | Pass |
| 1.4.1 Use of color | Words beside every state (`BillStateBadge`, "Reponer", "Bajo cero"), drawings on notices, measured for the chosen method | Pass in what is tested; a person's look is **owed** |
| 1.4.3 Contrast, text | Scan | Pass |
| 1.4.4 Resize text, 1.4.12 Text spacing | Layout | Pass; the phone's own text setting is **owed** |
| 1.4.11 Non-text contrast | Measured | Pass for the controls measured |
| 1.4.13 Content on hover or focus | Nothing appears on hover or focus | Does not apply |
| 2.1.1 Keyboard, 2.1.2 No keyboard trap | Keys | Pass by automation; by hand **owed** |
| 2.4.1 Bypass blocks | Keys (skip link) | Pass |
| 2.4.2 Page titled | Tree, each screen's spec | Pass |
| 2.4.3 Focus order, 2.4.7 Focus visible | Keys, measured | Pass by automation; by hand **owed** |
| 2.4.6 Headings and labels | Scan, tree | Present and named; whether they are the right words is **owed** |
| 2.4.11 Focus not obscured | Layout | Pass |
| 2.5.3 Label in name | Scan | Pass |
| 2.5.7 Dragging, 2.5.1 Pointer gestures | No gesture is needed anywhere | Does not apply |
| 2.5.8 Target size | Layout, at 48px | Pass; links inside a sentence are exempt |
| 3.1.1 Language | `lang="es-MX"` (`smoke.spec.ts`) | Pass |
| 3.2.1 On focus, 3.2.2 On input | Nothing is sent or moved by focusing or typing, except a search as it is typed | Pass in what is tested |
| 3.2.6 Consistent help, 3.3.7 Redundant entry, 3.3.8 Accessible authentication | No help mechanism; a refused form keeps what was typed; the code can be pasted | Pass |
| 3.3.1 Error identification, 3.3.2 Labels, 3.3.3 Suggestion | Scan, tree, each screen's refusals | Pass |
| 3.3.4 Error prevention (financial) | The review step, the correction steps, one submission per form | Pass |
| 4.1.2 Name, role, value | Scan, tree | Pass, but for Base UI's focus guards on Safari (§4.4) |
| 4.1.3 Status messages | `role="status"` and `role="alert"` asserted in every screen's spec | Present; whether they are heard is **owed** |

### 4.8 What a screen reader is given — `e2e/reading-order.spec.ts`

The browser's accessibility tree — roles, names and their order — for the five walks spec §10.2 names: Entrar and its refusal on the field; the shell (a way past it, who is signed in, where they are) and Inicio; a sale's three screens; Día; an Adjustment. Each step's heading takes the focus when the step changes; a refusal is a `role="alert"` tied to its field; what a selection adds up to is in a polite live region.

This is the input a screen reader gets. It is not what one says (§7.1).

### 4.9 Keyboard

By automation, with real key events, in each screen's own spec: a sale from its first Item to **Nueva venta** (`vender.spec.ts`, the focus whole on screen at every stop), a Payment, a correction, an Abonar, an Adjustment, a Count, adding an Item and adding a User are each completed with the keyboard alone on a 320px phone; the skip link is the first stop; a dialog returns the focus to what opened it and Escape closes it; **Cargar más** works from the keyboard. Safari stops at links only with Option+Tab unless its setting says otherwise, and the tests press that.

A person has not yet done the same by hand (§7.2).

### 4.10 Responsiveness under a slowed processor — `e2e/perception.spec.ts`

Method: Chromium's DevTools protocol, `Emulation.setCPUThrottlingRate` at 6, on the M5 Pro above, against the local Worker, with 40 Items on Vender. The assertion is the frame, not a time: the page must show the tap's effect when the browser paints its next frame. Unthrottled, the same assertion is in every recording screen's spec, on both engines, with the server's answer held.

| Tap | By the next frame? | That frame came after |
| --- | --- | --- |
| An Item (first unit), no request | yes, asserted | 36 ms |
| Another unit, no request | yes, asserted | 15 ms |
| **Registrar pago**, the answer held | yes, asserted: "Registrando pago…" | 20 ms |
| **Cobrar**, to the review step | not asserted: an address change, no request | 105 ms to the step |
| A destination, to its screen | not asserted: marked and "Cargando…" by the router (`navigation.spec.ts`) | 408 ms to the screen |

The milliseconds are one run's, written down and not asserted. **This is a throttled desktop processor, not a phone.** It says nothing about a real device's memory, storage, radio or touch latency.

## 5. What changed in the app

Behavior a User can see, all found by the checks above:

1. **A destructive button or badge is a darker red** (`--destructive`).
2. **An amount of money is never cut**: too long for its line, it goes under its label or breaks. Same for a long word in a button, a title, a link of Más, a payment method.
3. **What sticks above the navigation bar measures itself**, and so does the bar: the focus stays clear of both at any text size. With very large text on a small phone it stops sticking and rests after the list (`StickyBar`).
4. **A focused field is brought clear of the bars** on WebKit too.
5. **Cuenta keeps a confirmed Payment or correction on screen** when a read of the Bill that was already on its way lands after the answer. It gave way to the Bill before, taking the result and the change to hand back off the screen. Left open by ticket 05, which fixed the same for Abonar.
6. **When the read after a confirmed result fails, the screen that stands in still says what was recorded** and that it is not to be repeated (`~/shared/recorded`). It said "puede que sí se haya guardado" before, about something it had just confirmed. Spec §6.1; left open by tickets 03, 05, 08 and 09.
7. **Cuenta's result also stays through the browser's Back** from its step to the Bill, until **Ver cuenta** or the list is asked for, as Cliente's does.
8. **A Worker who opens a Bill that is no longer Open is told so** — "Esta cuenta ya no está abierta. Se pagó o se canceló…" with **Cuentas abiertas** — instead of "No tienes acceso a esta página". The browser's Back leads there from the result of a Bill's last Payment. Still a 403, still nothing of the Bill shown. Left open by tickets 03 and 04.

Nothing under `app/backend/` changed. One dev dependency was added: `@axe-core/playwright`.

## 6. Limitations that do not block the pilot

- **A read that fails after a confirmed result** is answered by the shared error screen, which keeps the result's words but not its other parts: the change to hand back and what was sent are gone with the screen it replaced. A reload starts with nothing, as spec §6.2 allows.
- **With text twice as large on a 320px phone** a long amount breaks across two lines ("$1,253.0" / "0"). It is whole and it is ugly. At that size Vender's total is at the end of the list, not in sight while choosing.
- **The navigation bar's labels are 14px**, as ticket 01 decided, to fit four at 320px.
- **A quantity on Vender's step 1** ("2") is named "2 de Agua mineral" by an `aria-label` on an element with no role, which a screen reader may read as just "2". The buttons beside it name the Item, and the total is announced.
- **Without JavaScript** nothing that records money or Stock can be sent (tickets 03, 05, 08, 09). Productos, Usuarios and the lists work.
- **Sensitive to load, and fixed where seen**: with both phone shapes running at once, the large-text tests of Conteo and Usuarios read a focused control's place before the frame that brings it clear, and Conteo's measured a page whose font had not arrived. They wait for the frame (`inSight`) and for the font now. A font that arrives late still moves a page under a control that already has the focus; nothing re-reveals it then. Earlier tickets recorded one-off failures in `load-more` and `mi-dia`; neither was seen here.
- Everything earlier tickets left open and this one did not take (duplication between the recording screens, `stepOf`, the 50 most recent Adjustments) is still in their own files.

## 7. Still owed before the ticket closes

None of these can be done by a test or was done by other means. Each needs the app running (`npm run db:migrate && npm run seed:local && npm run dev`, then `npm run sign-in-code -- --user "Ana"`), and its result written under the item.

### 7.1 Screen reader

VoiceOver on an iPhone or a Mac with Safari, and TalkBack on an Android phone with Chrome if one is at hand. For each walk, note what is said and anything that is confusing, missing or repeated.

1. **Entrar**: the field's name and its hint; a wrong code is announced and the focus is on the field.
2. **Navigation**: the four destinations by name, which one is current, "Ir al contenido", Más by its headings, a new screen announced when it arrives.
3. **A sale and its Payment**: an Item's name and price; "2 de Agua mineral" or only "2" (§6); the total announced as it changes; the review's heading on arrival; Efectivo and Transferencia as a group with the chosen one; the change; "Registrando pago…" and then "Pago registrado" with what it says.
4. **A report**: Día's date, then Cobrado, Efectivo, Transferencia and Vendido, each with its amount; how an amount is pronounced.
5. **A Stock task**: Inventario's rows ("Reponer", "Bajo cero"); an Adjustment's reason with what it does; what will happen, before the action.
6. **A dialog** (Vaciar on Vender): its title and text, both buttons, Escape, where the focus returns; on Safari, what is said at the dialog's edges (§4.4).

Result: _not done._

### 7.2 Keyboard, by hand

The same five walks with a keyboard and no pointer, in Chrome and Safari on a laptop: every control reachable in a sensible order, the focus always visible and never under a bar, nothing that traps it, a dialog that returns it.

Result: _not done._

### 7.3 A real phone

An Android phone and an iPhone, in portrait and on its side: the on-screen keyboard over each field of Vender's review, Cobrar, Abonar, an Adjustment and Conteo (is the field in sight, is the action reachable, is it the decimal or numeric keyboard); the home indicator and the notch against the bar; a paste into Entrar; a tap on every bar and button with a thumb; the phone's own large-text setting, which is not the `font-size: 200%` the tests use.

Result: _not done._

### 7.4 An older or lower-powered phone

Spec §10.2 asks for one, or a documented throttled fallback. The fallback is §4.10. If an older phone is available: a sale from Inicio to Pago registrado on the cafeteria's own connection, noting the device, its browser and anything that lags behind a tap.

Result: _not done; the throttled fallback of §4.10 stands in._
