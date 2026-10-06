import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vitest/config";

// Every test runs inside workerd (the Workers pool) against a real local D1.
// tests/support/setup.ts applies the migrations before each test file.
export default defineConfig({
  plugins: [
    reactRouter(),
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        },
      },
    })),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/support/setup.ts"],
    globals: false,
    // The first request to the Worker in a test file loads the whole server
    // build; with every file doing so at once that can pass the default 5 s.
    testTimeout: 20_000,
  },
  resolve: {
    tsconfigPaths: true,
  },
});
