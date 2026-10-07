# Gamo Cafe — complete mobile-first UI redesign

Status: agreed product direction; implementation not started.

This specification captures the approved redesign interview. The requested deliverable at this stage is this specification, not application changes. The eventual implementation covers the **whole app before the pilot**, so Users can test complete journeys through a consistent interface.

## 1. Purpose and audience

Gamo Cafe is a Spanish-language staff tool for one cafeteria, not a Customer-facing ordering app. It records consumption, Payments, debts and Stock.

The interface must support older adults and people with little confidence using web apps. Both Admins and Workers need the same care: one intended older User is an Admin. An initial walkthrough will be available, but ordinary work must be understandable independently afterwards, without remembering a tutorial.

Priorities:

1. Record a walk-up sale and immediate Payment confidently and with little effort.
2. Let Admins understand the Day's figures quickly.
3. Let Admins inspect and manage Stock without navigating a dense administrative interface.
4. Keep every less-frequent existing capability discoverable and usable.

Immediate payment is the user's best current estimate of the dominant selling scenario, not measured usage. Validate it with the pilot; do not remove Open Bills or partial Payments based on that assumption.

“Responsive” means both adapting to screen sizes and responding promptly to interaction, including on older phones and weaker connections.

## 2. Authority, scope and preserved rules

### 2.1 Sources of truth

- Domain vocabulary: [`CONTEXT.md`](../../CONTEXT.md). English domain terms in this spec correspond to the Spanish labels defined there.
- Existing product rules and permissions: [v1 spec](../gamo-cafe-v1/spec.md), particularly §§2, 4, 5, 7 and 10.
- Current implementation conventions: [`README.md`](../../README.md).
- Architectural decisions: [`docs/adr/`](../../docs/adr/), especially [history and attribution](../../docs/adr/0002-nothing-erased-per-action-authorship-derived-stock.md), [Stock never blocks a sale](../../docs/adr/0003-stock-never-blocks-a-sale.md), and [sign-in codes](../../docs/adr/0004-sign-in-by-one-time-code-without-passwords.md).

This spec governs the redesigned presentation, navigation and interaction behavior. It is not a replacement for the domain model or permission matrix. No glossary changes are needed: no domain concepts were introduced or redefined during the interview.

### 2.2 Explicitly superseded behavior

The v1 spec §3.4, [issue 30](../gamo-cafe-v1/issues/30-pending-and-optimistic-ui.md), README's Vender exception and current `app/routes/home.tsx` allow clearing the selection immediately and starting another sale before the first finishes.

**Replace that behavior with confirmation-first submission:** retain the sale context while recording, show explicit pending feedback, and start the next sale only after confirmation and an explicit **Nueva venta** action. The same single-in-flight behavior applies when recording a selection with **Dejar abierta** or adding it to an existing Bill. There is no overlapping-sale queue in the redesigned selling workflow.

This changes the UI, not submission idempotency, atomic writes or response-owned Notices. Fast Cloudflare/D1 execution does not guarantee a phone receives an answer; uncertain network outcomes need their own recovery state (§6).

During implementation, update the README and tests that prescribe the old interaction. Keep resolved issue files as historical records rather than rewriting their outcomes. Reconcile the relevant v1 UI wording with a cross-reference to this spec; unrelated domain requirements remain in force.

### 2.3 Included

- Complete information architecture and shared visual system.
- Every existing user-facing route, its forms, details, empty states, errors, confirmations and pending states.
- New navigation surfaces or intermediate steps needed by the redesign.
- Accessibility, mobile and desktop layouts, perceived responsiveness and safe recovery.
- Updated automated tests and a full-app pilot protocol.

### 2.4 Unchanged and out of scope

- Existing roles and server-enforced permissions. Worker screens must not expose Stock, another User's totals, restricted Bills or History.
- Existing money, Day, attribution, correction, Stock and concurrency rules; append-only facts and atomic operations remain intact.
- Selling at zero or negative Stock remains allowed. A Customer remains optional when leaving a Bill Open.
- A Count still hides expected quantities during entry and shows them at review.
- Authentication remains the existing one-time-code/session model.
- The current React Router, Tailwind, Workers, D1 and backend architecture stays; this is not a framework migration.
- No offline sales, service worker, background payment queue, additional payment methods, receipts, charts, exports or other expansion of the v1 product boundary.
- No separate “senior mode,” new mandatory onboarding tour, product-photo management system, or personalization system.
- Creating this spec does not authorize deployment or changes to production data.

## 3. Design principles and visual direction

### 3.1 Confidence over density

- Use plain, concise Spanish (Mexico), familiar task labels and concrete amounts.
- One unmistakable primary action per task step; supporting actions stay visible but visually secondary.
- Progressive disclosure may simplify optional fields and rare actions, but must not conceal essential actions behind unexplained icons or gestures.
- Show what happened, what is happening, and what the User can do next.
- Preserve entered information through validation failures and ordinary backtracking.
- Keep administrative screens as readable and approachable as selling screens.

### 3.2 Warm, restrained and distinctive

Use warm off-white surfaces, dark readable text, a restrained accent color, strong typographic hierarchy, simple dividers and solid primary buttons. Create character through typography, spacing, thoughtful Spanish and a consistent visual language.

Avoid decorative gradients, arbitrary dashboard-card grids, excessive pill-shaped containers, generic hero sections, gratuitous animation, faint text and coffee-themed decoration without a purpose. Do not trade contrast or clarity for an “elegant” appearance.

Exact accent hue, font selection, spacing tokens and corner radii are implementation discretion within these constraints, not unresolved product decisions. Prefer a lightweight font strategy with legible fallbacks; text and controls must not wait for a decorative asset.

### 3.3 Illustrations and recognition

- Use a small, consistent set of category illustrations when they genuinely help recognition, always alongside text.
- Keep Item names and prices prominent. Illustrations never replace names, amounts, warnings or action labels.
- Do not invent a product likeness that could make Users confuse similar Items.
- Categories without an appropriate illustration work equally well with their text label; adding a Category must not require creating an image.
- Product photos are not required for this redesign. Revisit only if pilot observations establish a recognition problem.
- Prefer small local assets; reserve their layout space. Decorative or text-redundant images have empty alternative text; meaningful nonredundant images have appropriate alternatives.

## 4. Information architecture

### 4.1 Mobile navigation

Replace the wrapping header link collection with four labeled bottom destinations:

| Role | Destinations, in order | Initial destination |
| --- | --- | --- |
| Admin | Vender · Día · Inventario · Más | Vender |
| Worker | Vender · Cuentas · Mi día · Más | Vender |

- Icons supplement persistent text labels. The current destination is visually and programmatically identified.
- Worker's **Cuentas** opens **Cuentas abiertas**, not the Admin-only all-Bills screen.
- **Más** is a readable destination with grouped, explicitly labeled links, not an icon-only overflow menu.
- Keep the signed-in User and role discoverable; provide **Salir** without placing it next to the primary task action.
- Detail screens have clear titles and a predictable way back to the relevant list. Preserve filters and list position where the existing app does.
- Browser Back must behave coherently with the two-step selling flow and the unfinished-work safeguards.
- Bottom navigation and a sticky selling total must not compete for the same space or hide content, keyboard focus or form controls. Respect mobile safe areas and the on-screen keyboard.

### 4.2 Remaining destinations

Admin's Más exposes **Cuentas abiertas**, **Cuentas**, **Clientes**, **Mi día**, **Por cobrar**, **Diferencias**, **Historial**, **Productos** and **Usuarios**. Group these by task, with short explanatory text where useful; do not produce another unstructured wall of links.

Worker's Más exposes **Clientes** and session information/actions. It contains no Admin-only links or placeholder capabilities.

Inventario also provides contextual access to Conteo and Diferencias. Clientes, Cuentas and Por cobrar retain their contextual paths to individual Customers and Bills. Important secondary workflows should not require returning to Más at every step.

### 4.3 Larger screens

Use available width for readable lists, summaries or side-by-side content without stretching text excessively. Navigation may adapt to a persistent side/top arrangement while retaining the same labels, grouping and role restrictions. Do not build a separate desktop product or show dense administrative tables merely because space is available.

Preserve existing URLs and query behaviors where practical. If routes change or are added, preserve reachable deep links and update route authentication and permission tests.

## 5. Selling and payment experience

### 5.1 Step 1 — choose Productos

- Present Items grouped by Category, with readable names and prices and optional category illustrations.
- Tapping an Item adds one unit and gives immediate feedback. Quantity controls clearly identify the affected Item.
- Keep the selected quantities and running total easy to inspect. The total and forward action remain readily available while browsing.
- Support adding, subtracting and clearing a selection without precise gestures. Clearing a nonempty selection must not silently discard work.
- Do not show a checkout action as available for an empty selection; explain the empty state.
- Continue to the review/payment step with a clearly labeled action such as **Cobrar**.

### 5.2 Step 2 — review and record

Show the selected Items, quantities and total, with an obvious way back to edit them. Backtracking preserves the selection and applicable form values.

- Present Efectivo and Transferencia as obvious labeled choices, with the selected method unmistakable. The existing Efectivo default may remain; do not silently reuse a previous sale's transfer choice.
- Default the payment amount to the selection total. Keep a clearly labeled partial-payment option without making routine full payment require typing the total.
- Cash-change help is optional and clearly distinguishes the amount being paid from cash handed over. Show the resulting change, invalid amounts or insufficient cash plainly. Cash handed over remains a calculation input, not a stored Payment amount.
- The final action names its effect and amount, for example **Registrar pago de $45.00**. This app records receipt of money; it does not itself execute a bank transfer or charge a card.
- The review step is the routine confirmation. Do not add another generic “¿Estás seguro?” dialog for a normal sale.
- Cliente selection/creation, a note and **Dejar abierta** remain discoverable secondary options. None is mandatory for an ordinary walk-up sale.
- For **Dejar abierta**, make it explicit that no Payment will be recorded and that the Bill remains Open. A Customer is optional.

### 5.3 Preserve the less-common paths

- Adding Items to an existing Open Bill must clearly identify the target Bill. It must not silently create a new unrelated Bill or bypass the existing restrictions on changing its Customer/note.
- A Payment recorded with a selection covers at most that selection's value, not previous debt. If a Customer already has an Open Bill for today, show any remaining Owed accurately; do not claim the entire Bill is Paid merely because the new selection was paid for.
- Payments on Cuenta default to that Bill's outstanding amount; partial payment remains possible.
- **Abonar** on a Customer remains a payment across Open Bills, oldest first, with the existing all-or-nothing behavior and overpayment protection.
- Part cash/part transfer remains two sequential Payments, not a new combined payment operation.

### 5.4 Confirmed result

After authoritative confirmation, show a readable success state with the amount recorded, method when applicable, and any remaining Owed. Keep cash change visible long enough to hand it over; do not erase it automatically.

Provide **Nueva venta** prominently. It starts a fresh selection and resets sale-specific fields. Secondary actions may return to an applicable Open Bill or Customer, subject to permissions. A Worker must not be routed into an inaccessible Paid Bill merely to see confirmation.

For selections left Open or added to an existing Bill, describe that exact result instead of showing a payment-success message.

## 6. Submission, recovery and unfinished work

### 6.1 Required states

| State | User-visible behavior |
| --- | --- |
| Editing/review | Values can be inspected and corrected; no sale has yet been recorded by this step. |
| Recording | Immediate, local pending feedback, such as **Registrando pago…**; retain the submitted context and prevent another submission or a new sale in this workflow. |
| Confirmed | Show the server-confirmed result and the next action; only now present money/Stock changes as recorded. |
| Refused | Explain the specific rule or field problem in Spanish, preserve usable input, and allow correction. |
| Outcome unknown | Explain that recording could not be confirmed. Do not label the sale “failed,” “paid” or “not recorded” without evidence. Keep the submitted context for safe recovery. |

- No automatic timer clears the selection, dismisses a critical result or invents failure/success.
- A lost response is not proof that nothing was written. Retry/reconciliation must reuse the original submission identity **and identical submitted content**, so it cannot create another Bill or Payment.
- Freeze an unresolved submission snapshot; do not allow changes to method, amount, Items or target to masquerade as a retry. Resolve the original outcome before turning it into a different sale.
- If the mutation succeeded but a subsequent read failed, retain the confirmed mutation result and explain that figures need refreshing. Never retry the mutation as a new sale to fix a failed read.
- No payment/Stock optimism. Preserve the existing atomic, revision and idempotency guarantees on the server, including races between different phones.
- Each Notice remains associated with the submitting screen/action; unrelated navigation or another tab must not consume its answer.
- Other forms also need immediate pending feedback, specific errors and confirmation appropriate to their effect.

### 6.2 Leaving and recovery boundaries

- Back from payment to selection preserves the draft.
- In-app navigation that would discard an unfinished sale asks whether to keep working or discard it. Pending or uncertain submissions are not ordinary disposable drafts; warn that leaving does not cancel server processing.
- Request the browser's available unload protection where appropriate, but do not promise that a mobile browser will always show it.
- Mandatory recovery covers the live workflow, including a transport error or failed revalidation: do not replace it with an error screen that silently destroys its submission context.
- Cross-restart draft persistence is not a promised offline feature. If a browser restart or forced close loses local context, reopening must not automatically resubmit or infer failure. Provide a truthful route to checking recorded activity/Bills, with Admin assistance where permissions require it.
- Do not silently introduce long-lived sensitive browser storage or an offline mutation queue to solve navigation loss.

## 7. Full screen coverage

Every row includes readable loading, empty, populated, error and applicable success states. Forms include field labels, helpful validation and pending feedback. Shared styling alone does not satisfy a row: the task hierarchy must be reconsidered.

| Screen / current route module | Required redesigned experience |
| --- | --- |
| Entrar — `sign-in.tsx` | One clearly labeled code field, support paste, simple instructions for obtaining a code from an Admin, readable invalid/expired/rate-limit feedback. Preserve authentication rules. |
| Shell / Más — `shell.tsx`, new navigation surface as needed | Role-specific navigation from §4, identity, sign-out, clear current location and safe unfinished-work handling. |
| Vender — `home.tsx`, `sell-items.tsx` | Two-step flow and complete submission state model from §§5–6, including existing-Bill targeting. |
| Cuentas abiertas — `open-bills.tsx` | Search by Customer; readable Customer/note, Day, Bill state and Owed. Distinguish Open from Partially paid without relying on color. |
| Cuenta — `bill.tsx` | Lead with state and Owed; clearly group Lines and Payments with author/time. Make adding Items and collecting money easy; separate metadata edits and corrections from routine work. Preserve every permitted correction. |
| Clientes — `customers.tsx` | Search and add with existing duplicate-name behavior; keep recognition and selection straightforward. |
| Cliente — `customer.tsx` | Lead with Customer identity and Owed, then Open Bills and Abonar. Preserve grouped payment history and Admin-only past Bills, rename, retire and restore. Retired Customers' existing debts remain collectable. |
| Mi día — `mi-dia.tsx` | Clearly identify these as the signed-in User's figures and records. Lead with Cobrado, split by method, then Vendido; never expose other Users' totals. |
| Día — `dia.tsx` | Default to today with a clear displayed date/range. Lead with Cobrado, Efectivo and Transferencia, then Vendido. Preserve date-range selection, per-User details and Items sold without overwhelming the summary. |
| Cuentas — `cuentas.tsx` | Admin's all-Bills list; preserve date/state/Customer filters and paging, clearly distinguish it from Cuentas abiertas. |
| Por cobrar — `owed.tsx` | Clearly labeled current outstanding debt, Customer totals and oldest Open Day; preserve anonymous Open Bills and older-Day warnings. It is not a historical Day total. |
| Inventario — `inventario.tsx` | Informative, searchable list of stock-tracked Items with Existencias, Minimum and distinct low/negative warnings. Prominent **Registrar entrada** and **Contar existencias** actions; discoverable Merma, Consumo interno and cancellation paths without every form expanded together. |
| Conteo — `conteo.tsx` | Focused quantity entry without expected Stock, then explicit expected/found/difference review and confirmation. Preserve partial-catalog Counts and distinguish untouched fields from an explicit zero. |
| Diferencias — `diferencias.tsx` | Readable Count details with expected/found/difference and **Faltante**, **Sobrante**, or **Sin diferencia**; retain paging and attribution. |
| Historial — `historial.tsx` | Understandable correction/Adjustment descriptions, affected records, author, time and reason. Preserve paging and all existing correction types. |
| Productos — `productos.tsx` | Approachable Item and Category management; preserve creation, Category order, retirement/restoration and their constraints. Clearly separate catalog management from selling. |
| Producto — `producto.tsx` | Legible name/price/Category/stock-tracking/Minimum fields and applicable starting Stock; explain consequential changes without changing their domain semantics. |
| Usuarios — `users.tsx` | Readable User/role/status list, add User, issue/read code, role changes, activate/deactivate and sign out everywhere. Explain consequences and retain last-active-Admin protection. |
| Shared/global surfaces — `root.tsx`, components | Styled, accessible not-found, forbidden, session-expiry and unexpected-error experiences with useful next actions; Customer picker, payment fields, Notices, paging and confirmation patterns match the rest of the app. |

Resource routes such as sign-out, the Customer selector and health checks have no independent visual redesign, but their consumers and security contracts remain covered.

### 7.1 Figures must mean what they say

- **Cobrado** is money received in Payments during the selected Day/range, split into Efectivo and Transferencia. It is not a cash-drawer balance.
- **Vendido** is the value of Lines recorded during that Day/range, regardless of whether they have been paid.
- **Por cobrar** is the current unpaid remainder of Open Bills, not automatically Vendido minus Cobrado for the selected Day.
- Do not merge these into an ambiguous “Total.” Use short explanations where they help recognition.
- Día can link to Por cobrar without adding a misleading date-scoped debt figure. There is no requirement to add charts.

### 7.2 Consequential actions

Ordinary reversible editing should not trigger repetitive confirmation dialogs. Discarding work, voiding a Bill and comparable consequential actions need a clear explanation, affected record and specific final action. Preserve existing reason requirements and Admin gates.

Never offer an “undo” that the domain cannot honor: a Voided Bill cannot be restored. Do not hide original Lines, Payments or correction attribution to make a screen look cleaner.

## 8. Accessibility and responsive requirements

Target **WCAG 2.2 AA across complete flows**, supplemented by the larger controls/readability defaults below. These bullets are practical requirements, not a substitute for reviewing all applicable AA criteria.

- Use roughly 18 CSS px as the default body/form text size and generous line spacing. Secondary text must remain readily readable; do not shrink critical labels or amounts to make a layout fit.
- Use at least 48 × 48 CSS px for standalone interactive targets, including quantity controls and navigation hit areas, with separation to reduce adjacent mis-taps. This is the app's enhanced target, not a claim that WCAG AA requires 48 px.
- Meet text contrast of at least 4.5:1 for ordinary text and 3:1 for qualifying large text; meet applicable 3:1 non-text contrast for controls and states. Errors, warnings and selection must not depend on color alone.
- Text resizing to 200% must not lose content or functionality. Support reflow at 320 CSS px wide, including the equivalent desktop zoom case, without page-level horizontal scrolling. Adapt rows into stacked layouts rather than forcing narrow tables.
- Support portrait/landscape, narrow phones, tablets and laptops. Use actual content fit rather than device-name assumptions.
- Do not disable browser zoom. Test custom text spacing and long Item/Customer/User names; no essential value may be hidden by truncation alone.
- Semantic headings, landmarks, lists, fieldsets and explicit labels. Placeholder text is not a field label.
- Keyboard operability, visible focus and logical focus order throughout. Focus must remain visible above sticky UI; dialogs restore focus and support expected keyboard behavior.
- Changes of step/route must put screen-reader and keyboard Users in a comprehensible location. Announce pending/success/error messages without repeatedly interrupting ordinary typing.
- Associate errors with fields, preserve entered values, and offer a useful error summary when multiple fields fail. Error wording explains the next action rather than showing technical codes.
- No essential hover, swipe, drag, long-press, animation or precision gesture. Respect reduced motion; no automatic disappearing messages containing essential information.
- Use numeric/decimal keyboards where appropriate without restricting paste or assistive input. Keep sign-in code entry accessible and pasteable.

References: [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/), [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

## 9. Responsiveness and implementation boundaries

- A local selection/quantity change must not wait for a request. A submitted action visibly acknowledges the tap by the next painted frame, including under an intentionally delayed response.
- Loading is specific to the task, not just an unexplained global spinner. Do not impose artificial waiting for animations or success screens.
- Avoid blocking fonts, oversized illustrations and decorative dependencies. Reserve asset dimensions to prevent controls shifting under a finger.
- Keep catalog ordering predictable. Do not silently add dynamic favorites or reorder Items based on sales frequency.
- Preserve efficient catalog/shell reuse while keeping Bills, Payments and Stock authoritative and fresh. Do not introduce stale money caching to make the UI seem faster.
- Retain cursor pagination and accessible **Cargar más** on growing lists, including existing scroll restoration and focus behavior. Infinite autoload alone is not an accessible replacement.
- Preserve request budgets and read-only-request guarantees from v1 §10.7. Do not replace paged lists with downloads of all history.
- Use the existing small-component/router architecture. Share design tokens and patterns for controls, forms, headings, Notices, summaries and lists without making every screen a generic card template.
- Exact route decomposition and component boundaries are implementation discretion. Update route/permission tests for any new routes and preserve non-JavaScript behavior where currently supported; do not invent an unsupported no-JavaScript selling guarantee.

## 10. Verification and acceptance

The redesign is implementation-complete only when every screen in §7 is covered and the following evidence is recorded. Visual polish or a passing automated accessibility scan alone is insufficient.

### 10.1 Automated functional and end-to-end coverage

Run `npm run verify` and `npm run test:e2e`. Update assertions that intentionally encode the superseded overlapping-sale UI; do not remove domain/permission coverage to get a passing suite.

Required scenarios:

1. **Roles/navigation:** both roles open Vender; all allowed destinations are reachable through the new navigation, deep links work, and forbidden reads/actions and Worker data visibility remain enforced.
2. **Immediate cash sale:** select multiple Items, edit quantities, advance, go back without loss, enter cash handed over, record once, see correct change/result, then explicitly start a clean new sale.
3. **Transfer sale:** method and final amount are unambiguous; one confirmed Payment and the correct Bill/Stock effects result.
4. **Other selling paths:** anonymous and named Open Bills, partial payment, adding Items to an existing Bill, and paying a new selection when the Customer already owes money retain correct totals and routing.
5. **Pending and uncertainty:** hold a submission; verify immediate pending feedback, retained context, no false success and no next-sale path. Double-tap, refused mutation, request failure before recording, lost response after successful recording, and failed revalidation after success must each have explicit coverage. Retry an unknown outcome without duplicate Lines, Bills, Payments or Stock movements.
6. **Unfinished work:** Back preserves selection; abandoning a draft requires an explicit decision; pending navigation does not claim to cancel the mutation.
7. **Existing debt:** find an Open Bill, take a partial/full Payment, and Abonar across a Customer's Bills oldest first. Verify stale concurrent payments change nothing and explain the conflict.
8. **Figures:** Día, Mi día and Por cobrar show their distinct meanings, correct date scope, attribution and role visibility, including older debt paid today.
9. **Stock:** search Items, inspect low/negative warnings, record Entrada/Merma/Consumo interno, cancel an Adjustment, and complete a Count with hidden expected values during entry and a review before recording. Zero Stock still does not block selling.
10. **Corrections:** permitted Line removal, Admin Payment removal and Bill voiding retain reasons, history and correct figures; forbidden actions remain rejected.
11. **Management and access:** Item/Category create/edit/retire/restore, Customer add/search/manage, User/code/role/status/session management and sign-in failures remain usable and preserve their constraints.
12. **Lists/global states:** load additional pages, return with filters/position intact, and exercise empty, forbidden, not-found and failure states. Every changed screen receives route-level browser coverage; not all need a bespoke full-length scenario.

Reuse the existing Android/iPhone Playwright projects and laptop coverage; extend them for the new flows. Delayed-response tests must exercise real interaction, not merely inspect CSS classes. Use deterministic data and holds/failures rather than live-network timing thresholds.

### 10.2 Accessibility and layout evidence

- Automated accessibility checks on every redesigned route's principal state and shared interactive states; resolve violations and review what automation cannot judge.
- Explicit layout checks at 320 CSS px, representative Android/iPhone sizes and laptop width; inspect long text, large amounts, populated lists, errors and empty states.
- Manual keyboard-only and screen-reader passes through selling, payment, navigation, a report, an inventory task and sign-in; inspect focus, names and announcements.
- Manual text-resize/reflow, reduced-motion, contrast and mobile-keyboard/safe-area checks. Verify no bottom bar covers focused fields or final actions.
- Observe performance on an available lower-powered/older phone or a documented throttled fallback. Record the tested environment; emulation alone must not be described as real-device proof.

### 10.3 Full-app pilot

Pilot Users are available. Finish the full redesign and technical verification **before** inviting them to test; do not pilot a polished selling screen surrounded by old screens. Internal implementation sequencing is permitted, but it is not a partial release or a substitute for whole-app coverage.

Include the older Admin and a low-digital-confidence Worker, or comparable representatives. Use a local/test environment with realistic Spanish names, prices, Bills and Stock rather than recording test Payments into live operations.

Ask Users, without coaching, to:

- Record a cash sale and give change, then record a transfer sale.
- Correct a selection before payment and recover from a staged mistake or failed request.
- Leave a Bill Open, find it again and record a Payment within their permissions.
- Find their own Day's activity.
- As Admin, explain today's Cobrado versus Vendido, inspect low Stock, record an Entrada and complete a small Count.
- Find a less-frequent tool through Más and return to selling.

Record completion, assistance required, hesitation, navigation mistakes, amount/method mistakes and interpretation of pending/success states. Ask what Users think was recorded, not only whether the app looks attractive.

Pilot acceptance: each representative completes their role's core tasks independently; no duplicate-payment behavior or unresolved misunderstanding of recorded/pending outcomes is acceptable. Fix and retest observed blockers before calling the redesign validated. Do not invent a speed target before observing realistic tasks; gather task times as a baseline alongside accuracy and confidence.

## 11. Delivery and remaining discretion

Agreed delivery is **full redesign → technical end-to-end verification → full-app pilot → refinement**. The earlier proposal to pilot only Vender, Día and Inventario first was explicitly rejected in favor of complete end-to-end testing.

Implementation can proceed in sensible internal slices (shared system/navigation, selling and recovery, reports/Stock, remaining screens, cross-app verification), but no screen is exempt from the common standard. Update implementation documentation alongside changed behavior. Create separate implementation issues later if requested, following the local issue-tracker convention.

No blocking product questions remain for this spec. The following are implementation discretion or validation inputs, not additional promises:

- Exact palette/font/assets, layout breakpoints and component/route decomposition.
- Concrete safe-retry wiring within the existing submission contract; the required outcomes in §6 are not optional.
- Available pilot phones/browsers and real catalog content. Synthetic data is suitable for building; actual content and devices inform validation.
- Whether category illustrations improve recognition and whether immediate payment is truly the dominant workflow, to be assessed during the pilot.

This document defines intended behavior and required evidence. It does not claim that implementation, accessibility conformance, performance testing or pilot validation has already happened.
