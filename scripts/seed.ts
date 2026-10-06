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
 * The synthetic year of the §10.7 proof (ticket 21), as SQL the developer
 * loads into the local D1 or into the disposable remote one.
 *
 *     npm run seed                     writes seed.sql and prints its report
 *     npm run seed:local               ...and applies it to the local D1
 *     npm run seed:production          ...and imports it into the production D1
 *
 * The seed module is `app/backend/seed.ts`; the tests in
 * `tests/proof-seed.test.ts` and `tests/proof-budget.test.ts` send the same
 * statements to a real D1, so what they prove is what this loads.
 */

const usage = `Uso:
  npm run seed [-- --from=YYYY-MM-DD --to=YYYY-MM-DD --out=seed.sql]
  npm run seed -- --local            genera y aplica a la base local
  npm run seed -- --production       genera e importa a la base de producción

Options:
  --from, --to   the window of Days to generate (the whole year by default)
  --out          the SQL file to write (seed.sql by default)
  --local        apply the file to the local D1 after writing it
  --production   import the file into the production D1 after writing it`;

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
        production: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : error}\n\n${usage}`);
  }
})();

if (values.local && values.production) fail(`--local and --production cannot both be given.\n\n${usage}`);

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
Estimated rows written (table rows plus index entries): ${stats.rowsWritten} of D1 Free's 100,000 a day.
Written to ${values.out}.

The proof's shape: ${OPEN_BILLS} Open Bills; the Customer with 30 Open Bills is ${THIRTY_BILL_CUSTOMER_ID};
the busiest Day is ${BUSIEST_DAY}; the Items are ${PROOF_ITEMS[0]} .. ${PROOF_ITEMS[PROOF_ITEMS.length - 1]}.`);

const target = values.production ? ["--env", "production", "--remote"] : values.local ? ["--local"] : null;
if (target !== null) {
  console.log(`\nLoading ${values.out} into the ${values.local ? "local" : "production"} D1:`);
  // The config is named because, after a build, a bare Wrangler command
  // reads the built one. `--file` takes the whole SQL file; a remote import
  // reports the rows read and written on the way in, which is a figure the
  // proof records, so that output is left as it comes.
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", "--config", "wrangler.jsonc", ...target, "--yes", "--file", values.out],
    // Local files print one result per statement; here they would bury the report above.
    { stdio: values.local ? ["ignore", "ignore", "inherit"] : "inherit" },
  );
  if (values.local) console.log(`Applied ${statements.length} statements to the local D1.`);

  console.log(`
Next: prove the projections match the facts.

    npm run projections:verify${values.production ? ":production" : ""}`);
} else {
  console.log(`
Load it with:

    npm run seed -- --local
    npm run seed -- --production`);
}
