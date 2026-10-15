// Imported by scripts/sign-in-code.ts, which Node runs as it is: relative
// imports with their extension, no `~`, no Effect.
import { hashSecret, newSignInCode } from "../shared/secret.ts";

/**
 * What the developer's command line sends to D1 (spec §3.5): the first Admin,
 * a Worker added from a computer, and a sign-in code when no Admin is signed
 * in to issue one.
 *
 * `wrangler d1 execute` takes SQL text without parameters, so these build
 * whole statements. They write the same rows as `addUserWithCode` in
 * ./users.ts and `issueSignInCode` in ./sign-in.ts;
 * tests/command-line.test.ts signs in with the result to keep them in step.
 */

/** As in ./sign-in.ts: a code stops working 10 minutes after it was issued. */
const CODE_LIFETIME = 10 * 60 * 1000;

/** As on Usuarios: a name is kept with its space trimmed and collapsed. */
const tidyName = (name: string) => name.trim().replace(/\s+/g, " ");

/** Text as a SQL literal. */
function text(value: string): string {
  if (value.includes("\0")) throw new Error("text for SQL cannot contain a NUL character");
  return `'${value.replaceAll("'", "''")}'`;
}

export interface Issued {
  /** The code, in clear. Shown once to the developer and sent nowhere. */
  readonly code: string;
  /** What to execute, in order, as one unit. */
  readonly statements: ReadonlyArray<string>;
}

/** A code for the User with this id, written only if there is one. */
async function codeStatement(userId: string, issuedAt: number) {
  const code = newSignInCode();
  const sql =
    "INSERT INTO sign_in_codes (id, user_id, code_hash, issued_by, issued_at, expires_at) " +
    `SELECT ${text(crypto.randomUUID())}, id, ${text(await hashSecret(code))}, NULL, ` +
    `${issuedAt}, ${issuedAt + CODE_LIFETIME} FROM users WHERE id = ${text(userId)}`;
  return { code, sql };
}

/**
 * A new User and a code for them. `issuedAt` is epoch milliseconds.
 *
 * As on Usuarios, no two Users share a name, ignoring capitals. The first
 * statement returns the new User's id; when another User already has the
 * name, it returns no row and neither statement writes anything.
 */
export async function newUser(
  typedName: string,
  role: "admin" | "worker",
  issuedAt: number,
): Promise<Issued & { readonly name: string }> {
  const name = tidyName(typedName);
  const userId = crypto.randomUUID();
  const { code, sql } = await codeStatement(userId, issuedAt);
  return {
    name,
    code,
    statements: [
      `INSERT INTO users (id, name, role) SELECT ${text(userId)}, ${text(name)}, ${text(role)} ` +
        `WHERE NOT EXISTS (SELECT 1 FROM users WHERE name = ${text(name)} COLLATE NOCASE) RETURNING id`,
      sql,
    ],
  };
}

/** A code for an existing User. */
export async function codeForUser(userId: string, issuedAt: number): Promise<Issued> {
  const { code, sql } = await codeStatement(userId, issuedAt);
  return { code, statements: [sql] };
}

/** The query for the active Users with exactly this name: `id`, `name`, `role`. */
export function findActiveUsers(name: string): string {
  return `SELECT id, name, role FROM users WHERE name = ${text(name)} AND active = 1`;
}
