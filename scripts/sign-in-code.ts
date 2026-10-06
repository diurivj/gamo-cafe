import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

import { codeForUser, findActiveUsers, firstAdmin, type Issued } from "../app/backend/command-line.ts";
import { formatSignInCode } from "../app/shared/secret.ts";

/**
 * The developer's way in (spec §3.5): creates the first Admin, or issues a
 * sign-in code for a User when no Admin is signed in to do it.
 *
 *     npm run sign-in-code -- --new-admin "Diego"
 *     npm run sign-in-code -- --user "Diego"
 *
 * Both act on the local D1. Add `--production` to act on the production D1,
 * with the Cloudflare account Wrangler is logged in to.
 *
 * The code is printed once. D1 receives only its hash.
 */

const usage = `Uso:
  npm run sign-in-code -- --new-admin "Nombre"   Crea un administrador y le da un código
  npm run sign-in-code -- --user "Nombre"        Da un código a un usuario que ya existe
Opciones:
  --production   Actúa sobre la base de datos de producción (por defecto, la local)`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values } = (() => {
  try {
    return parseArgs({
      options: {
        "new-admin": { type: "string" },
        user: { type: "string" },
        production: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : error}\n\n${usage}`);
  }
})();

const newAdmin = values["new-admin"]?.trim();
const user = values.user?.trim();
if ((newAdmin ? 1 : 0) + (user ? 1 : 0) !== 1) fail(usage);

/** Runs SQL with Wrangler and gives back the rows of each statement. */
function execute(sql: string): Array<{ results: Array<Record<string, unknown>> }> {
  const target = values.production ? ["--env", "production", "--remote"] : ["--local"];
  const output = execFileSync(
    "npx",
    // The config is named because, after a build, a bare Wrangler command
    // reads the built one. No shell is involved, so the SQL arrives whole.
    ["wrangler", "d1", "execute", "DB", "--config", "wrangler.jsonc", ...target, "--yes", "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return JSON.parse(output);
}

let issued: Issued;
let name: string;
if (newAdmin) {
  name = newAdmin;
  issued = await firstAdmin(name, Date.now());
} else {
  name = user!;
  const [found] = execute(findActiveUsers(name));
  const users = found?.results ?? [];
  if (users.length === 0) fail(`No hay un usuario activo llamado "${name}".`);
  if (users.length > 1) fail(`Hay ${users.length} usuarios activos llamados "${name}". Usa la app para darles un código.`);
  issued = await codeForUser(String(users[0]!.id), Date.now());
}

// One Wrangler command for the User and their code. If it stops halfway, the
// User exists without a code: run it again with --user.
execute(issued.statements.join("; "));

console.log(`
${newAdmin ? "Administrador creado" : "Código emitido"} en ${values.production ? "PRODUCCIÓN" : "local"}: ${name}

    ${formatSignInCode(issued.code)}

Sirve una sola vez y vence en 10 minutos.`);
