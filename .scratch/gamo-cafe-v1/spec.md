# Gamo Cafe v1 buildable specification

Status: buildable. No section waits on an open decision; §11 lists the assumptions that were never confirmed out loud.

This specification assembles every decision from the design session of 2026-10-05. Normative terms such as **Bill**, **Line**, **Payment**, **Stock** and **Count** are defined in [`CONTEXT.md`](../../CONTEXT.md), and the reasoning behind the less obvious choices is in [`docs/adr/`](../../docs/adr/). Where this document leaves a choice open, such as file layout, exact URLs or visual design, that choice is implementation discretion and must still satisfy every rule here.

## 1. Product and v1 boundary

Gamo Cafe is a Spanish-language web app, used on phones, for the staff of one cafeteria. Staff record every sale as it happens. The app then answers four questions: what was sold, who recorded it, what is still owed, and whether the shelf matches the records.

v1 must provide:

1. Sign-in for four members of staff on their own phones, with no passwords.
2. Items in Categories, each with one price.
3. Recording a sale in a few taps, with the total and the change worked out by the app.
4. Bills that are paid on the spot, left Open for a Customer, or left Open with no Customer.
5. Payments in cash or by transfer, in full or in part, for one Bill or across all of a Customer's Open Bills.
6. Corrections that never erase anything: removing Lines and Payments, and voiding Bills.
7. Stock for stock-tracked Items, with Adjustments, Counts, Discrepancies and a Minimum per Item.
8. Six lists for Admins: Day, Bills, Owed, Stock, Discrepancies and History.
9. Operation on Cloudflare Workers and D1, with every request bounded whatever the history holds.

Everything ships in one release.

### 1.1 Explicitly outside v1

- Card payments, printed or emailed receipts, taxes and facturas.
- Discounts, special prices and tips.
- Cost prices, margins, suppliers and purchase orders.
- Recipes and ingredient-level stock.
- Offline use, push notifications and reminders.
- Credit limits, and merging duplicate Customers.
- Cash-drawer counts and end-of-day closing.
- Charts and exports.
- More than one cafeteria, Stock location, language or currency.
- Anything a Customer would use.
- A History of changes to Items, Categories, Customers and Users.

### 1.2 Setting

- Users: two Admins and two Workers, each on their own phone.
- Language: Spanish (Mexico). Currency: Mexican pesos.
- A Day is the calendar day in `America/Mexico_City` (assumed; see §11).
- The cafeteria has Wi-Fi, and the app requires a connection.
- At launch every Item is a drink or a snack and is stock-tracked. Prepared Items (café, sandwiches, summer-camp food) come later and are the reason the stock-tracked flag exists.

## 2. Non-negotiable invariants

### 2.1 Attribution and history

See ADR 0002.

- Every Line, Payment, Adjustment, Count and correction records the User who did it and when. None of them can be created without a signed-in User.
- A Bill has no owner and no "assigned to".
- Nothing is edited in place or deleted. Removing a Line or a Payment, voiding a Bill, cancelling an Adjustment, and changing a Bill's Customer or note are each a new record with its author, its time and, where required, its reason.
- Items, Categories, Customers and Users are retired or deactivated, never deleted.
- A Line keeps the price its Item had when the Line was added.

### 2.2 Selling is never blocked

See ADR 0003.

- No Stock level prevents a sale. Stock may go below zero.
- No missing Customer prevents leaving a Bill Open.

### 2.3 Money

- Amounts are whole centavos. There is no floating-point arithmetic on money.
- A Payment is greater than zero and never more than its Bill still owes, including when two phones submit at the same moment.
- A Bill's total is the sum of its Lines that have not been removed.
- No Customer ever has credit in their favor.

### 2.4 Capacity

See ADR 0007. The app runs on Cloudflare Workers Paid and D1, in an account it shares with the developer's other projects. The plan's limits are far above the cafeteria's volume, as documented by Cloudflare on 2026-10-06:

| Limit | Value |
| --- | --- |
| Worker CPU time per request | 30 seconds by default |
| Worker requests | 10 million a month included |
| Worker CPU time | 30 million CPU-ms a month included |
| D1 queries per Worker request | 1,000 |
| D1 bound parameters per query | 100 |
| D1 rows read | 25 billion a month included, counted as rows scanned |
| D1 rows written | 50 million a month included, counting index rows |
| D1 database size | 10 GB |
| D1 Time Travel | 30 days |

The rules below are the app's own. They keep every request fast on a phone and the bill at the plan's minimum:

- No request issues more than 50 statements. Bulk writes, such as a Count of every Item or a Payment spread over many Bills, use multi-row statements.
- No request reads rows in proportion to the total number of Bills, Lines or Payments ever recorded. Lists are driven by indexes and bounded by Day, by state or by page.
- Every list that grows with time is paged. A list bounded by the catalog, such as the Items on Vender, is not.
- A request that only reads writes nothing.
- The Worker sets a CPU ceiling per request, and the account has a budget alert: the plan has no spending cap.

## 3. Technical architecture

### 3.1 Runtime and application framework

See ADR 0005.

- TypeScript.
- React Router v8 Framework Mode, with `@react-router/cloudflare` and `@cloudflare/vite-plugin`.
- Cloudflare Workers runtime, as a single Worker.
- React Router loaders and actions for every server interaction. There is no separate HTTP API.
- npm. Vitest with the Cloudflare Workers pool, and Playwright.
- The developer's `mdwn` project is the reference for layout, scripts and configuration.

### 3.2 Backend shape with Effect

See ADR 0006.

- Effect 4.0.x. It is chosen for the guarantees below, not for speed: it adds a small CPU cost to every request.
- Only modules and exports that are not tagged `@stability unstable` or experimental. In 4.0.1 that excludes all of `effect/sql`, `effect/http` and `effect/http-api`, and therefore `@effect/sql-d1`, along with some newer exports of `Schema`.
- Every operation in §7.3 is an Effect program. Its dependencies are services:
  - `Db`: the D1 binding behind a small interface (first row, all rows, run, batch) that returns Effects and fails with a typed error.
  - `CurrentUser`: the signed-in User. An operation that records something requires it, so it cannot run without an author.
  - Effect's `Clock`: the only source of "now", so Day rules are tested with a test clock.
- Rule violations are typed errors, for example: Bill is Voided, Payment exceeds what is owed, Admin only, stale submission. Each action maps every error it can receive to a Spanish message or a redirect.
- Effect `Schema` validates form input and decodes every row read from D1.
- One runtime is built per isolate from the D1 binding. Loaders and actions stay thin: read the session, parse input, run one program, turn the result into a response.
- Effect is not used in browser code.

### 3.3 Persistence and migrations

- Cloudflare D1 is the only store.
- SQL is written by hand against the D1 binding. There is no ORM and no query builder.
- Migrations are numbered `.sql` files, created and applied with Wrangler (`wrangler d1 migrations create` and `apply`) and written by hand. Wrangler creates the empty file and tracks what has run; it does not generate the SQL.
- Local and production use separate databases.
- D1 batches provide atomicity. D1 has no interactive transactions, so every operation in §7.3 must be expressible as one batch.
- Recovery posture: D1 Time Travel (30 days), plus a database export taken before every production migration and kept outside Cloudflare.

### 3.4 Browser UI

- Tailwind CSS with small local components.
- Designed for a phone held in one hand: large tap targets, nothing that depends on hover, no horizontal scrolling. It must also be usable on a laptop.
- All visible text is Spanish. Money and dates use the `es-MX` formats.
- React Router's client-side navigation everywhere, with pending and optimistic UI so that every tap is acknowledged at once.
- The selection on the Sell screen (§6.1) lives in the browser until it is recorded.
- A web app manifest and icons let Users add the app to their home screen. There is no service worker.
- A form that records something answers success with a redirect, so reloading or going back never records it twice. What the screen says afterwards travels with the redirect.
- A form that creates a Bill, a Payment, an Adjustment or a Count carries a key made when the form was rendered. The server records one submission per key, so a double tap or a retry on a bad connection creates nothing twice.
- A paged list shows its first page and a **Cargar más** control that appends the next one, and loads it by itself when it scrolls into view. Paging is by cursor, not by offset, wherever the order allows it.
- Optimistic UI is for what is harmless to take back: the selection empties the moment it is submitted and comes back if the server refuses it. Money is never shown as recorded before the server confirms it; until then the screen says it is being recorded.
  - *Superseded for Vender by the [UI redesign](../ui-redesign/spec.md) §2.2, §5 and §6:* the selection no longer empties at the tap. A sale stays on screen, frozen, until the server's own answer; the next one starts only from **Nueva venta**; and a sale is answered by its own route in JSON, not with a redirect. The key is made at the tap. Everything else in this section stands.
- What is not about money may be reused in the browser: the Items on Vender and the shell's navigation are not fetched again after every sale or navigation. Bills, Payments and Stock are always fetched fresh, and no response about them may be stored by a cache.

### 3.5 Sign-in and sessions

See ADR 0004.

- An Admin adds a User with a name and a role, and the app shows a one-time code.
- A code has 8 characters from an alphabet without look-alikes and is shown as two groups of four. It works once, expires 10 minutes after it is issued, and is stored only as a hash.
- Entering a valid code creates a session for that User on that phone: an opaque token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, stored on the server only as a hash.
- A session ends after 60 days without use. Each use extends it.
- An Admin can issue a new code for an existing User (a new phone), sign a User out of every phone, and deactivate or reactivate a User. Deactivating signs the User out everywhere.
- The last active Admin cannot be deactivated or made a Worker.
- Failed code entries are limited to 10 per 10 minutes across the whole app. Beyond that, sign-in is refused until the window passes.
- The first Admin's code, and a code when every Admin is signed out, are issued by the developer from the command line. The developer can also add a Worker there, under the same rules as Usuarios.
- The server rejects any non-GET request whose `Origin` is not the app's own.

### 3.6 Deployment

- The developer's own Cloudflare account, on Workers Paid, which also holds the developer's other projects (ADR 0007). The owner reimburses the plan's monthly charge.
- Two environments: local and production.
- The address is `workers.dev` until Gamo has a domain.
- The developer deploys from a laptop with Wrangler. There is no CI.
- Secrets live in Wrangler secrets, never in the repository.

## 4. Roles and permissions

### 4.1 Permissions matrix

| Capability | Worker | Admin |
| --- | --- | --- |
| Record a sale, and add Lines to any Open Bill | Yes | Yes |
| Take a Payment on any Open Bill, or for any Customer | Yes | Yes |
| Add a Customer | Yes | Yes |
| See every Open Bill, and what one Customer owes | Yes | Yes |
| See own activity for today | Yes | Yes |
| Set or change a Bill's Customer or note, before any Payment | Yes | Yes |
| Set or change a Bill's Customer or note, after a Payment | No | Yes |
| Remove a Line from a Bill with no Payment | Yes | Yes |
| Remove a Line from a Bill that has a Payment | No | Yes, with a reason |
| Remove a Payment | No | Yes, with a reason |
| Void a Bill | No | Yes, with a reason |
| See Paid and Voided Bills | No | Yes |
| See the Day, Bills, Owed, Discrepancies and History lists | No | Yes |
| See Stock, Minimums, Adjustments and Counts | No | Yes |
| Record an Internal use | Yes | Yes |
| Record a Restock or Waste, cancel an Adjustment, and record a Count | No | Yes |
| Manage Items and Categories | No | Yes |
| Rename, retire or restore a Customer | No | Yes |
| Manage Users and issue sign-in codes | No | Yes |

The server enforces this matrix in every loader and action. Hiding a control is not enforcement.

### 4.2 What a Worker never sees

Stock numbers, another User's totals, Paid or Voided Bills outside their own activity for today, and History. Recording an Internal use shows them none of these: not the Stock it changes, and not the Adjustments others recorded.

## 5. Domain rules

### 5.1 Items and Categories

- An Item has a name, a price greater than zero, exactly one Category, a stock-tracked flag that defaults to on, and an optional Minimum.
- Active Item names are unique, ignoring case and accents.
- Changing a price affects only Lines added afterwards.
- Retiring an Item hides it from the Sell screen. It can be restored, which is how seasonal Items come and go. Its Lines and Stock records stay.
- A Category has a name and a position. Categories appear on the Sell screen in position order, and Items within a Category in name order.
- A Category with active Items cannot be retired.
- Switching stock tracking on or off changes no existing record. While it is off, Lines for that Item do not move Stock.

### 5.2 Customers

- A Customer has a name and an optional note. A Customer is whoever settles the Bills, a person or a family; who physically took the Item can go in the Bill's note.
- Any User can add a Customer. As a name is typed, matching Customers are shown first. A name equal to an active Customer's name, ignoring case and accents, is refused.
- Admins rename, retire and restore Customers. A retired Customer cannot be chosen for new Bills, and their Open Bills stay collectable.
- What a Customer owes is the sum still owed on their Open Bills.

### 5.3 Bills

- A Bill comes into existence with its first Line. There are no empty Bills.
- A Bill has at most one Customer and an optional note of up to 80 characters.
- Recording Lines for a Customer adds them to that Customer's most recently opened Open Bill of the current Day, or starts a new Bill if there is none. This is how "one Bill per Customer per day" is achieved. It is a routing rule, not a uniqueness constraint: linking a Bill to a Customer later can leave two Open Bills on one Day, which is harmless.
- Recording Lines with no Customer starts a new Bill, unless the User opened an existing Open Bill and is adding to it.
- More Lines can be added to any Open Bill by any User.
- A Bill with no Customer that is still Open on a later Day is flagged for Admins on the Owed list.
- A Bill's Customer and note can be set or changed by any User while the Bill has no Payment, and by Admins afterwards. Each change is a History entry.

### 5.4 Lines

- A Line is one Item, a whole quantity of at least 1, and the Item's price at that moment.
- Recording a selection creates one Line per distinct Item in it.
- A retired Item cannot be added.
- A Line belongs to the Day on which it was added, whatever the Day of its Bill.

### 5.5 Payments

- A Payment has an amount, a method (cash or transfer), the User who received it and the moment. It belongs to one Bill and to the Day on which it was received.
- Paying from a Bill: the amount defaults to what the Bill still owes and may be less.
- For cash, the User may enter the amount handed over and the app shows the change. The amount handed over is not stored.
- Paying for a Customer: the User enters one amount, which defaults to everything the Customer owes and may not exceed it. It is applied to the Customer's Open Bills oldest first, as one Payment per Bill with the same method, User and moment, and a shared handover reference so lists can show it as one event. Either all of it is recorded or none of it.
- Part cash and part transfer is two handovers, one after the other.
- A submission that would overpay because another phone paid first changes nothing and tells the User that the Bill has changed.

### 5.6 Bill states

A Bill's state is derived from its records and is never set by hand.

| Shown as | Term | Condition |
| --- | --- | --- |
| Abierta | Open | Not Voided, nothing paid, something owed |
| Pago parcial | Partially paid | Not Voided, something paid, something still owed |
| Pagada | Paid | Not Voided, nothing still owed |
| Cancelada | Voided | An Admin voided it |

- "Open Bill" in these rules means Abierta or Pago parcial.
- A Bill left with no Lines owes nothing, so it counts as Paid with a zero total.

### 5.7 Corrections

- Removing a Line: any User when the Bill has no Payment, an Admin with a reason otherwise. Payments that were removed do not count as Payments here.
- A Line is removed whole. To lower a quantity, remove the Line and add the right one.
- Removing a Line is refused if it would leave the Bill's total below its Payments. The Admin removes a Payment first.
- Removing a Payment: an Admin, with a reason.
- Voiding a Bill: an Admin, with a reason. A Voided Bill counts toward nothing: its Lines leave Sold and their units return to Stock, its Payments leave Collected, and it leaves Owed. Voiding cannot be undone.
- A removed Line returns its units to Stock.
- A correction changes the figures of the Day on which the original Line or Payment was recorded. History shows who changed what, when and why.
- History lists removed Lines, removed Payments, Voided Bills, changes to a Bill's Customer or note, Adjustments and cancelled Adjustments.

### 5.8 Stock

- Only stock-tracked Items have Stock.
- Stock changes when a Line is added (down by its quantity), when a Line is removed or its Bill is Voided (back up), when an Adjustment is recorded or cancelled, and when a Count is recorded (set to the units found).
- Stock is maintained only by those operations. No screen edits the number directly, and it can be rebuilt from the records at any time.
- An Adjustment is one Item, a whole number of units of at least 1, a reason and an optional note. Restock adds; Waste and Internal use subtract.
- Any User can record an Internal use; only an Admin records a Restock or Waste.
- An Admin can cancel an Adjustment, with a reason, which reverses its effect. A Worker cannot, not even an Internal use of their own.
- The starting Stock entered when an Item is created is recorded as a Restock.
- A Count covers any subset of Items. The entry step shows Item names and no expected numbers. A review step then shows expected, found and difference before the Admin confirms.
- Confirming a Count records, per Item, the Stock expected at that moment, the units found and the Discrepancy (found minus expected), and then sets Stock to the units found. A Discrepancy of zero is recorded too.
- A Discrepancy below zero is shown as Faltante and above zero as Sobrante.
- A Minimum is an optional whole number per Item. An Item is flagged for restocking when its Stock is at or below its Minimum, and flagged separately when its Stock is below zero.

### 5.9 Days and figures

- A Day is the local calendar day at the moment a record is made.
- **Sold** for a Day is the sum of quantity times price over that Day's Lines that have not been removed and whose Bill is not Voided.
- **Collected** for a Day is the sum of that Day's Payments that have not been removed and whose Bill is not Voided, split into cash and transfer.
- **Owed** is the sum still owed on Open Bills at this moment, for one Customer or overall.
- Per User, Sold is attributed to the author of each Line and Collected to the receiver of each Payment.

## 6. Screens

Titles are the Spanish shown on screen. Navigation and URLs are implementation discretion.

### 6.1 For every User

- **Entrar.** One field for the sign-in code.
- **Vender.** The home screen. Items are large buttons grouped by Category. Tapping an Item adds one unit to the selection, which shows quantities, the running total, and controls to add, subtract and clear. The User may choose a Customer, with search as they type and "add new", or type a note. There are two ways to finish: *Its two steps, its Payment entry and its result are now the [UI redesign](../ui-redesign/spec.md) §5; the rules of what is recorded are unchanged.*
  - **Cobrar** records the selection and a Payment together: method, optional amount handed over with the change shown, and optionally an amount lower than the total.
  - **Dejar abierta** records the selection and leaves the Bill Open.
- **Cuentas abiertas.** Every Open Bill, newest first, with its Customer or note, Day, total, paid and owed. Searchable by Customer.
- **Cuenta.** One Bill: its Lines with who and when, its Payments with who, when and method, its state and what it owes. Actions as permitted: add Items, take a Payment, set the Customer or note, remove a Line and, for Admins, remove a Payment or void.
- **Clientes.** Search and add. A Customer's page shows their Open Bills and what they owe, with **Abonar** to pay across Bills. Admins can also rename, retire and see past Bills.
- **Mi día.** What this User sold and collected today, in cash and by transfer, with their Lines and Payments.
- **Consumo interno.** Records an Internal use: an active stock-tracked Item, its units and an optional note. It shows no Stock; cancelling one is an Admin's, on Inventario.

### 6.2 For Admins

- **Día.** For a date or a from–to range: Sold, Collected in cash and by transfer, the same per User, and Items sold with quantities and value.
- **Cuentas.** Every Bill with its state, filtered by date, state or Customer, 50 per page.
- **Por cobrar.** Each Customer with what they owe and the Day of their oldest Open Bill, then Open Bills with no Customer, flagged when from an earlier Day.
- **Inventario.** Each stock-tracked Item's Stock and Minimum, with flags for restocking and for negative Stock. From here: record an Adjustment (**Ajuste**) and start a Count (**Conteo**).
- **Diferencias.** Per Count: Item, expected, found, difference.
- **Historial.** Corrections and Adjustments, newest first, with who, when and why, 50 per page.
- **Productos.** Items and Categories.
- **Usuarios.** Users, roles, sign-in codes, sign out everywhere, deactivate.

## 7. Persistence contract

### 7.1 Conventions

- Identifiers are opaque strings generated by the app.
- Money is an integer number of centavos. Quantities and units are integers.
- Instants are integer milliseconds since the Unix epoch. Days are text in `YYYY-MM-DD` form, computed when the record is written.
- **Facts** are inserted once and never updated or deleted.
- **Projections** are values derived from facts so that reads stay cheap (§2.4). They are written only in the same batch as the fact that changes them, and a maintenance command can rebuild and verify all of them from the facts.
- Foreign keys are enforced.

### 7.2 Required records

Names are illustrative. What each record holds is normative.

| Record | Kind | Holds |
| --- | --- | --- |
| `users` | Entity | Name, role, active |
| `sign_in_codes` | Operational | User, code hash, issued by, issued at, expires at, used at |
| `sessions` | Operational | Token hash, User, created at, last used at, revoked at |
| `sign_in_failures` | Operational | The counter behind the sign-in limit |
| `categories` | Entity | Name, position, retired at |
| `items` | Entity | Name, price, Category, stock-tracked, Minimum, retired at |
| `customers` | Entity | Name, normalized name, note, retired at, added by, added at |
| `bills` | Fact with projections | Day, opened by, opened at. Projections: current Customer, current note, total, paid, state, revision |
| `bill_edits` | Fact | Bill, field (Customer or note), previous value, new value, by, at |
| `lines` | Fact | Bill, Item, quantity, unit price, added by, added at, Day |
| `line_removals` | Fact | Line, removed by, at, reason |
| `payments` | Fact | Bill, amount, method, handover reference, received by, at, Day |
| `payment_removals` | Fact | Payment, removed by, at, reason |
| `bill_voids` | Fact | Bill, voided by, at, reason |
| `adjustments` | Fact | Item, reason, units, note, by, at, Day |
| `adjustment_cancellations` | Fact | Adjustment, cancelled by, at, reason |
| `counts` | Fact | By, at, Day, note |
| `count_lines` | Fact | Count, Item, units expected, units found |
| `stock_levels` | Projection | Item, units, last counted at |

### 7.3 Atomic operations

Each of these is one D1 batch: all of it is stored or none of it.

1. **Record a selection**: the new Bill if one is needed, its Lines, the Bill's projections, Stock, and the Payment when it is paid on the spot.
2. **Take a Payment** on one Bill, or across a Customer's Open Bills.
3. **Remove a Line**, **remove a Payment**, **void a Bill**, each with its effect on the Bill's projections and on Stock.
4. **Set a Bill's Customer or note**.
5. **Record an Adjustment**, or **cancel** one.
6. **Record a Count**.
7. **Use a sign-in code**: mark it used and create the session.

Concurrency:

- Operations 2, 3 and 4 check the Bill's revision, or use an equivalent conditional write, so that a stale submission changes nothing. A D1 batch cannot branch, so the condition has to be expressed in SQL.
- Adding Lines never conflicts: totals and Stock change by relative amounts.

### 7.4 Query and index requirements

- Open Bills by state, and by Customer.
- Lines and Payments by Day, by Bill, and by author and Day.
- Bills by Day and state, paged.
- Customers by normalized name prefix.
- History by time, paged.

## 8. Core flows

### 8.1 Walk-up sale

1. On Vender, the User taps the Items. The selection and total update at once.
2. The User taps Cobrar, picks cash or transfer, and for cash may type the amount handed over to see the change.
3. One operation records the Bill, its Lines and a Payment for the full total, and lowers Stock. The Bill is Paid.

### 8.2 Sale left Open for a Customer

1. On Vender, the User builds the selection and chooses the Customer, adding them if they are new.
2. The User taps Dejar abierta.
3. The Lines go onto the Customer's Open Bill for today, or onto a new one. Stock is lowered and the Bill stays Open.

### 8.3 A Customer pays part of what they owe

1. On the Customer's page, the User taps Abonar. The amount is pre-filled with everything owed.
2. The User lowers the amount, picks the method and confirms.
3. One operation records a Payment per Bill, oldest first, until the amount is used up. Bills that are covered become Paid; the last one touched may be Partially paid.

### 8.4 A mistake on an unpaid Bill

1. On Cuenta, any User removes the wrong Line.
2. The removal is recorded with their name, the total drops, the units return to Stock, and History shows it.

### 8.5 A mistake found after payment

1. An Admin opens the Bill from Cuentas.
2. The Admin removes the Payment, or voids the Bill, giving a reason.
3. The figures of the Days involved change, and History shows who did it and why.

### 8.6 Restock

1. On Inventario, an Admin picks an Item, chooses Entrada and enters the units.
2. Stock rises, and the Adjustment appears in History.

### 8.7 Count

1. On Inventario, an Admin starts a Conteo and enters the units found for the Items counted, without seeing expected numbers.
2. The review step shows expected, found and difference for each.
3. On confirming, each Discrepancy is recorded and Stock takes the units found.

### 8.8 A new User signs in

1. On Usuarios, an Admin adds the User and reads out the code.
2. The User opens the app on their phone, enters the code and is signed in.
3. The User adds the app to their home screen.

## 9. Rollout

1. The developer moves their Cloudflare account to Workers Paid, sets a budget alert on it, and creates the production database there.
2. The developer deploys and issues the first Admin's code from the command line.
3. An Admin enters the Categories, the Items with their prices and starting Stock, and the other Users.
4. All four Users sign in on their own phones and record a few practice sales, which an Admin then voids.
5. Debts from before the app stay on paper until they are collected.

## 10. Acceptance criteria

v1 is conformant only when automated tests demonstrate all of the following.

### 10.1 Sign-in

- A code signs in exactly one phone, once, and only within 10 minutes of being issued.
- A deactivated User, and a User signed out everywhere, lose access on their next request.
- The eleventh failed code entry within 10 minutes is refused even when the code is valid.
- The last active Admin cannot be deactivated or made a Worker.
- No loader or action other than sign-in responds without a valid session.

### 10.2 Selling and Bills

- A walk-up sale produces one Paid Bill whose Lines and Payment carry the signed-in User.
- Two selections recorded for the same Customer on the same Day land on one Bill while it is Open, and on a new Bill once it is Paid or on a later Day.
- A Line keeps its price after the Item's price changes.
- A retired Item cannot be added, and a retired Customer cannot be chosen.
- A Bill with no Customer can be left Open, and is flagged on the Owed list the next Day.
- Two phones adding Lines to the same Bill at the same moment both succeed, and the total reflects both.

### 10.3 Payments

- A Payment larger than what the Bill owes is refused.
- Two phones paying the same Bill in full at the same moment produce exactly one Payment, and the other User is told that the Bill has changed.
- An amount paid for a Customer is applied oldest Bill first, never exceeds what the Customer owes, and is recorded in full or not at all.
- The change shown for cash equals the amount handed over minus the amount paid.

### 10.4 Corrections

- A Worker can remove a Line only from a Bill with no Payment. An Admin can remove it from any Bill, with a reason, unless that would leave the total below the Payments.
- Removing a Payment and voiding a Bill require an Admin and a reason.
- After any correction the original record still exists, and History shows the correction with its author, time and reason.
- A Voided Bill counts in none of Sold, Collected, Owed or Stock.

### 10.5 Stock

- Selling an Item whose Stock is zero succeeds and leaves its Stock at minus one, flagged.
- Each of these moves Stock by exactly the expected amount: adding a Line, removing a Line, voiding a Bill, each kind of Adjustment, cancelling an Adjustment.
- A Count sets Stock to the units found and records the Discrepancy against the Stock expected at that moment.
- Rebuilding the projections from the facts yields the same Stock and the same Bill totals as the live values, after any sequence of operations.
- An Item at or below its Minimum is flagged.
- Lines for an Item that is not stock-tracked do not move Stock.

### 10.6 Lists and permissions

- Every cell of the permissions matrix in §4.1 is enforced on the server.
- Sold and Collected for a Day match §5.9 exactly, including across midnight in the cafeteria's time zone, tested with a test clock.
- Per-User figures attribute Sold to Line authors and Collected to Payment receivers.
- A Worker's Mi día shows only that Worker's records.

### 10.7 Request budgets

Against a local database loaded with a year of synthetic records, for the Sell screen, recording a ten-Item selection with Payment, Cuentas abiertas with 200 Open Bills, paying a Customer with 30 Open Bills, Día for the busiest Day, a page of Cuentas, Inventario, a Count of every Item, and a page of Historial:

- no request issues more than 50 D1 statements;
- no request reads rows in proportion to the total history, shown by measuring at two history sizes;
- no request that only reads writes a row.

There is no proof against a deployment (ADR 0007).

## 11. Assumptions awaiting confirmation

1. The cafeteria's Days are counted in `America/Mexico_City`.
2. There are fewer than about 60 active Items, so Vender is a grid without search. With more, Vender gains a search field.
3. The owner accepts that the cafeteria's records live in the developer's Cloudflare account, and reimburses its monthly charge.
4. The real menu with prices is needed for day one, not for building.
