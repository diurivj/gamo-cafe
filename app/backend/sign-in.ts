import { Data, Effect, Schema } from "effect";

import { newId } from "~/shared/id";
import { hashSecret, newSessionToken, newSignInCode, normalizeSignInCode } from "~/shared/secret";

import type { CurrentUser, Role } from "./current-user";
import { Db, statement } from "./db";
import { now } from "./time";

/**
 * Sign-in by one-time code, and sessions (spec §3.5, ADR 0004).
 *
 * A code and a session token exist in clear only in what these operations
 * return; D1 holds their SHA-256.
 */

/** A code stops working this long after it was issued. */
const CODE_LIFETIME = 10 * 60 * 1000;

/** A session ends this long after its last use. */
const SESSION_IDLE_LIFETIME = 60 * 24 * 60 * 60 * 1000;

/** At most this many failed entries, across the whole app, per window. */
const FAILURE_LIMIT = 10;
const FAILURE_WINDOW = 10 * 60 * 1000;

/** The code was never issued, was already used, has expired, or its User is deactivated. */
export class SignInCodeRejected extends Data.TaggedError("SignInCodeRejected")<{}> {}

/** The sign-in limit is closed: no code is accepted until the window passes. */
export class TooManySignInFailures extends Data.TaggedError("TooManySignInFailures")<{}> {}

/** No session, or one that has ended, was revoked, or whose User is deactivated. */
export class NotSignedIn extends Data.TaggedError("NotSignedIn")<{}> {}

const hash = (secret: string) => Effect.promise(() => hashSecret(secret));

/** Adds an active User. Who may do so is the caller's rule. */
export const addUser = Effect.fn("addUser")(function* (name: string, role: Role) {
  const db = yield* Db;
  const user: CurrentUser["Service"] = { id: newId(), name, role };
  yield* db.run("INSERT INTO users (id, name, role) VALUES (?, ?, ?)", user.id, user.name, user.role);
  return user;
});

/**
 * Issues a one-time code for a User and returns it, the only time it is known.
 * `issuedBy` is the Admin who asked, or `null` for the command line. Who may
 * issue one is the caller's rule.
 */
export const issueSignInCode = Effect.fn("issueSignInCode")(function* (
  userId: string,
  issuedBy: string | null,
) {
  const db = yield* Db;
  const code = newSignInCode();
  const issuedAt = yield* now;
  yield* db.run(
    "INSERT INTO sign_in_codes (id, user_id, code_hash, issued_by, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    newId(), userId, yield* hash(code), issuedBy, issuedAt, issuedAt + CODE_LIFETIME,
  );
  return code;
});

const Count = Schema.Struct({ n: Schema.Int });

/**
 * Trades a typed code for a session on this phone and returns the session's
 * token, the only time it is known. The code is marked used and the session
 * created in one batch (spec §7.3, 7), so a code makes at most one session
 * however many phones send it at once.
 */
export const useSignInCode = Effect.fn("useSignInCode")(function* (typed: string) {
  const db = yield* Db;
  const at = yield* now;

  const failures = yield* db.first(
    Count,
    "SELECT COUNT(*) AS n FROM sign_in_failures WHERE at > ?",
    at - FAILURE_WINDOW,
  );
  // Refused entries are not recorded, or the limit would never reopen.
  if ((failures?.n ?? 0) >= FAILURE_LIMIT) return yield* new TooManySignInFailures();

  const codeHash = yield* hash(normalizeSignInCode(typed));
  const token = newSessionToken();
  const [session] = yield* db.batch([
    // The session exists only if the code is usable right now...
    statement(
      `INSERT INTO sessions (id, token_hash, user_id, created_at, last_used_at)
       SELECT ?, ?, sign_in_codes.user_id, ?, ?
       FROM sign_in_codes JOIN users ON users.id = sign_in_codes.user_id
       WHERE sign_in_codes.code_hash = ? AND sign_in_codes.used_at IS NULL
         AND sign_in_codes.expires_at > ? AND users.active = 1`,
      newId(), yield* hash(token), at, at, codeHash, at,
    ),
    // ...and from then on it is not.
    statement(
      "UPDATE sign_in_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?",
      at, codeHash, at,
    ),
  ]);

  if (session?.changes !== 1) {
    yield* db.batch([
      statement("DELETE FROM sign_in_failures WHERE at <= ?", at - FAILURE_WINDOW),
      statement("INSERT INTO sign_in_failures (id, at) VALUES (?, ?)", newId(), at),
    ]);
    return yield* new SignInCodeRejected();
  }
  return { token };
});

const SessionUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.Literals(["admin", "worker"]),
});

/**
 * The User a session token belongs to, which is what `CurrentUser` is made
 * of. Finding the session is also its use: one statement extends it and reads
 * its User, and changes nothing unless the session is live and the User
 * active.
 */
export const authenticate = Effect.fn("authenticate")(function* (token: string) {
  const db = yield* Db;
  const at = yield* now;
  const user = yield* db.first(
    SessionUser,
    `UPDATE sessions SET last_used_at = ?
     WHERE token_hash = ? AND revoked_at IS NULL AND last_used_at > ?
       AND (SELECT active FROM users WHERE users.id = sessions.user_id) = 1
     RETURNING
       user_id AS id,
       (SELECT name FROM users WHERE users.id = sessions.user_id) AS name,
       (SELECT role FROM users WHERE users.id = sessions.user_id) AS role`,
    at, yield* hash(token), at - SESSION_IDLE_LIFETIME,
  );
  if (!user) return yield* new NotSignedIn();
  return user satisfies CurrentUser["Service"];
});

/** Ends the session of the phone that holds this token. */
export const signOut = Effect.fn("signOut")(function* (token: string) {
  const db = yield* Db;
  yield* db.run(
    "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
    yield* now, yield* hash(token),
  );
});
