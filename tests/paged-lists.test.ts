import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { recordCount } from "~/backend/counts";
import { Db } from "~/backend/db";
import { recordAdjustment } from "~/backend/inventory";

import { as, signedIn, type SignedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { savedCustomer } from "./support/customers";
import { advanceClock, runTest, setClock } from "./support/effect";
import { nextHref } from "./support/pages";

// Every list that grows with time, through the Worker (spec §2.4, §3.4): the
// first load renders one page whatever the database holds, and the page's
// **Cargar más** link — what the control is without JavaScript, and the URL
// its fetcher loads with it — walks the rest without repeating or skipping a
// row. Each test starts from an empty database: the lists are about all of it.

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

/** `count` Bills, opened one millisecond apart from `at`, oldest first. */
const seedBills = (
  prefix: string,
  count: number,
  by: SignedIn["user"],
  values: { at: number; customerId?: string | null; state?: "open" | "paid"; day?: string },
) =>
  runTest(
    Effect.gen(function* () {
      const db = yield* Db;
      const paid = values.state === "paid" ? 100 : 0;
      yield* db.run(
        `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < ?)
         INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
         SELECT ? || x, ?, ?, ? + x, ?, 100, ?, ?, 0 FROM n`,
        count,
        prefix,
        values.day ?? "2026-09-30",
        by.id,
        values.at,
        values.customerId ?? null,
        paid,
        values.state ?? "open",
      );
    }),
  );

const ids = (html: string, attribute: string) =>
  [...html.matchAll(new RegExp(`${attribute}="([^"]+)"`, "g"))].map((match) => match[1]!);

/**
 * Follows **Cargar más** from `path` to the last page, giving the rows of
 * each page. A page without the link is the last one.
 */
async function walk(who: SignedIn, path: string, attribute: string) {
  const pages: Array<Array<string>> = [];
  let href: string | null = path;
  while (href !== null) {
    const response = await who.fetch(href);
    expect(response.status).toBe(200);
    const html = await response.text();
    pages.push(ids(html, attribute));
    href = nextHref(html);
    if (href !== null) expect(html).toContain("Cargar más");
    expect(pages.length).toBeLessThan(20);
  }
  return pages;
}

const numbered = (prefix: string, from: number, to: number) =>
  Array.from({ length: Math.abs(to - from) + 1 }, (_, n) => `${prefix}${from + (to >= from ? n : -n)}`);

describe("Cuentas abiertas", () => {
  it("renders 50 Open Bills of 120 and walks the rest, newest first", async () => {
    const beto = await signedIn("worker", "Beto");
    await seedBills("abierta-", 120, beto.user, { at: 1000 });

    const pages = await walk(beto, "/cuentas-abiertas", "data-bill-id");

    expect(pages.map((page) => page.length)).toEqual([50, 50, 20]);
    expect(pages.flat()).toEqual(numbered("abierta-", 120, 1));
  });

  it("finds by Customer a Bill that is not on the first page, and keeps the search on the next page", async () => {
    const beto = await signedIn("worker", "Beto");
    const ruiz = await savedCustomer("Familia Lejana", { by: beto.user });
    await seedBills("de-ruiz-", 60, beto.user, { at: 100, customerId: ruiz.id });
    await seedBills("de-nadie-", 70, beto.user, { at: 5000 });

    const first = await (await beto.fetch("/cuentas-abiertas")).text();
    expect(ids(first, "data-bill-id")).toEqual(numbered("de-nadie-", 70, 21));

    const pages = await walk(beto, "/cuentas-abiertas?q=familia%20le", "data-bill-id");
    expect(pages.map((page) => page.length)).toEqual([50, 10]);
    expect(pages.flat()).toEqual(numbered("de-ruiz-", 60, 1));
  });
});

describe("Cuentas", () => {
  it("renders 50 Bills of 130 and walks the rest, keeping the filters", async () => {
    const ana = await signedIn("admin", "Ana");
    await seedBills("pagada-", 130, ana.user, { at: 1000, state: "paid" });
    await seedBills("abierta-", 5, ana.user, { at: 9000 });

    const all = await walk(ana, "/cuentas", "data-bill-id");
    expect(all.map((page) => page.length)).toEqual([50, 50, 35]);
    expect(all.flat()).toEqual([...numbered("abierta-", 5, 1), ...numbered("pagada-", 130, 1)]);

    const paid = await walk(ana, "/cuentas?estado=paid&dia=2026-09-30", "data-bill-id");
    expect(paid.map((page) => page.length)).toEqual([50, 50, 30]);
    expect(paid.flat()).toEqual(numbered("pagada-", 130, 1));
  });
});

describe("a Customer's past Bills", () => {
  it("renders 50 of 70 and walks the rest", async () => {
    const ana = await signedIn("admin", "Ana");
    const ruiz = await savedCustomer("Familia de muchas pasadas", { by: ana.user });
    await seedBills("pasada-", 70, ana.user, { at: 1000, customerId: ruiz.id, state: "paid" });

    const pages = await walk(ana, `/clientes/${ruiz.id}`, "data-past-bill-id");

    expect(pages.map((page) => page.length)).toEqual([50, 20]);
    expect(pages.flat()).toEqual(numbered("pasada-", 70, 1));
  });
});

describe("Por cobrar", () => {
  it("renders 50 Open Bills with no Customer of 60, oldest first, with the whole Owed on every page", async () => {
    const ana = await signedIn("admin", "Ana");
    await seedBills("suelta-", 60, ana.user, { at: 1000 });

    const first = await (await ana.fetch("/por-cobrar")).text();
    expect(first).toContain("$60.00");
    const pages = await walk(ana, "/por-cobrar", "data-owed-bill-id");

    expect(pages.map((page) => page.length)).toEqual([50, 10]);
    expect(pages.flat()).toEqual(numbered("suelta-", 1, 60));
  });
});

describe("Historial", () => {
  it("renders 50 entries of 60 and walks the rest", async () => {
    const ana = await signedIn("admin", "Ana");
    const recorded = await runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const item = yield* seedItem({ name: "Paginado del historial", by: ana.user });
        const made: Array<string> = [];
        for (let n = 0; n < 60; n++) {
          yield* advanceClock("1 minute");
          made.push((yield* recordAdjustment({ itemId: item.id, reason: "waste", units: 1 }).pipe(as(ana.user))).id);
        }
        return made.reverse();
      }),
    );

    const pages = await walk(ana, "/historial", "data-history-id");

    expect(pages.map((page) => page.length)).toEqual([50, 10]);
    expect(pages.flat()).toEqual(recorded);
  });
});

describe("Diferencias", () => {
  it("renders a few Counts of many and walks the rest", async () => {
    const ana = await signedIn("admin", "Ana");
    const recorded = await runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const item = yield* seedItem({ name: "Paginado de diferencias", startingStock: 1, by: ana.user });
        const made: Array<string> = [];
        for (let n = 0; n < 8; n++) {
          yield* advanceClock("1 minute");
          made.push((yield* recordCount({ lines: [{ itemId: item.id, found: n }] }).pipe(as(ana.user))).id);
        }
        return made.reverse();
      }),
    );

    const pages = await walk(ana, "/diferencias", "data-count-id");

    expect(pages.map((page) => page.length)).toEqual([3, 3, 2]);
    expect(pages.flat()).toEqual(recorded);
  });
});
