import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  BUSIEST_DAY,
  OPEN_BILLS,
  PROOF_ITEMS,
  SEED_FROM,
  SEED_TO,
  seedStatements,
  seedStats,
  THIRTY_BILL_CUSTOMER_ID,
} from "../app/backend/seed.ts";

/**
 * The synthetic year behind the §10.7 request budgets (ticket 21), as SQL the
 * developer loads into the local D1. It is never loaded into production.
 *
 *     npm run seed                     writes seed.sql and prints its report
 *     npm run seed:local               ...and applies it to the local D1
 *
 * The seed module is `app/backend/seed.ts`; the tests in
 * `tests/proof-seed.test.ts` and `tests/proof-budget.test.ts` send the same
 * statements to a real D1, so what they prove is what this loads.
 */

const usage = `Uso:
  npm run seed [-- --from=YYYY-MM-DD --to=YYYY-MM-DD --out=seed.sql]
  npm run seed -- --local            genera y aplica a la base local

Options:
  --from, --to   the window of Days to generate (the whole year by default)
  --out          the SQL file to write (seed.sql by default)
  --local        apply the file to the local D1 after writing it`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values } = (() => {
  try {
    return parseArgs({
      options: {
        from: { type: "string", default: SEED_FROM },
        to: { type: "string", default: SEED_TO },
        out: { type: "string", default: "seed.sql" },
        local: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : error}\n\n${usage}`);
  }
})();

const window = { from: values.from, to: values.to };
if (window.to < window.from) fail(`--to (${window.to}) is before --from (${window.from}).`);

const statements = seedStatements(window);
const stats = seedStats(window);
writeFileSync(values.out, `${statements.join(";\n\n")};\n`);

const megabytes = (stats.bytes / (1024 * 1024)).toFixed(1);
const rows = Object.entries(stats.rows)
  .filter(([, count]) => count > 0)
  .map(([table, count]) => `${table} ${count}`)
  .join(", ");

console.log(`Seed ${window.from} .. ${window.to}: ${stats.statements} statements, ${megabytes} MB of SQL.
Rows: ${rows}
Written to ${values.out}.

Its shape: ${OPEN_BILLS} Open Bills; the Customer with 30 Open Bills is ${THIRTY_BILL_CUSTOMER_ID};
the busiest Day is ${BUSIEST_DAY}; the Items are ${PROOF_ITEMS[0]} .. ${PROOF_ITEMS[PROOF_ITEMS.length - 1]}.`);

if (values.local) {
  console.log(`\nLoading ${values.out} into the local D1:`);
  // The config is named because, after a build, a bare Wrangler command
  // reads the built one. `--file` takes the whole SQL file. It prints one
  // result per statement, which would bury the report above.
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", "--config", "wrangler.jsonc", "--local", "--yes", "--file", values.out],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  console.log(`Applied ${statements.length} statements to the local D1.`);

  console.log(`
Next: prove the projections match the facts.

    npm run projections:verify`);
} else {
  console.log(`
Load it with:

    npm run seed -- --local`);
}
