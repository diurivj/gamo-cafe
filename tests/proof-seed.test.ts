import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { verifyProjectionsSql } from "~/backend/rebuild";
import {
  BUSIEST_DAY,
  PROOF_ITEMS,
  SEED_FROM,
  SEED_TO,
  seedStatements,
  seedStats,
  THIRTY_BILL_CUSTOMER_ID,
} from "~/backend/seed";

import { countingD1 } from "./support/d1";

// The synthetic year behind the §10.7 request budgets (ticket 21): its shape
// and its consistency (the ticket 19 gate). Budgets are
// measured in tests/proof-budget.test.ts; this file is what the seed itself
// has to be.

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

/** Every statement of a window as one D1 batch at a time. */
async function load(statements: ReadonlyArray<string>, d1: D1Database = env.DB) {
  for (let at = 0; at < statements.length; at += 50) {
    await d1.batch(statements.slice(at, at + 50).map((sql) => d1.prepare(sql)));
  }
}

/** One number, from a one-row, one-column query. */
async function count(sql: string, ...params: ReadonlyArray<string | number>): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...params).first<{ n: number }>();
  return row?.n ?? 0;
}

const year = () => seedStatements();

describe("the seed's SQL", () => {
  it("loads a year with the entities, the history and the 200 Open Bills the budget test needs", async () => {
    await load(year());

    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(4);
    expect(await count("SELECT COUNT(*) AS n FROM categories")).toBe(8);
    expect(await count("SELECT COUNT(*) AS n FROM items WHERE retired_at IS NULL")).toBe(60);
    expect(await count("SELECT COUNT(*) AS n FROM customers")).toBeGreaterThanOrEqual(30);

    // A year of Bills with Lines and Payments behind them.
    expect(await count("SELECT COUNT(*) AS n FROM bills")).toBeGreaterThan(2_000);
    expect(await count("SELECT COUNT(*) AS n FROM lines")).toBeGreaterThan(4_000);
    expect(await count("SELECT COUNT(*) AS n FROM payments")).toBeGreaterThan(2_000);

    // Corrections of every kind, and Stock records, as §10.7 lists them.
    for (const table of [
      "line_removals",
      "payment_removals",
      "bill_voids",
      "bill_edits",
      "adjustments",
      "adjustment_cancellations",
      "counts",
      "count_lines",
      "stock_levels",
    ]) {
      expect(await count(`SELECT COUNT(*) AS n FROM ${table}`), table).toBeGreaterThan(0);
    }

    // Exactly 200 Open Bills, and one Customer holding 30 of them.
    expect(await count("SELECT COUNT(*) AS n FROM bills WHERE state IN ('open', 'partial')")).toBe(200);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM bills WHERE customer_id = ? AND state IN ('open', 'partial') AND total > paid",
        THIRTY_BILL_CUSTOMER_ID,
      ),
    ).toBe(30);

    // A clearly busiest Day: more Bills than any other Day of the year.
    const busiest = await env.DB.prepare(
      "SELECT day FROM bills GROUP BY day ORDER BY COUNT(*) DESC, day LIMIT 2",
    ).all<{ day: string }>();
    expect(busiest.results[0]?.day).toBe(BUSIEST_DAY);
    const [first, second] = busiest.results;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const firstCount = await count("SELECT COUNT(*) AS n FROM bills WHERE day = ?", first!.day);
    const secondCount = await count("SELECT COUNT(*) AS n FROM bills WHERE day = ?", second!.day);
    expect(firstCount).toBeGreaterThanOrEqual(secondCount * 3);
  });

  it("agrees with the projections the facts imply", async () => {
    await load(year());

    // Ticket 19's gate, the same SQL `npm run projections:verify` sends.
    const differences = await env.DB.prepare(verifyProjectionsSql).all();
    expect(differences.results).toEqual([]);
  });

  it("holds a year's worth of Bills for the catalog of 60 Items", () => {
    const stats = seedStats();

    expect(stats.rows.bills).toBeGreaterThan(2_000);
    expect(stats.rows.items).toBe(60);
  });

  it("writes a window of history that can be appended to an earlier load, entities once", () => {
    const window = { from: SEED_FROM, to: "2026-01-31" } as const;
    const appended = seedStatements({ ...window, withEntities: false });
    const full = seedStatements();
    // The append adds facts and the projection rebuild, never the entities.
    expect(appended.some((sql) => sql.includes("INSERT INTO users"))).toBe(false);
    expect(appended.length).toBeGreaterThan(0);
    expect(full.length).toBeGreaterThan(appended.length);
    expect(PROOF_ITEMS).toHaveLength(60);
    expect(PROOF_ITEMS.every((id) => id.startsWith("proof-item-"))).toBe(true);
  });
});
