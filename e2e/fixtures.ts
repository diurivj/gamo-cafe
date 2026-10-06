import { test as base, expect } from "@playwright/test";
import { createTestHarness, type TestHarness } from "wrangler";

type TestFixtures = {
  /** Runs around every test: migrated D1 before, storage wiped after. */
  database: void;
};

type WorkerFixtures = {
  server: TestHarness;
};

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
        // The Wrangler config that the Cloudflare Vite plugin generates.
        workers: [{ configPath: "./wrangler.json" }],
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

  database: [
    async ({ server }, use, testInfo) => {
      await server.getWorker().applyD1Migrations("DB");
      await use();
      if (testInfo.status !== testInfo.expectedStatus) server.debug();
      await server.reset();
    },
    { auto: true },
  ],
});

export { expect };
