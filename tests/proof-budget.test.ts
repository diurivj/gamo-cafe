import { applyD1Migrations, reset } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { Db } from "~/backend/db";
import { issueSignInCode, useSignInCode } from "~/backend/sign-in";
import {
  BUSIEST_DAY,
  PROOF_ITEMS,
  SEED_FROM,
  SEED_TO,
  seedStatements,
  THIRTY_BILL_CUSTOMER_ID,
} from "~/backend/seed";
import { SESSION_COOKIE } from "~/session.server";

import { countingD1 } from "./support/d1";

// The §10.7 budget, measured locally against the seeded year (ticket 21):
// every request of the release gate issues at most 50 D1 statements, and none
// of them reads rows in proportion to the history. The history grows from
// four months to the whole year between the two measurements; the same
// request must read the same rows either way. The six requests that only read
// (the GETs) write no row at all, the session's included (ticket 26).
//
// The requests are real HTTP requests through the Worker — the same document
// and action paths a browser uses, so a POST carries whatever re-render the
// action's answer needs. The counting D1 is swapped into the binding for one
// request at a time (`env.DB` is configurable in the Workers pool), so the
// counts are every statement the request made, session included.

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

const APP = "https://gamo.test";
const SMALL_DAYS = 120;

/** The last four months of the year: 2026-06-03 to 2026-09-30. */
const smallFrom = new Date(Date.parse(`${SEED_TO}T00:00:00Z`) - (SMALL_DAYS - 1) * 86_400_000)
  .toISOString()
  .slice(0, 10);
const olderTo = new Date(Date.parse(`${smallFrom}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

interface Counts {
  readonly statements: number;
  readonly rowsRead: number;
  readonly rowsWritten: number;
  readonly status: number;
  /** The request only reads: it is a GET. */
  readonly readOnly: boolean;
}

/** Every statement of a window as one D1 batch at a time. */
async function load(statements: ReadonlyArray<string>) {
  for (let at = 0; at < statements.length; at += 50) {
    await env.DB.batch(statements.slice(at, at + 50).map((sql) => env.DB.prepare(sql)));
  }
}

/** One number, from a one-row, one-column query. */
async function count(sql: string, ...params: ReadonlyArray<string | number>): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...params).first<{ n: number }>();
  return row?.n ?? 0;
}

/** The seeded Admin's session, on the real clock the Worker reads. */
async function proofSession(): Promise<string> {
  const { token } = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* useSignInCode(yield* issueSignInCode("proof-user-ana", null));
    }).pipe(Effect.provide(Db.layer(env.DB))),
  );
  return `${SESSION_COOKIE}=${token}`;
}

/** One request, with the counting D1 swapped into the Worker's binding. */
async function measure(request: Request): Promise<Counts> {
  const original = env.DB;
  const descriptor = Object.getOwnPropertyDescriptor(env, "DB");
  const { counter, d1 } = countingD1(original);
  Object.defineProperty(env, "DB", { value: d1, configurable: true });
  try {
    const response = await exports.default.fetch(request);
    await response.arrayBuffer();
    return {
      statements: counter.statements,
      rowsRead: counter.rowsRead,
      rowsWritten: counter.rowsWritten,
      status: response.status,
      readOnly: request.method === "GET",
    };
  } finally {
    Object.defineProperty(env, "DB", descriptor ?? { value: original, configurable: true });
  }
}

const get = (path: string, cookie: string) =>
  new Request(new URL(path, APP), { headers: { Cookie: cookie }, redirect: "manual" });

const post = (path: string, cookie: string, form: FormData) =>
  new Request(new URL(path, APP), {
    method: "POST",
    headers: { Cookie: cookie, Origin: APP },
    body: form,
    redirect: "manual",
  });

/** The ten Items and their quantities, as the Sell screen's form sends them. */
function selectionForm(): FormData {
  const form = new FormData();
  form.set("intent", "cobrar");
  form.set(
    "selection",
    JSON.stringify(PROOF_ITEMS.slice(0, 10).map((itemId) => ({ itemId, quantity: 1 }))),
  );
  form.set("customerId", "");
  form.set("note", "");
  form.set("billId", "");
  form.set("method", "transfer");
  form.set("amount", "");
  return form;
}

/** Every stock-tracked Item, as the Conteo form sends them. */
function countForm(): FormData {
  const form = new FormData();
  form.set("intent", "registrar");
  form.set("note", "");
  for (const itemId of PROOF_ITEMS) form.set(`units.${itemId}`, "4");
  return form;
}

/**
 * The nine requests of §10.7, as the browser makes them. `cap` is how many
 * rows the request may read: about its own page, whatever the year behind it
 * holds (a request that scanned a whole table would read thousands).
 */
interface RequestCase {
  readonly name: string;
  /** The status the request answers with; actions that redirect answer 302. */
  readonly status: number;
  readonly cap: number;
  /**
   * The request itself. Any reading done first — the Bills the Customer's
   * page had shown before it sent the Abonar — happens outside the measurement.
   */
  request(cookie: string): Promise<Request> | Request;
}

/** What the Customer's page sends: every Open Bill it showed, and its revision. */
async function abonarForm(customerId: string): Promise<FormData> {
  const { results: bills } = await env.DB.prepare(
    `SELECT id, revision FROM bills
     WHERE customer_id = ? AND state IN ('open', 'partial') AND total > paid
     ORDER BY opened_at, rowid`,
  )
    .bind(customerId)
    .all<{ id: string; revision: number }>();
  // The request the proof measures is this one: 30 Open Bills.
  expect(bills).toHaveLength(30);
  const form = new FormData();
  form.set("method", "cash");
  // One centavo: the 30 Bills stay Open across every run.
  form.set("amount", "0.01");
  for (const bill of bills) form.append("bill", `${bill.id}:${bill.revision}`);
  return form;
}

const REQUESTS: ReadonlyArray<RequestCase> = [
  {
    name: "Vender (the Sell screen)",
    status: 200,
    cap: 500,
    request: (cookie) => get("/", cookie),
  },
  {
    name: "Record a ten-Item selection with Payment",
    status: 200,
    cap: 2_000,
    request: (cookie) => post("/vender/registrar", cookie, selectionForm()),
  },
  {
    name: "Cuentas abiertas with 200 Open Bills",
    status: 200,
    cap: 1_500,
    request: (cookie) => get("/cuentas-abiertas", cookie),
  },
  {
    name: "Pay a Customer with 30 Open Bills",
    status: 200,
    cap: 3_000,
    request: async (cookie) =>
      post(`/clientes/${THIRTY_BILL_CUSTOMER_ID}/abonar`, cookie, await abonarForm(THIRTY_BILL_CUSTOMER_ID)),
  },
  {
    name: "Día for the busiest Day",
    status: 200,
    cap: 1_500,
    request: (cookie) => get(`/dia?desde=${BUSIEST_DAY}&hasta=${BUSIEST_DAY}`, cookie),
  },
  {
    name: "A page of Cuentas",
    status: 200,
    cap: 1_500,
    request: (cookie) => get("/cuentas", cookie),
  },
  {
    name: "Inventario",
    status: 200,
    cap: 1_000,
    request: (cookie) => get("/inventario", cookie),
  },
  {
    name: "A Count of every Item",
    status: 200,
    cap: 1_000,
    request: (cookie) => post("/inventario/conteo/registrar", cookie, countForm()),
  },
  {
    name: "A page of Historial",
    status: 200,
    cap: 3_000,
    request: (cookie) => get("/historial", cookie),
  },
];

async function measureAll(cookie: string) {
  const measured = new Map<string, Counts>();
  for (const request of REQUESTS) {
    const counted = await measure(await request.request(cookie));
    expect(counted.status, request.name).toBe(request.status);
    measured.set(request.name, counted);
  }
  return measured;
}

describe("the §10.7 budget against the seeded year", () => {
  it("keeps every request under 50 statements, reading its own rows at both history sizes, and writing none when it only reads", async () => {
    await load(seedStatements({ from: smallFrom, to: SEED_TO }));
    // The window the budget is measured against is the seed's own shape: 200
    // Open Bills, one Customer with 30 of them, the busiest Day inside it.
    expect(await count("SELECT COUNT(*) AS n FROM bills WHERE state IN ('open', 'partial')")).toBe(200);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM bills WHERE customer_id = ? AND state IN ('open', 'partial') AND total > paid",
        THIRTY_BILL_CUSTOMER_ID,
      ),
    ).toBe(30);

    const cookie = await proofSession();
    const fourMonths = await measureAll(cookie);

    // The rest of the year, older than everything already there.
    await load(seedStatements({ from: SEED_FROM, to: olderTo, withEntities: false }));
    const year = await measureAll(cookie);

    for (const request of REQUESTS) {
      const small = fourMonths.get(request.name)!;
      const large = year.get(request.name)!;
      const at = request.name;

      expect(small.statements, `${at}: statements at four months`).toBeLessThanOrEqual(50);
      expect(large.statements, `${at}: statements with a year`).toBeLessThanOrEqual(50);
      // Three times the history, the same rows: a read that grew with the
      // Bills, Lines or Payments of the other nine months would show it here.
      expect(large.rowsRead, `${at}: rows read with a year`).toBeLessThanOrEqual(small.rowsRead + 64);
      expect(large.rowsRead, `${at}: rows read against its own page`).toBeLessThan(request.cap);
      if (small.readOnly) {
        expect(small.rowsWritten, `${at}: rows written at four months`).toBe(0);
        expect(large.rowsWritten, `${at}: rows written with a year`).toBe(0);
      }
    }
    expect([...year.values()].filter((counted) => counted.readOnly)).toHaveLength(6);
  });
});
