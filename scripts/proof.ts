import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { BUSIEST_DAY, PROOF_ITEMS, THIRTY_BILL_CUSTOMER_ID } from "../app/backend/seed.ts";
import { SESSION_COOKIE } from "../app/shared/secret.ts";

/**
 * The §10.7 proof runner (ticket 21): given the URL of a disposable
 * deployment that holds the seed (ticket 21's `npm run seed -- --production`)
 * and a session, it makes every request of the release gate at least twenty
 * times and writes the times down.
 *
 *     npm run proof -- --url=https://gamo-cafe-proof.<account>.workers.dev --code="ABCD 2345"
 *     npm run proof -- --url=... --cookie="__Host-gamo-session=..."
 *     npm run proof -- --busy-day --url=... --code="ABCD 2345"
 *
 * The CPU time Cloudflare reports is not visible from outside the account:
 * the results file carries when each request ran, and the runbook in the
 * README says where to read the median CPU time for that window, plus the
 * D1 rows read and written for the simulated busy Day.
 *
 * A one-time code comes from
 * `npm run sign-in-code -- --production --user "Ana"`.
 */

const usage = `Usage:
  npm run proof -- --url=<url> (--code="ABCD 2345" | --cookie="__Host-gamo-session=...")
  npm run proof -- --busy-day --url=<url> (--code=... | --cookie=...)

Options:
  --url         the deployed app (required)
  --code        a one-time sign-in code; the runner signs in and keeps the session
  --cookie      an existing session cookie instead
  --runs        runs of each §10.7 request (default 21, at least 20)
  --out         the results file (proof-results.json, or proof-busy-day.json)
  --busy-day    simulate a busy Day's traffic instead of the request loop
  --day         the Day for the Día request (default ${BUSIEST_DAY})
  --customer    the Customer for Abonar (default ${THIRTY_BILL_CUSTOMER_ID})`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values } = (() => {
  try {
    return parseArgs({
      options: {
        url: { type: "string" },
        code: { type: "string" },
        cookie: { type: "string" },
        runs: { type: "string", default: "21" },
        out: { type: "string" },
        "busy-day": { type: "boolean", default: false },
        day: { type: "string", default: BUSIEST_DAY },
        customer: { type: "string", default: THIRTY_BILL_CUSTOMER_ID },
      },
    });
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : error}\n\n${usage}`);
  }
})();

if (!values.url) fail(usage);
const url = (() => {
  try {
    return new URL(values.url!);
  } catch {
    return fail(`--url is not a URL: ${values.url}`);
  }
})();
if (!values.code && !values.cookie) fail(`--code or --cookie is required.\n\n${usage}`);

const runs = Number(values.runs);
if (!values["busy-day"] && (!Number.isSafeInteger(runs) || runs < 20)) {
  fail(`--runs must be a whole number of at least 20: the proof asks for 20 runs of each request.`);
}

const out = values.out ?? (values["busy-day"] ? "proof-busy-day.json" : "proof-results.json");

interface Options {
  readonly url: URL;
  readonly cookie: string;
  readonly day: string;
  readonly customer: string;
}

/** One request of the proof, and how it is made. */
interface ProofRequest {
  readonly name: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  /** The statuses that mean the request did its work. */
  readonly expected: ReadonlyArray<number>;
  /** The `Location` the request must answer with, when it redirects. */
  readonly location?: string;
  run(): Promise<Run>;
}

interface Run {
  readonly status: number;
  readonly ms: number;
  /** The page read before a submission, when the request needs one. */
  readonly prepareMs?: number;
  readonly location?: string | null;
}

/** Signs in with a one-time code and keeps the session cookie. */
async function signIn(code: string): Promise<string> {
  const response = await fetch(new URL("/entrar", url), {
    method: "POST",
    redirect: "manual",
    headers: { Origin: url.origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code }).toString(),
  });
  await response.arrayBuffer();
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0]!)
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) fail(`Signing in was refused (status ${response.status}). Ask for a new code.`);
  return cookie;
}

const cookie = values.code ? await signIn(values.code) : values.cookie!.split(";")[0]!;
const session = cookie.startsWith(`${SESSION_COOKIE}=`) ? cookie : `${SESSION_COOKIE}=${cookie}`;
const options: Options = { url, cookie: session, day: values.day!, customer: values.customer! };

/** A live session answers the Sell screen; a dead one is a redirect to Entrar. */
async function checkSession() {
  const response = await fetch(new URL("/", options.url), {
    headers: { Cookie: options.cookie },
    redirect: "manual",
  });
  await response.arrayBuffer();
  if (response.status !== 200) {
    fail(`The session is not valid for ${url.href}: GET / answered ${response.status}.
Issue a code with \`npm run sign-in-code -- --production --user "Ana"\` and pass it as --code.`);
  }
}

await checkSession();

/** One request, timed; redirects are not followed. */
async function send(options: Options, method: "GET" | "POST", path: string, form?: FormData): Promise<Run> {
  const headers = new Headers({ Cookie: options.cookie });
  if (method !== "GET") headers.set("Origin", options.url.origin);
  const started = performance.now();
  const response = await fetch(new URL(path, options.url), {
    method,
    headers,
    body: form,
    redirect: "manual",
  });
  await response.arrayBuffer();
  return {
    status: response.status,
    ms: performance.now() - started,
    location: response.headers.get("location"),
  };
}

/** **Cobrar** on Vender: a selection of `items` Items paid on the spot. */
function sale(options: Options, items: number, name: string): ProofRequest {
  const form = new FormData();
  form.set("intent", "cobrar");
  form.set(
    "selection",
    JSON.stringify(PROOF_ITEMS.slice(0, items).map((itemId) => ({ itemId, quantity: 1 }))),
  );
  form.set("customerId", "");
  form.set("note", "");
  form.set("billId", "");
  form.set("method", "transfer");
  form.set("amount", "");
  return {
    name,
    method: "POST",
    path: "/?index",
    expected: [200],
    run: () => send(options, "POST", "/?index", form),
  };
}

/**
 * **Abonar** on a Customer's page. The page is read first, as a browser does,
 * and its `bill` fields are sent back with a one-centavo amount, so the 30
 * Open Bills stay Open across every run. Only the submission is timed.
 */
function abono(options: Options): ProofRequest {
  const path = `/clientes/${options.customer}`;
  return {
    name: `Pay a Customer with 30 Open Bills (${options.customer})`,
    method: "POST",
    path,
    expected: [200],
    run: async () => {
      const prepareStarted = performance.now();
      const page = await fetch(new URL(path, options.url), {
        headers: { Cookie: options.cookie },
        redirect: "manual",
      });
      const html = await page.text();
      const prepareMs = performance.now() - prepareStarted;
      const bills = [...html.matchAll(/name="bill" value="([^"]+)"/g)].map((match) => match[1]!);
      if (bills.length === 0) {
        fail(`The Customer page ${path} shows no Open Bills. Is ${options.customer} in this database?`);
      }
      const form = new FormData();
      form.set("intent", "abonar");
      form.set("method", "cash");
      form.set("amount", "0.01");
      for (const bill of bills) form.append("bill", bill);
      return { ...(await send(options, "POST", path, form)), prepareMs };
    },
  };
}

/** Confirming a Count of every Item; the action lands on Diferencias. */
function countRequest(options: Options): ProofRequest {
  const form = new FormData();
  form.set("intent", "confirm");
  form.set("note", "");
  for (const itemId of PROOF_ITEMS) form.set(`units.${itemId}`, "4");
  return {
    name: "A Count of every Item",
    method: "POST",
    path: "/inventario/conteo",
    expected: [302],
    location: "/diferencias",
    run: () => send(options, "POST", "/inventario/conteo", form),
  };
}

/** A Restock Adjustment, part of a busy Day's traffic. */
function adjustment(options: Options): ProofRequest {
  const form = new FormData();
  form.set("intent", "record-adjustment");
  form.set("itemId", PROOF_ITEMS[0]!);
  form.set("reason", "restock");
  form.set("units", "5");
  form.set("note", "");
  return {
    name: "Record an Adjustment",
    method: "POST",
    path: "/inventario",
    expected: [200],
    run: () => send(options, "POST", "/inventario", form),
  };
}

/** The nine requests of §10.7. */
const proofRequests = (options: Options): ReadonlyArray<ProofRequest> => [
  { name: "Vender (the Sell screen)", method: "GET", path: "/", expected: [200], run: () => send(options, "GET", "/") },
  sale(options, 10, "Record a ten-Item selection with Payment"),
  {
    name: "Cuentas abiertas with 200 Open Bills",
    method: "GET",
    path: "/cuentas-abiertas",
    expected: [200],
    run: () => send(options, "GET", "/cuentas-abiertas"),
  },
  abono(options),
  {
    name: "Día for the busiest Day",
    method: "GET",
    path: `/dia?desde=${options.day}&hasta=${options.day}`,
    expected: [200],
    run: () => send(options, "GET", `/dia?desde=${options.day}&hasta=${options.day}`),
  },
  { name: "A page of Cuentas", method: "GET", path: "/cuentas", expected: [200], run: () => send(options, "GET", "/cuentas") },
  {
    name: "Inventario",
    method: "GET",
    path: "/inventario",
    expected: [200],
    run: () => send(options, "GET", "/inventario"),
  },
  countRequest(options),
  {
    name: "A page of Historial",
    method: "GET",
    path: "/historial",
    expected: [200],
    run: () => send(options, "GET", "/historial"),
  },
];

const ok = (request: ProofRequest, run: Run) =>
  request.expected.includes(run.status) && (request.location === undefined || run.location === request.location);

const median = (values: ReadonlyArray<number>) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

interface RequestResult {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly expected: ReadonlyArray<number>;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly runs: ReadonlyArray<Run>;
  readonly passed: number;
  readonly failed: number;
  readonly medianMs: number;
  readonly maxMs: number;
}

/** Runs one request `times` times and records every run. */
async function exercise(request: ProofRequest, times: number): Promise<RequestResult> {
  const startedAt = new Date().toISOString();
  const recorded: Array<Run> = [];
  for (let at = 0; at < times; at++) {
    let run: Run;
    try {
      run = await request.run();
    } catch (error) {
      throw new Error(`${request.name} failed: ${error instanceof Error ? error.message : error}`, { cause: error });
    }
    recorded.push(run);
    process.stdout.write(ok(request, run) ? "." : "x");
  }
  process.stdout.write("\n");

  const durations = recorded.map((run) => run.ms);
  const passed = recorded.filter((run) => ok(request, run)).length;
  return {
    name: request.name,
    method: request.method,
    path: request.path,
    expected: request.expected,
    startedAt,
    finishedAt: new Date().toISOString(),
    runs: recorded,
    passed,
    failed: recorded.length - passed,
    medianMs: median(durations),
    maxMs: Math.max(...durations),
  };
}

const startedAt = new Date().toISOString();
const results: Array<RequestResult> = [];

if (values["busy-day"]) {
  // A busy Day, the shape of the seed's busiest Day: 55 sales with their
  // Payments, 10 handovers across the Customer's Bills, 3 Adjustments and a
  // Count of every Item.
  const plan: ReadonlyArray<{ request: ProofRequest; times: number }> = [
    { request: sale(options, 2, "Sale of two Items, paid on the spot"), times: 55 },
    { request: abono(options), times: 10 },
    { request: adjustment(options), times: 3 },
    { request: countRequest(options), times: 1 },
  ];
  console.log(`Simulating a busy Day against ${url.href}:`);
  for (const { request, times } of plan) {
    console.log(`${request.name} × ${times}`);
    results.push(await exercise(request, times));
  }
} else {
  console.log(`The §10.7 requests, ${runs} runs each, against ${url.href}:`);
  for (const request of proofRequests(options)) {
    console.log(`${request.name}`);
    results.push(await exercise(request, runs));
  }
}

const finishedAt = new Date().toISOString();
const requests = results.map((result) => ({ ...result, ok: result.failed === 0 }));
const totals = {
  requests: results.reduce((sum, result) => sum + result.runs.length, 0),
  failed: results.reduce((sum, result) => sum + result.failed, 0),
  seconds: results.reduce((sum, result) => sum + result.runs.reduce((all, run) => all + run.ms, 0), 0) / 1000,
};

writeFileSync(
  out,
  `${JSON.stringify(
    {
      kind: values["busy-day"] ? "busy-day" : "requests",
      url: url.href,
      signedIn: values.code ? "code" : "cookie",
      startedAt,
      finishedAt,
      runs: values["busy-day"] ? null : runs,
      day: options.day,
      customer: options.customer,
      items: PROOF_ITEMS.length,
      ...totals,
      requests,
    },
    null,
    2,
  )}\n`,
);

console.log(`
${totals.requests} requests in ${totals.seconds.toFixed(1)} s, ${totals.failed} failed. Written to ${out}.`);

for (const result of requests) {
  const median = result.medianMs.toFixed(1).padStart(8);
  const failures = result.failed > 0 ? `  (${result.failed} failed)` : "";
  console.log(`  ${result.passed}/${result.runs.length}  median ${median} ms  ${result.name}${failures}`);
}

if (values["busy-day"]) {
  console.log(`
Read what Cloudflare reports for the window ${startedAt} .. ${finishedAt}:

  CPU time:     Dashboard → Workers & Pages → the Worker → Metrics → CPU Time per execution
  Rows read:    Dashboard → D1 → the database → Metrics → Row Metrics (Rows read, Rows written)
                or the GraphQL Analytics API: d1AnalyticsAdaptiveGroups, sum { rowsRead rowsWritten }

A busy Day's traffic must stay under a fifth of D1 Free's daily limits: 1,000,000 rows read
and 20,000 rows written. Take the before and after readings of the same day's numbers the
moment you start and finish this run, and compare their difference.`);
} else {
  console.log(`
Read what Cloudflare reports for the window ${startedAt} .. ${finishedAt}:

  CPU time per request: Dashboard → Workers & Pages → the Worker → Metrics → CPU Time per
  execution, filtered to that window; the §10.7 criterion is a median under 10 ms.
  Or the GraphQL Analytics API: workersInvocationsAdaptive { quantiles { cpuTimeP50 } }.
  D1 statements and rows read per request are proven locally by
  \`npm run test -- tests/proof-budget.test.ts\`; Cloudflare does not report them per request.`);
}

if (totals.failed > 0) process.exitCode = 1;
