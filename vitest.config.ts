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
  },
  resolve: {
    tsconfigPaths: true,
  },
});
