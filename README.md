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

Production needs the real D1 id in `wrangler.jsonc` (`env.production`), which holds a placeholder. Take a database export before every production migration (spec §3.3).

## Layout

```
app/
  backend/     Effect code. Server only.
    db.ts          Db service over the D1 binding, DbError, statement()
    current-user.ts  CurrentUser service
    time.ts        now, today (the only source of "now")
    run.server.ts  run(): the one way a loader or action runs a program
    health.ts      the reference operation
  shared/      Plain functions, no Effect. Safe in the browser.
    money.ts       centavos, formatMoney, parsePesos
    day.ts         Instant, Day, dayOf, formatDay, formatTime
    id.ts          newId
  routes/      Route modules; resources/ holds routes without UI
  routes.ts    Route table
workers/app.ts   Worker entry
migrations/      Hand-written .sql, applied by Wrangler
tests/           Vitest, Workers pool
e2e/             Playwright
```

## Conventions

- **Money** is integer centavos. Add and subtract with integer `+` and `-`; turn it into text with `formatMoney` and read typed text with `parsePesos`. Never divide or multiply an amount by 100.
- **Time**: an instant is epoch milliseconds; a Day is `YYYY-MM-DD` in `America/Mexico_City`, computed when a record is written and stored with it. Backend code gets them only from `now` and `today` in `~/backend/time`, never from `Date`.
- **Ids** are opaque strings from `newId()`.
- **Facts** are inserted once and never updated or deleted. **Projections** are written only in the same `db.batch` as the fact that changes them (spec §7.1).
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
- A batch cannot branch. Put the condition in the SQL (`WHERE revision = ?`) and read `changes` afterwards to detect a stale submission.
- Every `Db` method can fail with `DbError`. Leave it alone unless the operation has something better to answer.

## Writing a route

A loader or action stays thin: read the session, parse the input, run one program with `run`, turn the result into a response. [`app/routes/resources/healthz.ts`](app/routes/resources/healthz.ts) is the reference.

```ts
import { Effect } from "effect";
import { redirect } from "react-router";

import { addNote } from "~/backend/bills";
import { CurrentUser } from "~/backend/current-user";
import { run } from "~/backend/run.server";

import type { Route } from "./+types/bill-note";

export async function action({ context, params, request }: Route.ActionArgs) {
  const form = await request.formData();
  const program = addNote(params.billId, String(form.get("note") ?? "")).pipe(
    Effect.provideService(CurrentUser, user), // from the session
  );

  return run(context, program, (error) => {
    switch (error._tag) {
      case "BillIsVoided":
        return { error: "Esta cuenta está cancelada." };
    }
  });
}
```

- `run(context, program)` resolves with the program's value.
- The third argument receives every typed error except `DbError` and returns what the route answers with, or throws a `redirect(...)`. It is required exactly when the program has such errors, and a `switch` on `error._tag` with no `default` makes the compiler report a missing case.
- `DbError` is logged and becomes a 500 for the error boundary. A bug in the program is rethrown.
- Add the route to `app/routes.ts`. Visible text is Spanish.

## Writing a test

Tests live in `tests/*.test.ts` and run inside workerd. Each test file starts with its own freshly migrated D1; tests in the same file share it, so use distinct ids.

```ts
import { Effect } from "effect";
import { expect, it } from "vitest";

import { CurrentUser } from "~/backend/current-user";
import { addNote } from "~/backend/bills";

import { advanceClock, runTest, setClock } from "./support/effect";

const ana = { id: "u-ana", name: "Ana", role: "admin" } as const;

it("refuses a note on a Voided Bill", () =>
  runTest(
    Effect.gen(function* () {
      yield* setClock("2026-10-05T23:50:00"); // Mexico City wall-clock time
      // ...arrange through other operations...
      yield* advanceClock("15 minutes"); // now it is the next Day

      const error = yield* Effect.flip(addNote("b1", "hola"));
      expect(error._tag).toBe("BillIsVoided");
    }).pipe(Effect.provideService(CurrentUser, ana)),
  ));
```

- `runTest(program)` provides `Db` over the real local D1 and a test clock. The clock starts at the Unix epoch and moves only with `setClock` and `advanceClock`.
- A typed failure rejects the test. To assert on one, turn it into a value with `Effect.flip` or `Effect.exit`.
- Test through operations and routes, not by reaching into tables. To exercise the whole Worker, `import { exports } from "cloudflare:workers"` and call `exports.default.fetch("https://gamo.test/...")`.
- Browser tests live in `e2e/*.spec.ts` and import `test` and `expect` from `./fixtures`, which serves the built Worker and gives every test an empty migrated D1.
