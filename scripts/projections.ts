import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

import {
  type ProjectionDifference,
  rebuildProjectionStatements,
  verifyProjectionsSql,
} from "../app/backend/rebuild.ts";

/**
 * The maintenance command (ticket 19, spec §7.1): every projection the app
 * keeps is recomputed from the facts it is derived from, so the developer can
 * either see what disagrees with the live values or rewrite them.
 *
 *     npm run projections:verify
 *     npm run projections:rebuild
 *
 * Both act on the local D1. The `:production` scripts act on the production
 * D1, with the Cloudflare account Wrangler is logged in to.
 *
 * The SQL lives in ./app/backend/rebuild.ts, and it is the same SQL the tests
 * send to a real D1 whose state was built through the operations.
 */

const usage = `Usage:
  npm run projections:verify [-- --production]    Report every projection that disagrees with the facts
  npm run projections:rebuild [-- --production]   Rewrite the projections from the facts
Options:
  --production   Acts on the production D1 (local by default)`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values, positionals } = (() => {
  try {
    return parseArgs({
      options: { production: { type: "boolean", default: false } },
      allowPositionals: true,
    });
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : error}\n\n${usage}`);
  }
})();

const mode = positionals[0];
if (mode !== "verify" && mode !== "rebuild") fail(usage);

const target = values.production ? "Production" : "Local";

/** One result object per statement, as `wrangler d1 execute --json` gives them. */
function execute(sql: string): Array<{ results: Array<Record<string, unknown>> }> {
  const place = values.production ? ["--env", "production", "--remote"] : ["--local"];
  const output = execFileSync(
    "npx",
    // The config is named because, after a build, a bare Wrangler command
    // reads the built one. No shell is involved, so the SQL arrives whole.
    ["wrangler", "d1", "execute", "DB", "--config", "wrangler.jsonc", ...place, "--yes", "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return JSON.parse(output);
}

/** The rows of the command's first and only statement. */
function query(sql: string): Array<Record<string, unknown>> {
  return execute(sql)[0]?.results ?? [];
}

function differences(): ProjectionDifference[] {
  return query(verifyProjectionsSql) as unknown as ProjectionDifference[];
}

/** A value as the report shows it: a missing projection is `(none)`. */
const show = (value: string | number | null) => (value === null ? "(none)" : String(value));

function report(rows: ReadonlyArray<ProjectionDifference>) {
  if (rows.length === 0) {
    console.log(`${target}: no differences — every projection matches the facts.`);
    return;
  }
  console.log(`${target}: ${rows.length} ${rows.length === 1 ? "difference" : "differences"} between the live projections and the facts.`);
  for (const { projection, id, field, live, rebuilt } of rows) {
    console.log(`  ${projection.padEnd(5)} ${id} ${field.padEnd(15)} live ${show(live)}  rebuilt ${show(rebuilt)}`);
  }
}

if (mode === "verify") {
  const rows = differences();
  report(rows);
  if (rows.length > 0) {
    console.log(`\nRewrite them with npm run projections:rebuild${values.production ? ":production" : ""}.`);
    process.exit(1);
  }
} else {
  const before = differences();
  report(before);
  if (before.length === 0) process.exit(0);

  console.log(`\nRewriting the projections from the facts:`);
  for (const { label, sql } of rebuildProjectionStatements) {
    execute(sql);
    console.log(`  ${label}`);
  }

  const after = differences();
  if (after.length > 0) {
    report(after);
    fail(`\n${target}: the projections still disagree with the facts after the rebuild.`);
  }
  console.log(
    `${target}: ${before.length} ${before.length === 1 ? "difference" : "differences"} fixed — every projection matches the facts.`,
  );
}
