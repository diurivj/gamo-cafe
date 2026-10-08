# Gamo Cafe

Sales and stock tracking for one cafeteria, in Spanish, on phones. The domain language is in [`CONTEXT.md`](CONTEXT.md), the decisions in [`docs/adr/`](docs/adr/).

React Router 8 (framework mode) on Cloudflare Workers, D1 with hand-written SQL, Effect 4 on the backend, Tailwind 4 with shadcn/ui components. Two environments: local and production.

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
| `npm run projections:verify` | Reports every projection that disagrees with the facts. Exits 1 when there are differences. `:production` acts on the production D1. |
| `npm run projections:rebuild` | Rewrites every projection from the facts. `:production` acts on the production D1. |
| `npm run seed` | Writes `seed.sql`: the synthetic year behind the §10.7 request budgets. `:local` applies it to the local D1. |
| `npm run deploy:production` | Builds for production and deploys with Wrangler. |
| `npm run sign-in-code -- --new-admin "Nombre"` | Creates an Admin in the local D1 and prints a one-time sign-in code. `--user "Nombre"` issues a code for an existing User; `--production` acts on the production D1. |

`wrangler.jsonc` (`env.production`) holds the id of the production D1, `gamo-cafe-db`. Take a database export before every production migration (spec §3.3).

## Layout

```
app/
  backend/     Effect code. Server only.
    db.ts          Db service over the D1 binding, DbError, statement()
    current-user.ts  CurrentUser service, requireAdmin and the AdminOnly error
    sign-in.ts     codes and sessions: addUser, issueSignInCode, useSignInCode, authenticate, signOut
    users.ts       what an Admin does on Usuarios: add, new code, sign out everywhere, deactivate, role
    catalog.ts     Items and Categories; activeItemsByCategory is the read for the Sell screen
    submissions.ts one submission per rendered form: the key a form carries, written in the batch of what it records
    stock.ts       the statements that move Stock (changeStock, adjustmentStatements, countStatements), stockOf, lastCountedAt
    inventory.ts   Inventario: Stock and Minimums, recording and cancelling Adjustments
    counts.ts      Conteo: what the entry and review steps show, recording a Count, and the Diferencias read (a page of Counts by cursor)
    command-line.ts  the SQL that scripts/sign-in-code.ts sends to D1
    rebuild.ts     the SQL that scripts/projections.ts sends to D1: recompute every projection from the facts
    time.ts        now, today (the only source of "now")
    run.server.ts  run(): the one way a loader or action runs a program
    health.ts      the reference operation
    home.ts        Inicio: the figures its cards carry, an Admin's only for an Admin
    customers.ts   Customers: addCustomer, searchCustomers, getCustomer, editCustomer, retireCustomer, restoreCustomer
    bills.ts       Bills, Lines and Payments: recordSelection, takePayment and takeCustomerPayment (one batch each), getBill (the §4.1 gate), listOpenBills, listBills and listCustomerPastBills (a page by cursor), listCustomerOpenBills, listCustomerHandovers
    corrections.ts the corrections of Cuenta: removeLine, removePayment, voidBill (one batch each), and recordedCorrection, which answers one sent again
    payments.ts    the statements a Payment writes (paymentStatements and handoverStatements) and its errors
    day.ts         the figures of a Day: myDay (Mi día), everyonesDay (Día: the range asked for, every User's figures and the Items sold), todaysFigures (Inicio)
    owed.ts        Por cobrar: each Customer's Owed, a page of the Open Bills with no Customer and the overall Owed
    history.ts     Historial: the corrections and Adjustments, newest first, a keyset page over the six fact tables
    seed.ts        the synthetic year behind the §10.7 request budgets, as plain SQL that scripts/seed.ts writes
  shared/      Plain functions, no Effect. Safe in the browser.
    money.ts       centavos, formatMoney, parsePesos, changeFor
    bill-state.ts  a Bill's states, their Spanish words, isOpenBill
    payment.ts     cash or transfer, and their Spanish words
    payment-messages.ts  what a Payment's rule violations say on screen
    day.ts         Instant, Day, dayOf, parseDay, formatDay, formatTime
    id.ts          newId
    sha256.ts      the SHA-256 of a string, in hex
    secret.ts      sign-in codes, session tokens, their hash, the cookie name
    normalize-name.ts  normalizeName: a name with case and accents ignored
    units.ts       parseUnits (a typed whole number of units)
    cursor.ts      Cursor: where a paged list's next page starts, and how the URL carries it
    discrepancy.ts discrepancyText: Faltante, Sobrante, or Sin diferencia
    correction-messages.ts  what a correction's rule violations say on screen
    correction.ts  Cuenta's corrections: what each would do (`correctionPlan`), its state, `correctionAfter`, the snapshot it is sent as and what its result says
    customer-messages.ts  what a Customer form's rule violations say on screen
    chunk.ts       chunk: a list in parts of at most N
    adjustment.ts  an Adjustment's reasons, their Spanish words and their sign
    notice.ts      a Notice's shape, and useSaidNotice: the last one a screen said
    bill-payment.ts  Cuenta's Payment: its state, `billPaymentAfter`, the snapshot it is sent as and what its result says
    customer-payment.ts  Abonar: its state, `customerPaymentAfter`, the snapshot it is sent as and what its result says
    list-return.ts useListReturn and listReturn: a list's last search, for the way back from a screen it led to
    sale.ts        Vender's one sale at a time: its state, `step`, the snapshot it is sent as and what its result says
    payment-draft.ts  a Payment while it is typed, and what it would pay (readPaymentDraft)
    record-request.ts  sendForRecord: sends a form that records something and says confirmed, refused or unknown
    category-drawing.ts  categoryDrawing: the drawing that fits a Category's name, or none
    text.ts        trimToNull: form text trimmed, empty as nothing said
    navigation.ts  the shape of the navigation, and destinationAt: the destination a screen belongs to
    role.ts        what the screen calls each role
  components/  React components used by more than one screen
    customer-picker.tsx  CustomerPicker, the form field that chooses a Customer
    submit-button.tsx  SubmitButton, the button that submits a form and is pending from the tap
    bill-state-badge.tsx  BillStateBadge, a Bill's state in words, as lists and Cuenta show it
    payment-entry.tsx  PaymentEntry, how a Payment is entered from Vender on: method, all or a part, cash change
    confirm-dialog.tsx  ConfirmDialog, the question before unfinished work is discarded or left
    recording.tsx  what the screens that record with sendForRecord share: Pending, SentRows, Change, useLeaveGuard, useReadAgainSince
    item-fields.tsx  ItemFields, the fields of an Item's form, new or existing
    count-line.tsx  CountLineItem, one line of a Count as Conteo and Diferencias show it
    paged-list.tsx  usePagedList and LoadMore: a list's pages and its Cargar más
    ui/            shadcn/ui components, copied in by its CLI and adjusted here (see "The look and the navigation")
    styles.ts      a screen's headings and supporting text, which shadcn has no component for
    notice.tsx     Notice, how the app says what happened: recorded, refused, or worth knowing
    icons.tsx      the app's few line drawings
    error-screen.tsx  ErrorScreen and ErrorPage, what stands in for a screen that cannot be shown
  session.server.ts  the session middleware, requireUser, the cookie
  notice.server.ts  what a recorded form says on the screen that sent it: answerWithNotice, takeNotice
  shell.server.ts  shellMiddleware: reloads the page of a phone whose shell shows a User as they no longer are
  navigation.server.ts  what each role's navigation holds: its four destinations and the groups of its Más
  catalog-forms.server.ts  the shared Admin gate (`requireAdminUser`, `refuseRead`) and the Productos forms' parsing and error messages
  lib/utils.ts   cn, shadcn's class-name merge
  routes/      Route modules; resources/ holds routes without UI
    shell.tsx      the signed-in layout: who is signed in and the role's four destinations
    screen.tsx     the layout between the shell and its screens, where a screen's failure stops
    mas.tsx        Más: the role's remaining screens, and Salir
    inicio.tsx     Inicio: the home screen's cards
    sell-items.tsx the layout around Vender that holds its Items
    home.tsx       Vender: the two steps of a sale, its recording and its result
    resources/record-sale.ts  where Vender sends a sale; answers JSON
    open-bills.tsx Cuentas abiertas: the Open Bills, searched by Customer
    bill.tsx       Cuenta: the Bill, the step that takes its Payment, Cliente y nota and the step of each correction
    resources/record-payment.ts  where Cuenta sends a Payment; answers JSON
    resources/record-correction.ts  where Cuenta sends a correction; answers JSON
    customers.tsx  Clientes: search by name, the matches, and adding a new Customer
    customer.tsx   Cliente: what they owe, their Open Bills, the step that takes an Abonar, and an Admin's management
    resources/record-handover.ts  where a Customer's page sends an Abonar; answers JSON
    historial.tsx  Historial: every correction and Adjustment, with the record as it was made
  routes.ts    Route table
workers/app.ts   Worker entry; rejects non-GET requests from another origin
scripts/         Command-line scripts, run by Node as TypeScript
migrations/      Hand-written .sql, applied by Wrangler
tests/           Vitest, Workers pool
e2e/             Playwright
```

## Conventions

- **Money** is integer centavos. Add and subtract with integer `+` and `-`; turn it into text with `formatMoney` and read typed text with `parsePesos`. Never divide or multiply an amount by 100.
- **Time**: an instant is epoch milliseconds; a Day is `YYYY-MM-DD` in `America/Mexico_City`, computed when a record is written and stored with it. Backend code gets them only from `now` and `today` in `~/backend/time`, never from `Date`. Text that should name a Day (a date in a URL) is read with `parseDay` from `~/shared/day`, which answers `null` for a date the calendar does not have. The seed generator (`~/backend/seed.ts`) is the one exception: its synthetic year does calendar arithmetic of its own (`addDays`, `weekDay`, `localInstant`), over fixed dates and not the clock.
- **Ids** are opaque strings from `newId()`.
- **Facts** are inserted once and never updated or deleted. **Projections** are written only in the same `db.batch` as the fact that changes them (spec §7.1). The command below recomputes them all from the facts at any time.
- **Stock** is the projection `stock_levels`, and only `~/backend/stock` writes it. An operation that moves Stock puts `changeStock(itemId, units)` (relative, negative to lower) in the same batch as its fact; an Adjustment is `adjustmentStatements({...})`. Both do nothing to an Item that is not stock-tracked. An Item with no row has a Stock of zero.
- **Names** of Items are stored as `~/backend/catalog` tidies them (trimmed, single spaces) and compared with `normalizeName` (`~/shared/normalize-name`), kept in a `normalized_name` column.
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
- An operation that only an Admin may run starts with `yield* requireAdmin` (from `~/backend/current-user`). That puts `AdminOnly` among its errors, so the route's `switch` has to answer it. An Admin screen answers it with `throw new Response(null, { status: 403 })`, in its loader and in its action; [`app/routes/users.tsx`](app/routes/users.tsx) does. The boundary of `app/routes/screen.tsx` renders every 403 as the Spanish "No tienes acceso a esta página", inside the User's navigation, so the status stays 403 and the words are not the framework's.
- A route with several forms tells them apart by the submit button's `name="intent"`, and builds one program for whichever was sent inside a single `Effect.gen`, so that `onError` gets the union of every operation's errors (`programFor` in `app/routes/users.tsx`). A form it does not understand is answered 400. A route may run more than one program when the second only says more about what the first refused: `app/routes/resources/record-correction.ts` runs the correction and, when it is refused as stale, looks for the same correction already recorded and asks whether the User may read the Bill again. Each `run` still gets a typed, exhaustive error map — a `switch` on `error._tag` with no `default`.
- `run(context, program)` resolves with the program's value.
- An action that records something answers the request that sent the form with a **notice**: what that screen must say (spec §3.4), through `~/notice.server`. The browser's router sent the form as a data request, so the notice travels in the action's own answer — `answerWithNotice(request, to, notice)` returns `{ notice }` — and the screen that sent the form reads it: `useActionData()?.notice`, or a fetcher's `data.notice`. Only that screen can read it, so two answers at once cannot lose or take each other's words, and no other tab can take them. A document POST — JavaScript off, the browser posted the page itself — gets the redirect and the cookie instead, and the loader of the page it names returns `notice: takeNotice(context)`; the cookie lasts a minute, the page takes it once, and the message is never in the URL. Besides `message`, a notice can name the `form` that was recorded, and every notice has a new `id`: a page keys a form on it to start that form over (`fresh` in `app/routes/inventario.tsx`). A refusal still answers 400 with its Spanish message as action data, on the same form. An action with nothing to say returns a plain `redirect(...)`, or `replace(...)` when a fetcher sends its form, so that the redirect back to the same page adds no history entry; the cookie redirect replaces.
- Every tap is acknowledged at once (spec §3.4). A form's submit button is `<SubmitButton>` from `~/components/submit-button`, never a `<button type="submit">`: the one that was tapped is `aria-busy` and disabled until the answer is on the page, and `tests/submit-controls.test.ts` fails on one written by hand. What else the screen may show before the answer depends on what the form records:
  - **Money and Stock** (an Adjustment, a Count): nothing. A plain `<Form>` with a `SubmitButton`; the figures change when the loader has run again.
  - **A harmless, reversible change** (retiring a Customer, a User's role or active state): its result, at once. The form is a `<fetcher.Form>` with `<SubmitButton fetcher={fetcher}>`, and the page renders what `fetcher.formData` asks for in place of what the loader gave; when the server refuses, `fetcher.data.error` is shown and the form data is gone, so the page is back to what the server has (`UserRow` in `app/routes/users.tsx`). The words that say it was recorded come in that row's own answer, which the page shows.
  - **Vender**, **Cuenta's Payment**, **Cuenta's corrections** and **Abonar** are their own case, and have no form at all: see [Vender: one sale at a time](#vender-one-sale-at-a-time), [Cuenta: taking its Payment](#cuenta-taking-its-payment), [Cuenta: its corrections](#cuenta-its-corrections) and [Abonar across a Customer's Bills](#abonar-across-a-customers-bills).
  No client-side store: the pending state is the router's (`useNavigation`, fetchers), and on Vender, Cuenta and Cliente the reducers of `~/shared/sale`, `~/shared/bill-payment`, `~/shared/correction` and `~/shared/customer-payment`.
- A form that creates a Bill, a Payment, an Adjustment or a Count carries a key, so a double tap or a retry on a bad connection records nothing twice (spec §3.4). The loader of the page makes it (`submissionKey: newId()`), the form sends it in a hidden `submissionKey` field, and the action hands it to the operation, which records one submission per key and content and answers a repeat with what the first one answered, so the action builds the same notice for it. A changed form sent with a used key (a document the browser restored) is not a repeat: it is recorded, or refused by a rule visibly. The loader runs again after every recorded form, which is what gives the next form a new key: a route that skips that revalidation would send the old key again, and the next form would be taken for a repeat. Vender, Cuenta's Payment and Abonar have no rendered form: each makes its key in the browser at the tap, when it freezes what is sent (`snapshotOf` in `~/shared/sale`, `billPaymentSnapshot` in `~/shared/bill-payment`, `customerPaymentSnapshot` in `~/shared/customer-payment`). Conteo's confirming form is rendered by the review action, which makes its key. See [One submission per form](#one-submission-per-form).
- After a recorded form the browser's router runs every loader of the page again, and that is what a loader about Bills, Payments or Stock needs: leave it alone. Two loaders are about neither and export `shouldRevalidate` to be kept instead (spec §3.4). The shell's (`app/routes/shell.tsx`) runs again only after a form on Usuarios; when an Admin changes a User's role from another phone, `shellMiddleware` (`~/shell.server`) answers that User's next navigation with a reload of the page. Vender's Items are the loader of a layout around it (`app/routes/sell-items.tsx`), read when Vender is opened; a sale reads nothing again, and neither does moving between its two steps. A loader that takes a notice — a document POST's, `takeNotice` — must not be skipped, or its message stays on screen; a form the browser's router sent brings its notice in the answer instead. Nothing is cached anywhere else: `workers/app.ts` answers everything with `Cache-Control: no-store`, and `tests/reuse.test.ts` holds that and the D1 statements a sale costs.
- The third argument receives every typed error except `DbError` and returns what the route answers with, or throws a `redirect(...)`. It is required exactly when the program has such errors, and a `switch` on `error._tag` with no `default` makes the compiler report a missing case.
- `DbError` is logged and becomes a 500 for the error boundary. A bug in the program is rethrown.
- Add the route to `app/routes.ts`, a screen inside the `screen.tsx` layout, and give it a link in `app/navigation.server.ts`: in a group of the Más of each role that may open it, unless it is reached from another screen. Visible text is Spanish. See [The look and the navigation](#the-look-and-the-navigation).
- A route answered without a session is an exception to spec §10.1. There are two, `/entrar` and `/healthz`. Another one has to be added to `PUBLIC_PATHS` in `app/session.server.ts` and, with its reason, to the exemptions in `tests/route-guard.test.ts`, which requests every route of the app signed out.
- A new route is also unclassified until it has an entry in `tests/permissions-matrix.test.ts`. That test sweeps the route manifest and holds one entry per route — signed out, as a Worker, as an Admin, for the loader and for the action — plus one check per row of the §4.1 matrix, and it fails until the new route is classified. A Worker is refused what §4.1 reserves for Admins; `tests/worker-visibility.test.ts` reads the pages a Worker may open and checks §4.2's numbers are not in them.
- A non-GET request must carry the app's own `Origin`, or the Worker answers 403 before any route runs. Browsers do this by themselves; a script or a test has to set the header.

## The look and the navigation

The redesign's rules are in `.scratch/ui-redesign/spec.md` (§3, §4 and §8). Entrar, the shell, Inicio, Más, Vender, Cuentas abiertas, Cuenta, Historial, Clientes, Cliente, the Customer picker and the error pages follow them; the other screens are moved over one ticket at a time, and keep working meanwhile.

- **The look is shadcn/ui's**, in its Maia preset over Base UI (`components.json`). Its components are copied into `app/components/ui/` and are this repo's code from then on. Add one with `npx shadcn@latest add <name>` (answer no when it offers to overwrite `button.tsx`), and build screens from them — `Card`, `Button`, `Input`, `Textarea`, `Label`, `Alert`, `Badge`, `RadioGroup`, `AlertDialog` are there — instead of styling by hand. The colors are the variables the CLI wrote in `app/app.css` (`background`, `foreground`, `primary`, `muted`, `border`, …); use those names (`bg-muted`, `text-muted-foreground`), never a raw color. The font is Figtree, bundled by `@fontsource-variable/figtree`.
- **What differs from the preset**, because the spec's §8 asks for it (18px text, 48px targets, contrast): `Button` has a `touch` size (56px tall, 18px text) for every action and `icon-touch` (48px square) for one that is only a drawing; a `RadioGroupItem` is 24px inside a `Label` that is the 48px target; an `AlertDialog` has 18px text, `touch` actions, and scrolls when large text makes it tall; `Input` is 56px tall with 18px text and a white fill, and `Textarea` has the same text and fill and grows with what is typed; `Label`, `Card` and `Alert` text is 18px; a `Badge` is 28px tall with 16px text; the outline `Button` is white with the field's edge; and `--muted-foreground`, `--input` and `--ring` are darker. Each change is commented where it is made. A component added later starts at the preset's sizes: bring it to these.
- **A form's submit control is still `SubmitButton`**, with a `Button`'s classes: `className={buttonClasses({ size: "touch" })}` from `~/components/ui/button`. A link drawn as a button takes the same. `Notice` from `~/components/notice` is an `Alert` with the role its tone needs. `~/components/styles` holds the three things shadcn has no component for: `pageTitle`, `sectionTitle` and `hint`.
- A field has a visible `Label` and no placeholder standing in for one; one default (dark) `Button` per step, the rest `outline`; a `Notice` tells its tone by its drawing as well as its color and never disappears by itself. Words are few: a label says what a thing is, and a sentence is added only for a consequence the User could not guess.
- **Focus**: a shadcn component draws its own ring; `app.css` gives everything else one outline. The shell moves the focus to `<main>` when the path changes, unless the new screen already took it. A screen that changes what it shows without changing its path — Vender's steps and results — moves the focus to its own `<h1>`, which says what happened.
- **What sticks to the bottom** (Vender's total) rests at `bottom-(--above-bar)`, just above the bar, and marks its screen `data-sticky-total` so `scroll-padding-bottom` keeps a focused control clear of both. Where two things must fit side by side or stack, use a container query in `rem` (`@container`, `@[17rem]:`), which follows enlarged text; a media query does not.
- **Navigation**: `app/navigation.server.ts` holds each role's four destinations and the groups of its Más. Inicio is the first destination and Más the last. Loaders send only the role's own, so a Worker's phone gets no Admin label or path; `tests/navigation.test.ts` and `tests/worker-visibility.test.ts` hold that. A destination `holds` the paths under it that are not its own, which is how the shell marks where the User is (`destinationAt`); a screen no destination holds is under Más. The bar is fixed at the bottom of a phone and stands at the side from `lg` up; `<main>` leaves room for it (`--bar-room`) and `scroll-padding-bottom` keeps a focused control out from under it. On a phone there is no header: who is signed in is said on Inicio and Más, and to a screen reader on every screen.
- **Inicio** (`app/routes/inicio.tsx`, `/inicio`) is where a User lands after Entrar: cards that are a figure and the way into its screen. `homeSummary` in `~/backend/home.ts` reads them — the User's own Day and the Open Bills for everyone, the Day of everyone and what to restock only for an Admin. It answers with the Day its figures are about, read once, and that is the date Inicio shows. Vender stays at `/`.
- **Salir** is on Más, away from any task's action.
- **A screen that cannot be shown** — not there, not allowed, failed — is answered by the boundary of `app/routes/screen.tsx`, inside the navigation, with `ErrorScreen`. The root boundary answers what has no shell: a path the app does not have. A failure that may have interrupted a form says the form may have been recorded, never that it was not. A request without a live session is sent to Entrar, which says the session ended when the phone still carries a session's cookie.
- Browser tests open a screen with `goTo(page, "Productos")` from `e2e/support/navigate.ts`: a tap on a destination, or Más and then the link.

## Rebuilding the projections

`npm run projections:verify` recomputes every projection from the facts and reports each difference; `npm run projections:rebuild` rewrites them. Add `:production` to act on the production D1 (take an export first, as before any production migration). Every column either is a fact or comes back:

- a Bill's `total` is its unremoved Lines, `paid` its unremoved Payments, and its `state` follows from those two or from its void. Its current Customer and note are the last `bill_edits` fact of each field; a field never edited is what the Bill was created for — the facts `opened_customer_id` and `opened_note`, which `recordSelection` writes (migration `0019_bills_created_for.sql`). `revision` is a counter, not derived, and is left alone.
- an Item's Stock replays the facts in time order: its Lines that moved Stock (`lines.moved_stock`) down, their removals and their Bills' voids up (once per Line), Adjustments by their signed units, cancelled Adjustments reversed, and Counts as resets to the units found. `last_counted_at` is the Item's newest Count. An Item with no such fact has a Stock of zero, and a Stock row no fact justifies is removed.
- switching stock tracking on or off changes no record (spec §5.1), and the facts say what did move Stock: `moved_stock` on each Line, and the Adjustment's own record. Cancelling an Adjustment therefore reverses it even if tracking was switched off meanwhile — the same rule as the units of a removed Line. Without that rule a cancellation recorded while tracking was off moved nothing and no fact recorded it, so no rebuild could reproduce the live number.

Every operation reads the clock, so events sort by their instant; the facts of one batch share it, and their kind and rowid break the tie. The tests in `tests/rebuild.test.ts` and `tests/rebuild-property.test.ts` send these statements to a real D1 whose state random sequences of the operations built, and check that verify finds nothing, a hand-corrupted projection is detected, and the rebuild restores it.

## Request budgets

Spec §10.7 holds nine requests to a budget against a year of synthetic records: at most 50 D1 statements each, rows read that do not grow with the history, and no row written by a request that only reads. Two local tests prove it, inside `npm test`; nothing runs against a deployment (ADR 0007).

```sh
npm test -- tests/proof-seed.test.ts tests/proof-budget.test.ts
```

The seed test loads the whole year into a real D1 and asserts its shape (200 Open Bills, one Customer with 30 of them, a clearly busiest Day, every History fact table) and that `projections:verify`'s SQL finds no difference. The budget test loads four months, measures the nine requests, appends the rest of the year and measures them again: each request must issue at most 50 D1 statements and read the same rows at both sizes, and each has a cap of its own. The six GETs must also write no row: a session's `last_used_at` moves at most once an hour. The requests are real HTTP requests through the Worker, with a counting D1 swapped into the binding. The nine are the Sell screen, a ten-Item selection with Payment, Cuentas abiertas, Abonar across the 30-Bill Customer (sent to `/clientes/:customerId/abonar`), Día for the busiest Day, a page of Cuentas, Inventario, a Count of every Item and a page of Historial.

### The seed

The year runs `2025-10-01` to `2026-09-30` in `America/Mexico_City`: four Users, eight Categories, 60 stock-tracked Items, 40 Customers, Bills with Lines and Payments, corrections of every kind, Adjustments with cancellations and monthly Counts. The last hundred Days hold the 200 Open Bills; the Customer `proof-customer-30` holds 30 of them and the busiest Day is `2026-08-15`. Ids, days and the record of each day derive from a hash of the Day, so a window of Days is a subset of the year.

The generator writes facts and then runs the ticket 19 rebuild over them, so a loaded database is consistent by construction. It loads into the local D1 only, to develop against a full database:

```sh
npm run seed                 # writes seed.sql and prints the report
npm run db:migrate
npm run seed:local           # ... and applies it to the local D1
npm run projections:verify
```

The local load expects a fresh database: loading the seed twice fails on its own ids. Remove `.wrangler/state/v3/d1` to start the local D1 over. Sign in to it with `npm run sign-in-code -- --user "Ana"`.

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

A name that must be unique or searchable "ignoring case and accents" is stored twice: as typed, and as `normalizeName(name)` from `~/shared/normalize-name` in a `normalized_name` column. Compare and search on that column only. A prefix search is a range, which an index answers and in which nothing typed is a wildcard: `normalized_name >= ? AND normalized_name < ?`, bound to the prefix and `prefixRange(prefix)` (see `searchCustomers`).

`CustomerPicker` from `~/components/customer-picker` is a form field: search as the name is typed, matches first, "add new", retired Customers never offered. It talks to its own resource route (`/clientes/selector`) with the browser's `fetch`, so the screen it sits on needs nothing for it and is never replaced by the picker's failure.

```tsx
<Form method="post">
  <CustomerPicker name="customerId" defaultValue={bill.customer} onChange={setCustomer} />
</Form>
```

The field's value is the chosen Customer's id, or `""` for none. `defaultValue` is `{ id, name }` or `null`; `onChange` is optional. The action that receives the id still has to check it: the picker hiding retired Customers is not enforcement.

## Taking a Payment

A Payment is always recorded in the same batch as what moves the Bill's `paid` projection, through the statements in `~/backend/payments.ts` (`paymentStatements`). There are three ways in, all operations in `~/backend/bills.ts`:

- **Registrar pago** on Vender's review step: `recordSelection({ items, payment: { method, amount } })` records the selection and the Payment together (spec §7.3.1). Its amount defaults to the selection's total and is never more than it — prior debt is paid from Cuenta — which is also what keeps the batch's `paid + amount <= total` condition from failing after the Lines were written.
- **Cobrar** on Cuenta: `takePayment({ billId, amount, method, expectedRevision })` (spec §7.3.2). The amount defaults to what the Bill still owes and may be less; `expectedRevision` is the revision the screen showed, frozen into the Payment at the tap. See [Cuenta: taking its Payment](#cuenta-taking-its-payment).
- **Abonar** on a Customer's page: `takeCustomerPayment`, which spreads one amount over their Open Bills (see below).

A D1 batch cannot branch, so the rules are SQL conditions: `paid + amount <= total` on both statements, and `revision = ? AND state IN ('open', 'partial') AND total - paid >= ?` when the batch is a lone `takePayment`. `paymentStatements(payment, when)` takes the `Condition` the rest of the batch shares, so a refused operation writes neither the Payment nor the projection. Two phones paying the same Bill in full at once therefore record exactly one Payment; the other gets `BillChanged`. When the first statement's `changes` is 0, `takePayment` reads the Bill again to answer the exact rule (`BillChanged`, `BillIsVoided` or `PaymentExceedsOwed`); the routes turn those into `~/shared/payment-messages.ts`.

`takePayment` returns `{ id, amount, paid, total, owed }`. A Worker who pays a Bill in full sees the result and is offered Cuentas abiertas, never the Bill, because a Worker may not open a Paid Bill (§4.1). The amount handed over for cash is never submitted or stored: it is only what the change is computed from, by `readPaymentDraft` (`~/shared/payment-draft`) on Vender, Cuenta and Abonar.

**Entering a Payment** from Vender on is `PaymentEntry` (`~/components/payment-entry`): Efectivo or Transferencia as two large choices, everything by default with **Cobrar solo una parte** for less, and for cash the amount handed over with its change. The screen holds a `PaymentDraft` and reads what it pays with `readPaymentDraft(draft, full, tooMuch)`; every Payment starts as `NEW_PAYMENT` — cash, everything — so a method is never carried over from the one before. Abonar uses it too, with what the Customer owes as `full`.

## Vender: one sale at a time

Vender (`app/routes/home.tsx`) is two steps and then a result (UI redesign §5, §6). Step 1 chooses the Items; step 2, at `?paso=cobrar`, reviews them and records a Payment or leaves the Bill Open; the confirmed result stays until **Nueva venta**. There is no second sale while one is being recorded.

- **The state** is one reducer, `saleAfter` in `~/shared/sale`, and the screen renders it: `editing`, `recording`, `unknown`, `confirmed`. An event the phase does not allow changes nothing, so "frozen while it is being recorded" and "only Nueva venta starts another" are rules of that module, tested in `tests/sale.test.ts`, not conventions of the markup. Which step is on screen is the address's, so the browser's Back goes from step 2 to step 1 and keeps everything typed.
- **A sale is sent as a snapshot**: `snapshotOf` freezes the Lines, the Customer, the note, the Payment and a new submission key at the tap, and `saleBody` turns it into the same form every time. A retry sends that very snapshot, which the server takes for the same submission ([One submission per form](#one-submission-per-form)).
- **It travels by the browser's own `fetch`**, `sendForRecord` in `~/shared/record-request`, to `/vender/registrar` (`app/routes/resources/record-sale.ts`), which answers JSON: `{ sale }` with the Bill as the sale left it, or 400 with `{ error }`. Not a `<Form>` or a fetcher: the router answers a request that failed on its way with the error screen, which would replace the very screen a safe retry needs. Three outcomes, and no fourth: **confirmed** (a 200 answer that carries the sale), **refused** (a 4xx with its reason: the draft comes back as it was, minus the Items the server says are retired, and with the Items read again when it says a price changed), **unknown** (anything else: no connection, no answer in 20 seconds, a 5xx). Unknown is never called failed: the screen says the sale may or may not have been recorded and offers **Volver a intentar**. A session that ended is a refusal on a first attempt, because Entrar answered before any action ran; on a retry it leaves the sale unknown, because the first attempt may have been recorded.
- **Nothing is read after a sale.** The answer carries what the result shows, so no failed read can take a confirmed sale off the screen; `shouldRevalidate` in `home.tsx` and `sell-items.tsx` also skip the step change. `CustomerPicker` searches and adds with its own `fetch` for the same reason: a search that gets no answer says so in the picker, and the sale stays as it was.
- **What the result says** is `saleOutcome(snapshot, result)`: the Payment that was recorded and what the Bill still owes. "Cuenta pagada" only when the server says nothing is owed — a Payment covers its own selection, never the earlier debt of the Bill it joined. A Worker is offered **Ver cuenta** only for a Bill they may open (`canOpen`).
- **Unfinished work** is guarded by `useBlocker` and `ConfirmDialog`: leaving a selection asks whether to discard it, leaving a sale on its way says that leaving does not cancel it, and `beforeunload` asks the browser to warn too. After a restart nothing is resubmitted or assumed; step 1 links to Mi día.

Cuenta's Payment and Abonar reuse `sendForRecord`, `PaymentEntry` and `ConfirmDialog` (below). Browser tests drive Vender with `e2e/support/sell.ts` (`select`, `review`, `leaveOpen`, `pay`, `addToBill`); `e2e/vender-recovery.spec.ts` holds, drops and loses requests to cover each outcome.

## Cuenta: taking its Payment

Cuenta (`app/routes/bill.tsx`) leads with the Bill's state and what it owes, and keeps its two routine actions apart: **Cobrar** opens the step that takes a Payment, at `?paso=cobrar`, and **Agregar productos** opens Vender targeting the Bill. Cliente y nota comes after the Lines and the Payments, and is still a `<Form>` answered by the page's own action.

- **The state** is one reducer, `billPaymentAfter` in `~/shared/bill-payment`, tested in `tests/bill-payment.test.ts`: `editing`, `recording`, `unknown`, `confirmed`, and `gone`. Which of the Bill and its Cobrar step is on screen is the address's, so the browser's Back goes from the step to the Bill.
- **A Payment is sent as a snapshot**: `billPaymentSnapshot` freezes the method, the amount the action said, the Bill's revision and a new submission key at the tap. It goes with `sendForRecord` to `/cuentas/:billId/cobrar` (`app/routes/resources/record-payment.ts`), which answers JSON: `{ payment }` with the Bill's figures as the Payment left them, or a 4xx with `{ error }`. Confirmed, refused and unknown mean what they mean on Vender, and an unknown one is retried as the very same snapshot.
- **A refusal that says the Bill is not what the screen showed** carries `changed: { canOpen }`. With `canOpen` the screen reads the Bill again and keeps the Payment as it was typed, now checked against what is owed today. Without it — a Worker whose Bill another phone paid or voided — the Payment ends as `gone`: nothing was recorded, and the way on is Cuentas abiertas, not an error page.
- **Nothing is read after a Payment** until the User asks: the result stays, with **Cuentas abiertas** and, only for a Bill this User may open, **Ver cuenta**. The result gives way when the Bill is read again (its revision is no longer the snapshot's).
- **A Payment on its way or of unknown outcome** is guarded by `useLeaveGuard` (`~/components/recording`: `useBlocker` and `beforeunload`) and `ConfirmDialog`, as a sale is guarded.
- **The page's own forms read the Bill again even when refused** (`shouldRevalidate`), so the next attempt carries the Bill's revision as it is now; the router would keep stale data after a 400.
- **The way back to the list** goes back in history when a list is the entry behind the Bill, which restores its search, its pages and its place. A list says so in its link's `state` (`state={{ fromList: "/historial" }}`) and has a name in `bill.tsx` (`listName`): Cuentas abiertas and Historial in `LISTS`, and any Customer's page (`/clientes/:customerId`), called **Cliente**. Otherwise the way back is a link to Cuentas abiertas at its last search, kept in memory by `~/shared/list-return`.

Browser tests drive it with `e2e/support/bill.ts` (`openPay`, `typePayment`, `payBill`, `seeBill`, `summary`); `e2e/cuenta-cobrar.spec.ts` holds, drops and loses requests to cover each outcome.

## Cuenta: its corrections

Removing a Line, removing a Payment and voiding the Bill (spec §5.7) are never one tap from the Bill. **Quitar** on a Line, **Quitar pago** on a Payment and **Cancelar esta cuenta** each open a step of the same screen (`?paso=quitar-linea&id=…`, `?paso=quitar-pago&id=…`, `?paso=cancelar-cuenta`). The step shows the Bill and the record, says what will happen, asks for the reason when one is owed, and has one action named by its effect: "Quitar 2 × Agua mineral". The step is the confirmation; no dialog asks again.

- **What is offered and what it says** is `correctionPlan(bill, target, isAdmin)` in `~/shared/correction`, tested in `tests/correction.test.ts`. `null` means this User is not offered it, and the address of such a step shows the Bill. A Line whose removal would leave the total below the Payments is offered to an Admin and `blocked`: the step says why and what to do first, and has no action. Stock is said only to an Admin, and only for a Line that moved it (`movedStock`, from `getBill`). The plan is a courtesy of the screen; the operations in `~/backend/corrections` decide again.
- **The state** is one reducer, `correctionAfter`: `editing`, `recording`, `unknown`, `confirmed`, `gone`, as a Payment's. The reason is kept with the record it was typed for, so a refusal or a step left and reopened does not lose it.
- **A correction is sent as a snapshot** with `sendForRecord` to `/cuentas/:billId/corregir` (`app/routes/resources/record-correction.ts`), which answers JSON: `{ correction }` with the Bill's total and what it owes, or a 4xx with `{ error }`. The page's own action takes no correction.
- **It carries no submission key and needs none.** Every correction moves the Bill's revision and a record is corrected once, so the same snapshot sent again is refused as stale and writes nothing. The route then asks `recordedCorrection` whether that record already carries this User's own correction with the reason that was sent, and answers with it: a retry after a lost answer says "Producto quitado", not "the Bill changed".
- **Nothing is read after a correction** until the User asks. A Worker whose removal left the Bill without Lines sees the result and Cuentas abiertas, never the Bill.
- **A refusal that says the Bill changed** reads the Bill again. The step stays, with the reason, while the record can still be corrected; when it cannot, the Bill itself says the refusal.
- A Line and a Payment that were removed stay in their lists, struck through, with who removed them, when and why. A Voided Bill offers no correction and no way to undo it.

Browser tests drive them with `removeLine`, `removePayment`, `voidBill` and `openCorrection` from `e2e/support/bill.ts`; `e2e/corrections.spec.ts` holds, drops and loses requests to cover each outcome.

**Historial** (`app/routes/historial.tsx`) shows each of them, and each Adjustment, as what was done, the record it was done to as it was made (who added the Line or received the Payment, and when), who did it, when and why. `listHistory` reads the original record in the same statement as the correction.

## One submission per form

`~/backend/submissions.ts` is how an operation records one submission per key and content. Five operations use it: `recordSelection`, `takePayment`, `takeCustomerPayment`, `recordAdjustment` and `recordCount`, each with an optional `submissionKey` in its input.

```ts
const submission = yield* submissionOf("payment", user.id, input.submissionKey, [
  input.billId, input.expectedRevision, input.amount ?? null, input.method,
]);
const earlier = yield* recordedAnswer(PaymentAnswer, submission);
if (earlier) return earlier; // a repeat: answered as the first, before any rule is checked

const [recorded] = yield* db.batch([
  ...paymentStatements(payment, both(rules, notYetRecorded(submission))),
  submissionStatement(submission, { at, answer: json(answer), wrote: paymentWasWritten }),
]);
if (recorded.changes === 0) {
  const meanwhile = yield* recordedAnswer(PaymentAnswer, submission);
  if (meanwhile) return meanwhile; // the other of two requests that arrived together
  // ...otherwise a rule refused it
}
```

Cuenta's Payment and Abonar, like Vender's sale, make their key in the browser at the tap; an Adjustment and a Count still carry the key their page was rendered with.

The key is a row of `submissions`, written last in the batch of what the form records, with the operation's answer as JSON and the digest of what the form carried (`sha256Hex` of the operation's fields, canonicalized in a fixed order — the fourth argument of `submissionOf`). Every other statement of the batch carries `notYetRecorded`, and the table's primary key (User, kind of form, key, digest) is the rule underneath. The repeat is looked for first because the first submission moved what the rules read: a second `takePayment` would otherwise be told the Bill changed. A refused operation writes no key, so the corrected form can be sent again. An input without a key gets one of its own and is recorded like any other. A `submissions` row is a fact about the submission, not a projection: the rebuild neither reads nor writes it.

The digest is what keeps the key from answering a form it never saw, and what lets Vender retry a sale of unknown outcome: the same key with the same content is the repeat. A document the browser restored (Chrome's bfcache holds a `no-store` page) still carries the key it was rendered with, and what is sent from it may be a changed form: the same key with different content finds no stored answer and is recorded, or refused by a rule visibly (a changed Payment against a moved Bill says the Bill changed). The same key with the same content — a double tap, a retry — is still the repeat. Rows written before migration `0032_submission_digest.sql` have an empty digest and match no content, so a form sent with one of those keys is recorded as if its key were new.

## Abonar across a Customer's Bills

A Customer's page (`app/routes/customer.tsx`) leads with who they are and what they owe, then **Abonar**, their Open Bills oldest first, their handovers, and for an Admin their past Bills and **Administrar cliente**. **Abonar** opens a step of the same screen, at `?paso=abonar`, which takes one handover across their Open Bills.

**The operation** spreads one amount over the Open Bills, oldest first, as one Payment per Bill with the same method, User, moment and `handover_reference` (spec §5.5, §8.3): `takeCustomerPayment({ customerId, amount, method, expectedRevisions })` in `~/backend/bills.ts`. The amount is never more than the Customer owes; `expectedRevisions` is one `{ billId, revision }` per Bill the screen showed. It answers `{ reference, amount, owed, shares }`, where `owed` is what the Customer still owed once it was recorded.

All of it is recorded or none of it: the batch is two multi-row statements (`handoverStatements` in `~/backend/payments.ts`) under one `Condition` — a JSON array of `[billId, paymentId, amount]` read with `json_each`, and a guard that the Customer's Open Bills that still owe are exactly the submitted ones at the submitted revisions. A Bill that changed since the screen read it makes every statement refuse and the User is told the Bills changed (`CustomerBillsChanged`); a retired Customer is still collected. The page groups the Payments that share a reference into one event (`listCustomerHandovers`), and `listCustomerOpenBills` gives its Open Bills and what they owe.

**The screen** takes it as Cuenta takes a Payment:

- **The state** is one reducer, `customerPaymentAfter` in `~/shared/customer-payment`, tested in `tests/customer-payment.test.ts`: `editing`, `recording`, `unknown`, `confirmed`. There is no `gone`: every User may open every Customer.
- **A handover is sent as a snapshot**: `customerPaymentSnapshot` freezes the method, the amount the action said, every Open Bill with its revision and a new submission key at the tap. It goes with `sendForRecord` to `/clientes/:customerId/abonar` (`app/routes/resources/record-handover.ts`), which answers JSON: `{ handover: { amount, bills, owed } }`, or a 4xx with `{ error }`. An unknown outcome is retried as the very same snapshot. The page's own action takes no Abonar.
- **A refusal that says the Bills changed** carries `changed`: the screen reads the Customer again and keeps the handover as it was typed, now checked against what is owed today. When nothing is owed any more the step has nothing to do, and the Customer's page says the refusal.
- **Nothing is read after a handover** until the User asks: the result stays, with **Ver cliente** and, while something is still owed, **Registrar otro abono**. Part in cash and part by transfer are two handovers, one after the other, and each starts as cash for what is left.
- **A handover on its way or of unknown outcome** is guarded by `useLeaveGuard` and `ConfirmDialog`. `~/components/recording` holds what this screen shares with Cuenta's Payment and corrections: `Pending`, `SentRows`, `Change`, `useLeaveGuard` and `useReadAgainSince`. Each keeps its own reducer.
- **The ways on**: a row of Open Bills (and of an Admin's past Bills) opens its Cuenta, whose way back is **Cliente**; the Customer's own way back is **Clientes** at its last search, back in history when the list is the entry behind.

**Administrar cliente** is still two forms of the page: the name and the note, and a fetcher that retires or restores at once and says what each does before it is done.

Browser tests drive it with `e2e/support/customer.ts` (`openAbonar`, `abonar`, `seeCustomer`, `owed`, `openBills`, `handovers`); `e2e/abonar.spec.ts` holds, drops and loses requests to cover each outcome. Through the Worker a test sends one with `recordHandover` from `tests/support/sales.ts`.

## Correcting a Bill

Removing a Line or a Payment and voiding a Bill are spec §5.7, in `~/backend/corrections.ts`. Each is one batch: the fact (`line_removals`, `payment_removals`, `bill_voids`), the Bill's projections, and Stock. Only the fact's `INSERT ... SELECT` carries the rules (the Bill's revision included); the other statements join the fact by its id, so a refused correction writes nothing at all. The operation classifies a refusal again from the rows, and `correctionMessages` in `~/shared/correction-messages.ts` holds the Spanish for each tag. How the screen offers, sends and reports them is [Cuenta: its corrections](#cuenta-its-corrections).

A Worker may remove a Line while the Bill has no Payment, which is `paid = 0`; with a Payment only an Admin may, with a reason. Removing a Payment lowers `paid`, so "has a Payment" stays meaningful for ticket 10, and a Bill whose total would fall below `paid` refuses the removal. Stock comes back from the Line's own `moved_stock` fact, not from the Item's flag today, once per Line: a Line already removed is not returned again when its Bill is Voided, and rebuilding Stock from the facts (ticket 19) uses the same rule. A Voided Bill keeps its Lines, Payments and totals on record and refuses every later correction.

## Paged lists

Every list that grows with time shows one page and a **Cargar más** control
(spec §2.4, §3.4): Cuentas abiertas, Cuentas, a Customer's past Bills,
Historial, Diferencias and the Open Bills with no Customer on Por cobrar. What
the catalog bounds is not paged: the Items on Vender, Inventario and Conteo,
and the Customers' totals on Por cobrar.

**The read** pages by cursor, never by offset. A `Cursor` (`~/shared/cursor.ts`)
is the last row of a page as its place in the list's order: an instant and a
tie-breaker. The operation takes the cursor, reads one row past the page and
answers `next`, the cursor of the page after it, or null:

```ts
const first = yield* listOpenBills("familia");        // { bills, next }
const second = yield* listOpenBills("familia", first.next);
```

Because a page is "what follows this row", a row added or removed between two
pages neither repeats nor skips one. Each read seeks to the cursor in an index
and stops after its page, so any page costs what the first did:

- Bills in `opened_at DESC, rowid DESC`: one arm per state on `bills_by_state`
  (or `bills_by_day_state` when a Day is asked), each limited to the page,
  merged. Cuentas abiertas searches by Customer inside the arms, so the search
  is over every Open Bill, not over the page.
- One Customer's Bills in `day DESC, opened_at DESC, rowid DESC` on
  `bills_by_customer_day`; the keyset is a row value over those columns.
- Historial over its six fact tables, Counts on `counts_by_time`, the id
  breaking ties.

`listBills` and `listCustomerPastBills` are Admin only twice over: the routes
refuse a Worker with `requireAdminUser` before reading anything, and the
operations refuse one again with `requireAdmin`.

**The route** reads the cursor from the URL with `cursorOf(request.url)` — the
parameter is `desde`, and an unreadable one is the first page — and answers
`next` as text with `nextText`. The same loader serves the first page and
every page after it.

**The screen** uses `usePagedList` and `LoadMore` from
`~/components/paged-list`:

```tsx
const pageOf = (data: Data) => ({ rows: data.entries, next: data.next });
const hrefFor = (cursor: string) => `/historial?${CURSOR_PARAM}=${encodeURIComponent(cursor)}`;

const { rows, more } = usePagedList({ id: "historial", data: loaderData, pageOf, hrefFor });
// ...render `rows`...
<LoadMore more={more} />
```

`hrefFor` keeps the list's filters. The control is a link to the next page,
which is all it is without JavaScript; with it, the link fetches that URL with
a fetcher and appends the rows, and does so by itself when it scrolls into
view. It says "Cargando…" and "No hay más." in a status region. New loader
data starts the list over. Coming back to a list shows what it had loaded at
once, so the scroll position is restored, and fetches those pages again behind
it; the rows are remembered in memory only, per history entry.

Tests: the row budgets are in `tests/cuentas.test.ts`, `tests/counts.test.ts`,
`tests/owed.test.ts` and `tests/history-paging.test.ts`, with the counting D1
from `tests/support/d1.ts`; `tests/paged-lists.test.ts` walks every list
through the Worker by its link (`nextHref` in `tests/support/pages.ts`);
`e2e/load-more.spec.ts` drives the control in a browser. A browser test that
clicks **Cargar más** races the scroll loading; scroll the control into view
instead, or switch scroll loading off as that spec does.

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
- `tests/support/auth.ts` has the Users: `seedUser(role, name?)` adds one inside a `runTest` program and `as(user)` runs an operation as them. For the whole Worker, `signedIn(role, name?)` gives a new User with a session and a `fetch(path, init?)` that sends its cookie; `appFetch(path, init?)` is the same request signed out. Both leave redirects unfollowed and set the app's `Origin` on non-GET requests. A document POST answers 302: `landing(who, response)` asserts that and requests the page it lands on, carrying the cookie the redirect set, which is where the message is. A form the browser's router sent answers 200 with the notice in the action's own data; `tests/notice.test.ts` covers both paths.
- `tests/support/catalog.ts` has the catalog: `seedCategory(name?, by?)` and `seedItem({ name?, price?, categoryId?, stockTracked?, minimum?, startingStock?, by? })`, both through the real operations, with a default for everything. `by` is the Admin who adds it; without it a new Admin is added.
- `tests/support/customers.ts` has the Customers: `seedCustomer(name, { by?, note?, retired? })` inside a `runTest` program, and `savedCustomer(...)`, the same as a promise, for tests that go through the Worker. In `e2e/fixtures.ts` it is the `addCustomer(name, { by, note?, retired? })` fixture.
- A rule about the whole table (the last active Admin) needs a file whose tests each start from an empty database: `reset()` and `applyD1Migrations` from `cloudflare:test` in a `beforeEach`, as in `tests/last-admin.test.ts`.
- The Worker reads the real clock, so a test that goes through it cannot move time. Rules about time are tested on operations with `runTest`.
- Browser tests live in `e2e/*.spec.ts` and import `test` and `expect` from `./fixtures`, which serves the built Worker over local HTTPS and gives every test an empty migrated D1. Its `signInAs(role, name?)` fixture adds a User and signs the test's browser in without going through Entrar; `addUser` and `issueCode` are there for tests about signing in. `addCategory(name?)` and `addItem({ name?, price?, category?, stockTracked?, minimum?, stock? })` seed the catalog by writing rows directly. `query(sql, params?)` reads rows from the Worker's D1, for what no screen shows yet. `holdSubmissions(page)` from `e2e/support/held.ts` holds every form the page sends until the test releases it, to look at the screen before the server has answered. A sale on Vender is `leaveOpen(page, { items })` or `pay(page, { items })` from `e2e/support/sell.ts`, which answer the Bill's id.
