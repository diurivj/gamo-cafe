# Gamo Cafe

Sales and stock tracking for one cafeteria, in Spanish, on phones. The domain language is in [`CONTEXT.md`](CONTEXT.md), the decisions in [`docs/adr/`](docs/adr/).

React Router 8 (framework mode) on Cloudflare Workers, D1 with hand-written SQL, Effect 4 on the backend, Tailwind 4. Two environments: local and production.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server in workerd with the local D1. Run `npm run db:migrate` first. |
| `npm run build` | Builds the Worker and the client into `build/` for the local environment. |
| `npm run typecheck` | `wrangler types`, `react-router typegen`, then `tsc -b`. |
| `npm test` | Vitest in the Workers pool, against a real local D1 with migrations applied. |
| `npm run test:e2e` | Builds, then runs Playwright against the built Worker (Android and iPhone shapes). |
| `npm run verify` | `typecheck` and `test`. Run before every commit. |
| `npm run db:migrate` | Applies `migrations/` to the local D1. |
| `npm run db:migrate:production` | Applies `migrations/` to the production D1. |
| `npm run deploy:production` | Builds for production and deploys with Wrangler. |
| `npm run sign-in-code -- --new-admin "Nombre"` | Creates an Admin in the local D1 and prints a one-time sign-in code. `--user "Nombre"` issues a code for an existing User; `--production` acts on the production D1. |

Production needs the real D1 id in `wrangler.jsonc` (`env.production`), which holds a placeholder. Take a database export before every production migration (spec §3.3).

## Layout

```
app/
  backend/     Effect code. Server only.
    db.ts          Db service over the D1 binding, DbError, statement()
    current-user.ts  CurrentUser service, requireAdmin and the AdminOnly error
    sign-in.ts     codes and sessions: addUser, issueSignInCode, useSignInCode, authenticate, signOut
    users.ts       what an Admin does on Usuarios: add, new code, sign out everywhere, deactivate, role
    catalog.ts     Items and Categories; activeItemsByCategory is the read for the Sell screen
    stock.ts       the statements that move Stock (changeStock, adjustmentStatements, countStatements), stockOf, lastCountedAt
    inventory.ts   Inventario: Stock and Minimums, recording and cancelling Adjustments
    counts.ts      Conteo: what the entry and review steps show, recording a Count, and the Diferencias read
    command-line.ts  the SQL that scripts/sign-in-code.ts sends to D1
    time.ts        now, today (the only source of "now")
    run.server.ts  run(): the one way a loader or action runs a program
    health.ts      the reference operation
    customers.ts   Customers: addCustomer, searchCustomers, getCustomer, editCustomer, retireCustomer, restoreCustomer
    bills.ts       Bills, Lines and Payments: recordSelection and takePayment (one batch each), getBill (the §4.1 gate), listOpenBills
    payments.ts    the two statements a Payment writes (paymentStatements) and its errors
  shared/      Plain functions, no Effect. Safe in the browser.
    money.ts       centavos, formatMoney, parsePesos, changeFor
    bill-state.ts  a Bill's states, their Spanish words, isOpenBill
    payment.ts     cash or transfer, and their Spanish words
    payment-messages.ts  what a Payment's rule violations say on screen
    day.ts         Instant, Day, dayOf, formatDay, formatTime
    id.ts          newId
    secret.ts      sign-in codes, session tokens, their hash, the cookie name
    normalize-name.ts  normalizeName: a name with case and accents ignored
    units.ts       parseUnits (a typed whole number of units)
    discrepancy.ts discrepancyText: Faltante, Sobrante, or Sin diferencia
  components/  React components used by more than one screen
    customer-picker.tsx  CustomerPicker, the form field that chooses a Customer
    payment-fields.tsx  PaymentFields, a Payment's method, amount and cash change
    item-fields.tsx  ItemFields, the fields of an Item's form, new or existing
    count-line.tsx  CountLineItem, one line of a Count as Conteo and Diferencias show it
  session.server.ts  the session middleware, requireUser, the cookie
  catalog-forms.server.ts  what the Productos routes share: the Admin gate, form parsing, error messages
  routes/      Route modules; resources/ holds routes without UI
    shell.tsx      the signed-in layout and its navigation; screens go inside it
  routes.ts    Route table
workers/app.ts   Worker entry; rejects non-GET requests from another origin
scripts/         Command-line scripts, run by Node as TypeScript
migrations/      Hand-written .sql, applied by Wrangler
tests/           Vitest, Workers pool
e2e/             Playwright
```

## Conventions

- **Money** is integer centavos. Add and subtract with integer `+` and `-`; turn it into text with `formatMoney` and read typed text with `parsePesos`. Never divide or multiply an amount by 100.
- **Time**: an instant is epoch milliseconds; a Day is `YYYY-MM-DD` in `America/Mexico_City`, computed when a record is written and stored with it. Backend code gets them only from `now` and `today` in `~/backend/time`, never from `Date`.
- **Ids** are opaque strings from `newId()`.
- **Facts** are inserted once and never updated or deleted. **Projections** are written only in the same `db.batch` as the fact that changes them (spec §7.1).
- **Stock** is the projection `stock_levels`, and only `~/backend/stock` writes it. An operation that moves Stock puts `changeStock(itemId, units)` (relative, negative to lower) in the same batch as its fact; an Adjustment is `adjustmentStatements({...})`. Both do nothing to an Item that is not stock-tracked. An Item with no row has a Stock of zero.
- **Names** of Items are stored with `tidyName` and compared with `normalizeName` (`~/shared/name`), kept in a `normalized_name` column.
- **Rows** read from D1 are decoded with an Effect `Schema`: `db.first` and `db.all` take the schema as their first argument.
- **Effect**: import only from `"effect"`. Everything under a subpath (`effect/sql`, `effect/http`, …) and some `Schema` exports are unstable (ADR 0006); `tests/effect-stability.test.ts` fails if one is used. No Effect in browser code: `app/shared/` and components must not import it.
- **Migrations** are named after the ticket that adds them: `NNNN_<slug>.sql`, where `NNNN` is the zero-padded ticket number (`0007_bills.sql`; a second one from the same ticket is `0007b_...`). Create the file by hand. Tables are `STRICT`.
- **Words**: code uses the English terms of `CONTEXT.md`; the screen uses its Spanish ones.

## Writing an operation

An operation is an Effect program in `app/backend/`. Its dependencies are services, and its rule violations are typed errors. [`app/backend/health.ts`](app/backend/health.ts) is the smallest real one.

```ts
import { Data, Effect, Schema } from "effect";

import { CurrentUser } from "./current-user";
import { Db, statement } from "./db";
import { now, today } from "./time";
import { newId } from "~/shared/id";

export class BillIsVoided extends Data.TaggedError("BillIsVoided")<{ readonly billId: string }> {}

const BillRow = Schema.Struct({ state: Schema.Literals(["open", "paid", "voided"]) });

export const addNote = Effect.fn("addNote")(function* (billId: string, text: string) {
  const db = yield* Db;
  const user = yield* CurrentUser; // cannot run without an author

  const bill = yield* db.first(BillRow, "SELECT state FROM bills WHERE id = ?", billId);
  if (bill?.state === "voided") return yield* new BillIsVoided({ billId });

  // All or nothing: the fact and the projection it changes, in one batch.
  yield* db.batch([
    statement(
      "INSERT INTO bill_edits (id, bill_id, new_value, by, at, day) VALUES (?, ?, ?, ?, ?, ?)",
      newId(), billId, text, user.id, yield* now, yield* today,
    ),
    statement("UPDATE bills SET note = ?, revision = revision + 1 WHERE id = ?", text, billId),
  ]);
});
```

- `db.first(schema, sql, ...params)` gives the decoded row or `undefined`; `db.all` gives every row; `db.run` and `db.batch` give `{ changes }` per statement.
- A batch cannot branch. Put the condition in the SQL (`WHERE revision = ?`) and read `changes` afterwards to detect a stale submission. When one rule refuses a whole operation, every statement of the batch carries the same `Condition` from `~/backend/db`, so a refused operation writes nothing at all; `recordSelection` in `~/backend/bills.ts` shows it.
- Every `Db` method can fail with `DbError`. Leave it alone unless the operation has something better to answer.

## Writing a route

A loader or action stays thin: take the User, parse the input, run one program with `run`, turn the result into a response. [`app/routes/sign-in.tsx`](app/routes/sign-in.tsx) is a small real one.

```ts
import { Effect } from "effect";

import { addNote } from "~/backend/bills";
import { CurrentUser } from "~/backend/current-user";
import { run } from "~/backend/run.server";
import { requireUser } from "~/session.server";

import type { Route } from "./+types/bill-note";

export async function action({ context, params, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();
  const program = addNote(params.billId, String(form.get("note") ?? "")).pipe(
    Effect.provideService(CurrentUser, user),
  );

  return run(context, program, (error) => {
    switch (error._tag) {
      case "BillIsVoided":
        return { error: "Esta cuenta está cancelada." };
    }
  });
}
```

- Every loader and action starts with `requireUser(context)`. The session middleware on the root route has already answered a request without a valid session with a redirect to `/entrar`, before any loader or action ran; `requireUser` hands over the User it found.
- An operation that only an Admin may run starts with `yield* requireAdmin` (from `~/backend/current-user`). That puts `AdminOnly` among its errors, so the route's `switch` has to answer it. An Admin screen answers it with `throw new Response(null, { status: 403 })`, in its loader and in its action; [`app/routes/users.tsx`](app/routes/users.tsx) does.
- A route with several forms tells them apart by the submit button's `name="intent"`, and builds one program for whichever was sent, inside a single `Effect.gen`, so that `onError` gets the union of every operation's errors (`programFor` in `app/routes/users.tsx`). A form it does not understand is answered 400.
- `run(context, program)` resolves with the program's value.
- The third argument receives every typed error except `DbError` and returns what the route answers with, or throws a `redirect(...)`. It is required exactly when the program has such errors, and a `switch` on `error._tag` with no `default` makes the compiler report a missing case.
- `DbError` is logged and becomes a 500 for the error boundary. A bug in the program is rethrown.
- Add the route to `app/routes.ts`, a screen inside the `shell.tsx` layout, and give its entry in the shell's navigation a `to`. Visible text is Spanish.
- A route answered without a session is an exception to spec §10.1. There are two, `/entrar` and `/healthz`. Another one has to be added to `PUBLIC_PATHS` in `app/session.server.ts` and, with its reason, to the exemptions in `tests/route-guard.test.ts`, which requests every route of the app signed out.
- A non-GET request must carry the app's own `Origin`, or the Worker answers 403 before any route runs. Browsers do this by themselves; a script or a test has to set the header.

## Signing in

There are no passwords (ADR 0004). A User types a one-time code on **Entrar**: 8 characters, valid once, for 10 minutes. That phone then holds a session cookie, which lasts until 60 days pass without use.

The first Admin, and anyone when no Admin can sign in, gets a code from the command line:

```sh
npm run db:migrate
npm run sign-in-code -- --new-admin "Diego"   # creates the Admin and prints a code
npm run sign-in-code -- --user "Diego"        # a new code for an existing User
```

Add `--production` to act on the production D1. Only hashes of codes and session tokens are stored.

Everyone else gets their code from an Admin on **Usuarios** (`app/backend/users.ts`), where an Admin also signs a User out of every phone, deactivates or reactivates them and changes their role. `addUser` and `issueSignInCode` in `sign-in.ts` carry no permission check: they are what those operations, the tests and the command line are built on, and no route calls them. The app always keeps one active Admin; that condition is inside the `UPDATE` that would break it, so racing requests cannot get past it.

## Names, and choosing a Customer

A name that must be unique or searchable "ignoring case and accents" is stored twice: as typed, and as `normalizeName(name)` from `~/shared/normalize-name` in a `normalized_name` column. Compare and search on that column only. A prefix search is a range, which an index answers and in which nothing typed is a wildcard: `normalized_name >= ? AND normalized_name < ?`, bound to the prefix and the prefix plus `"\u{10FFFF}"` (see `searchCustomers`).

`CustomerPicker` from `~/components/customer-picker` is a form field: search as the name is typed, matches first, "add new", retired Customers never offered. It talks to its own resource route (`/clientes/selector`), so the screen it sits on needs nothing for it.

```tsx
<Form method="post">
  <CustomerPicker name="customerId" defaultValue={bill.customer} onChange={setCustomer} />
</Form>
```

The field's value is the chosen Customer's id, or `""` for none. `defaultValue` is `{ id, name }` or `null`; `onChange` is optional. The action that receives the id still has to check it: the picker hiding retired Customers is not enforcement.

## Taking a Payment

A Payment is always recorded in the same batch as what moves the Bill's `paid` projection, through the two statements in `~/backend/payments.ts` (`paymentStatements`). There are two ways in, both operations in `~/backend/bills.ts`:

- **Cobrar** on Vender: `recordSelection({ items, payment: { method, amount } })` records the selection and the Payment together (spec §7.3.1). The amount defaults to the selection's total and may be less.
- **Cobrar** on Cuenta: `takePayment({ billId, amount, method, expectedRevision })` (spec §7.3.2). The amount defaults to what the Bill still owes and may be less; `expectedRevision` is the revision the page was rendered from, which the form carries in a hidden field.

A D1 batch cannot branch, so the rules are SQL conditions: `paid + amount <= total` on both statements, and `revision = ? AND state IN ('open', 'partial') AND total - paid >= ?` when the batch is a lone `takePayment`. `paymentStatements(payment, when)` takes the `Condition` the rest of the batch shares, so a refused operation writes neither the Payment nor the projection. Two phones paying the same Bill in full at once therefore record exactly one Payment; the other gets `BillChanged`. When the first statement's `changes` is 0, `takePayment` reads the Bill again to answer the exact rule (`BillChanged`, `BillIsVoided` or `PaymentExceedsOwed`); the routes turn those into `~/shared/payment-messages.ts`.

`takePayment` returns `{ id, amount, bill }`. A Worker who pays a Bill in full is redirected to Cuentas abiertas instead of staying on the page, because a Worker may not open a Paid Bill (§4.1). The amount handed over for cash is never submitted or stored: `PaymentFields` from `~/components/payment-fields` shows `changeFor(handedOver, amount)` while it is typed.

## Writing a test

Tests live in `tests/*.test.ts` and run inside workerd. Each test file starts with its own freshly migrated D1; tests in the same file share it, so use distinct ids.

```ts
import { Effect } from "effect";
import { expect, it } from "vitest";

import { addNote } from "~/backend/bills";

import { as, signedIn, seedUser } from "./support/auth";
import { advanceClock, runTest, setClock } from "./support/effect";

it("refuses a note on a Voided Bill", () =>
  runTest(
    Effect.gen(function* () {
      yield* setClock("2026-10-05T23:50:00"); // Mexico City wall-clock time
      const ana = yield* seedUser("admin"); // a real row in users
      // ...arrange through other operations...
      yield* advanceClock("15 minutes"); // now it is the next Day

      const error = yield* Effect.flip(addNote("b1", "hola").pipe(as(ana)));
      expect(error._tag).toBe("BillIsVoided");
    }),
  ));

it("does not show Inventario to a Worker", async () => {
  const beto = await signedIn("worker"); // a new User with a live session
  const response = await beto.fetch("/inventario");
  expect(response.status).toBe(403);
});
```

- `runTest(program)` provides `Db` over the real local D1 and a test clock. The clock starts at the Unix epoch and moves only with `setClock` and `advanceClock`.
- A typed failure rejects the test. To assert on one, turn it into a value with `Effect.flip` or `Effect.exit`.
- Test through operations and routes, not by reaching into tables.
- `tests/support/auth.ts` has the Users: `seedUser(role, name?)` adds one inside a `runTest` program and `as(user)` runs an operation as them. For the whole Worker, `signedIn(role, name?)` gives a new User with a session and a `fetch(path, init?)` that sends its cookie; `appFetch(path, init?)` is the same request signed out. Both leave redirects unfollowed and set the app's `Origin` on non-GET requests.
- `tests/support/catalog.ts` has the catalog: `seedCategory(name?, by?)` and `seedItem({ name?, price?, categoryId?, stockTracked?, minimum?, startingStock?, by? })`, both through the real operations, with a default for everything. `by` is the Admin who adds it; without it a new Admin is added.
- `tests/support/customers.ts` has the Customers: `seedCustomer(name, { by?, note?, retired? })` inside a `runTest` program, and `savedCustomer(...)`, the same as a promise, for tests that go through the Worker. In `e2e/fixtures.ts` it is the `addCustomer(name, { by, note?, retired? })` fixture.
- A rule about the whole table (the last active Admin) needs a file whose tests each start from an empty database: `reset()` and `applyD1Migrations` from `cloudflare:test` in a `beforeEach`, as in `tests/last-admin.test.ts`.
- The Worker reads the real clock, so a test that goes through it cannot move time. Rules about time are tested on operations with `runTest`.
- Browser tests live in `e2e/*.spec.ts` and import `test` and `expect` from `./fixtures`, which serves the built Worker over local HTTPS and gives every test an empty migrated D1. Its `signInAs(role, name?)` fixture adds a User and signs the test's browser in without going through Entrar; `addUser` and `issueCode` are there for tests about signing in. `addCategory(name?)` and `addItem({ name?, price?, category?, stockTracked?, minimum?, stock? })` seed the catalog by writing rows directly. `query(sql, params?)` reads rows from the Worker's D1, for what no screen shows yet.
