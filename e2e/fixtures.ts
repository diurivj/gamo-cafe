import { readFileSync } from "node:fs";

import { test as base, expect } from "@playwright/test";
import { createTestHarness, type TestHarness } from "wrangler";

import { codeForUser } from "../app/backend/command-line.ts";
import { dayOf } from "../app/shared/day.ts";
import { normalizeName } from "../app/shared/normalize-name.ts";
import { hashSecret, newSessionToken, SESSION_COOKIE } from "../app/shared/secret.ts";

export type Role = "admin" | "worker";

export interface SeededUser {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
}

export interface SeededCategory {
  readonly id: string;
  readonly name: string;
}

export interface SeededItem {
  readonly id: string;
  readonly name: string;
  /** Centavos. */
  readonly price: number;
  readonly category: SeededCategory;
}

export interface NewSeededItem {
  /** Defaults to a name no other seeded Item has. */
  readonly name?: string;
  /** Centavos. Defaults to 1000, which is $10.00. */
  readonly price?: number;
  /** Defaults to a new Category of its own. */
  readonly category?: SeededCategory;
  /** Defaults to true. */
  readonly stockTracked?: boolean;
  readonly minimum?: number;
  /** Starting Stock, recorded as a Restock by this Admin, as Productos does. */
  readonly stock?: { readonly units: number; readonly by: SeededUser };
}

type TestFixtures = {
  /** Runs around every test: migrated D1 before, storage wiped after. */
  database: void;
  /**
   * Adds a User without signing anyone in: `await addUser("worker", "Beto")`.
   * The name defaults to Ana for an Admin and Beto for a Worker.
   */
  addUser: (role: Role, name?: string) => Promise<SeededUser>;
  /**
   * Adds a User and signs this test's browser in as them, without going
   * through Entrar: `const ana = await signInAs("admin")`, then `page.goto`.
   */
  signInAs: (role: Role, name?: string) => Promise<SeededUser>;
  /** A fresh sign-in code for a User, as an Admin or the command line issues it. */
  issueCode: (user: SeededUser) => Promise<string>;
  /**
   * Adds a Category after the ones already there:
   * `const bebidas = await addCategory("Bebidas")`.
   */
  addCategory: (name?: string) => Promise<SeededCategory>;
  /**
   * Adds an active Item: `await addItem({ name: "Agua", price: 1850, category: bebidas })`.
   * Every field has a default. Its name must not be an active Item's already.
   */
  addItem: (item?: NewSeededItem) => Promise<SeededItem>;
  /**
   * Adds a Customer: `await addCustomer("Familia Ruiz", { by: beto })`. `by`
   * is the User who added them; `retired: true` adds them already retired.
   */
  addCustomer: (
    name: string,
    seed: { by: SeededUser; note?: string; retired?: boolean },
  ) => Promise<SeededCustomer>;
};

export interface SeededCustomer {
  readonly id: string;
  readonly name: string;
}

type WorkerFixtures = {
  server: TestHarness;
};

/**
 * The Wrangler config that the Cloudflare Vite plugin generated, served over
 * local TLS. The session cookie is `Secure` and `__Host-`: WebKit stores
 * neither over plain HTTP, even on localhost.
 */
function localHttpsWorkerConfig() {
  const config = JSON.parse(
    readFileSync(new URL("../build/server/wrangler.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
  const dev = (config.dev ?? {}) as Record<string, unknown>;
  return { ...config, dev: { ...dev, local_protocol: "https", upstream_protocol: "https" } };
}

/** As much of the D1 binding as the fixtures use; this project has no Workers types. */
interface Statement {
  bind(...values: ReadonlyArray<string | number | null>): Statement;
  run(): Promise<unknown>;
}
interface Database {
  prepare(sql: string): Statement;
}

/** The D1 of the Worker under test, to seed what a test starts from. */
async function database(server: TestHarness): Promise<Database> {
  return (await server.getWorker<{ DB: Database }>().getEnv()).DB;
}

const defaultNames = { admin: "Ana", worker: "Beto" } as const;

/**
 * Import `test` and `expect` from here, not from @playwright/test. Each
 * Playwright worker serves the production-shaped build (build/server, written
 * by `npm run build`) from workerd, and every test starts with an empty local
 * D1 that has all migrations applied.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  server: [
    async ({}, use) => {
      const server = createTestHarness({
        root: "./build/server",
        workers: [{ config: localHttpsWorkerConfig() }],
      });
      await server.listen();
      try {
        await use(server);
      } finally {
        await server.close();
      }
    },
    { scope: "worker" },
  ],

  baseURL: async ({ server }, use) => {
    const { url } = await server.listen();
    await use(url.href);
  },

  // The harness's certificate is self-signed.
  ignoreHTTPSErrors: true,

  database: [
    async ({ server }, use, testInfo) => {
      await server.getWorker().applyD1Migrations("DB");
      await use();
      if (testInfo.status !== testInfo.expectedStatus) server.debug();
      await server.reset();
    },
    { auto: true },
  ],

  addUser: async ({ server }, use) => {
    await use(async (role, name = defaultNames[role]) => {
      const DB = await database(server);
      const user = { id: crypto.randomUUID(), name, role };
      await DB.prepare("INSERT INTO users (id, name, role) VALUES (?, ?, ?)")
        .bind(user.id, user.name, user.role)
        .run();
      return user;
    });
  },

  signInAs: async ({ server, addUser, context, baseURL }, use) => {
    await use(async (role, name) => {
      const DB = await database(server);
      const user = await addUser(role, name);
      const token = newSessionToken();
      const at = Date.now();
      await DB.prepare(
        "INSERT INTO sessions (id, token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), await hashSecret(token), user.id, at, at)
        .run();
      await context.addCookies([
        { name: SESSION_COOKIE, value: token, url: baseURL, httpOnly: true, secure: true, sameSite: "Lax" },
      ]);
      return user;
    });
  },

  issueCode: async ({ server }, use) => {
    await use(async (user) => {
      const DB = await database(server);
      const { code, statements } = await codeForUser(user.id, Date.now());
      for (const sql of statements) await DB.prepare(sql).run();
      return code;
    });
  },

  addCategory: async ({ server }, use) => {
    let serial = 0;
    await use(async (name = `Categoría ${++serial}`) => {
      const DB = await database(server);
      const category = { id: crypto.randomUUID(), name };
      await DB.prepare(
        "INSERT INTO categories (id, name, position) SELECT ?, ?, COALESCE(MAX(position), 0) + 1 FROM categories",
      )
        .bind(category.id, category.name)
        .run();
      return category;
    });
  },

  addItem: async ({ server, addCategory }, use) => {
    let serial = 0;
    await use(async (item = {}) => {
      const DB = await database(server);
      const { name = `Producto ${++serial}`, price = 1000, stockTracked = true, minimum = null, stock } = item;
      const category = item.category ?? (await addCategory());
      const id = crypto.randomUUID();
      await DB.prepare(
        "INSERT INTO items (id, name, normalized_name, price, category_id, stock_tracked, minimum) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(id, name, normalizeName(name), price, category.id, stockTracked ? 1 : 0, minimum)
        .run();
      if (stock && stockTracked) {
        // The fact and its projection, as app/backend/stock.ts writes them.
        const at = Date.now();
        await DB.prepare(
          "INSERT INTO adjustments (id, item_id, reason, units, recorded_by, recorded_at, day) VALUES (?, ?, 'restock', ?, ?, ?, ?)",
        )
          .bind(crypto.randomUUID(), id, stock.units, stock.by.id, at, dayOf(at))
          .run();
        await DB.prepare("INSERT INTO stock_levels (item_id, units) VALUES (?, ?)").bind(id, stock.units).run();
      }
      return { id, name, price, category };
    });
  },

  addCustomer: async ({ server }, use) => {
    await use(async (name, { by, note, retired }) => {
      const DB = await database(server);
      const customer = { id: crypto.randomUUID(), name };
      const at = Date.now();
      await DB.prepare(
        "INSERT INTO customers (id, name, normalized_name, note, retired_at, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(customer.id, name, normalizeName(name), note ?? null, retired ? at : null, by.id, at)
        .run();
      return customer;
    });
  },
});

export { expect };
