import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";

declare global {
  namespace Cloudflare {
    interface Env {
      /** Read from ./migrations by vitest.config.ts; exists only under test. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

// Idempotent: Wrangler's d1_migrations table records what has been applied.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
