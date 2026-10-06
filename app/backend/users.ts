import { Data, Effect, Schema } from "effect";

import { newId } from "~/shared/id";

import { type CurrentUser, requireAdmin, type Role } from "./current-user";
import { Db, statement } from "./db";
import { issueSignInCode } from "./sign-in";
import { now } from "./time";

/**
 * What an Admin does on Usuarios (spec §3.5, §4.1): add Users, issue sign-in
 * codes, sign a User out of every phone, deactivate, reactivate, change role.
 * Users are never deleted. Every operation here starts with `requireAdmin`.
 */

const UserRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.Literals(["admin", "worker"]),
  active: Schema.Literals([0, 1]),
});

/** Every User, deactivated ones included: active first, then by name. */
export const listUsers = Effect.gen(function* () {
  yield* requireAdmin;
  const db = yield* Db;
  const rows = yield* db.all(
    UserRow,
    "SELECT id, name, role, active FROM users ORDER BY active DESC, name COLLATE NOCASE, id",
  );
  return rows.map((row) => ({ ...row, active: row.active === 1 }));
});

/** A User needs a name to be told apart on screen. */
export class UserNameRequired extends Data.TaggedError("UserNameRequired")<{}> {}

/** Another User, active or not, already has this name. */
export class UserNameTaken extends Data.TaggedError("UserNameTaken")<{ readonly name: string }> {}

/**
 * Adds a User and issues their first sign-in code, the only time it is known.
 *
 * Names are kept distinct, ignoring capitals, among all Users: staff tell
 * each other apart by name, and so does the command line's `--user`.
 */
export const addUserWithCode = Effect.fn("addUserWithCode")(function* (typedName: string, role: Role) {
  const admin = yield* requireAdmin;
  const db = yield* Db;

  const name = typedName.trim().replace(/\s+/g, " ");
  if (name === "") return yield* new UserNameRequired();

  const user: CurrentUser["Service"] = { id: newId(), name, role };
  // The condition is in the statement, so two Admins adding the same name at
  // once add one User.
  const added = yield* db.run(
    `INSERT INTO users (id, name, role)
     SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE name = ? COLLATE NOCASE)`,
    user.id, user.name, user.role, user.name,
  );
  if (added.changes !== 1) return yield* new UserNameTaken({ name });

  return { user, code: yield* issueSignInCode(user.id, admin.id) };
});

/** No User has this id. */
export class UserNotFound extends Data.TaggedError("UserNotFound")<{ readonly userId: string }> {}

/** A deactivated User cannot sign in, so there is no use in a code for them. */
export class UserIsDeactivated extends Data.TaggedError("UserIsDeactivated")<{ readonly userId: string }> {}

/** The app must keep one active Admin (spec §3.5): this change would leave none. */
export class LastActiveAdmin extends Data.TaggedError("LastActiveAdmin")<{ readonly userId: string }> {}

const findUser = Effect.fnUntraced(function* (userId: string) {
  const db = yield* Db;
  const user = yield* db.first(UserRow, "SELECT id, name, role, active FROM users WHERE id = ?", userId);
  if (!user) return yield* new UserNotFound({ userId });
  return user;
});

/**
 * Issues a new one-time code for an existing User, for a new phone, and
 * returns it with the User, the only time it is known. Their other phones
 * stay signed in.
 */
export const issueCodeForUser = Effect.fn("issueCodeForUser")(function* (userId: string) {
  const admin = yield* requireAdmin;
  const user = yield* findUser(userId);
  if (user.active === 0) return yield* new UserIsDeactivated({ userId });
  return {
    user: { id: user.id, name: user.name, role: user.role } satisfies CurrentUser["Service"],
    code: yield* issueSignInCode(userId, admin.id),
  };
});

/** Ends every session of a User. They stay active and can sign in with a new code. */
export const signOutEverywhere = Effect.fn("signOutEverywhere")(function* (userId: string) {
  yield* requireAdmin;
  const db = yield* Db;
  yield* findUser(userId);
  yield* db.run(
    "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
    yield* now, userId,
  );
});

/**
 * True while more than one Admin is active. It goes inside the statement that
 * makes the change, so that two requests racing to remove the last two Admins
 * cannot both pass: D1 runs one statement at a time, and the second one counts
 * after the first has been stored.
 */
const ANOTHER_ACTIVE_ADMIN = "(SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1) > 1";

/**
 * Deactivates a User: they are signed out everywhere, no code of theirs works,
 * and they keep their place in every record they made. Refused for the last
 * active Admin. Deactivating a deactivated User changes nothing.
 */
export const deactivateUser = Effect.fn("deactivateUser")(function* (userId: string) {
  yield* requireAdmin;
  const db = yield* Db;
  const at = yield* now;

  const deactivated = "(SELECT active FROM users WHERE id = ?) = 0";
  const [user] = yield* db.batch([
    statement(
      `UPDATE users SET active = 0
       WHERE id = ? AND active = 1 AND (role <> 'admin' OR ${ANOTHER_ACTIVE_ADMIN})`,
      userId,
    ),
    // Only if the User is deactivated by now: a batch cannot branch.
    statement(
      `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND ${deactivated}`,
      at, userId, userId,
    ),
    // A code issued before must not start working again on reactivation.
    statement(
      `UPDATE sign_in_codes SET expires_at = ?
       WHERE user_id = ? AND used_at IS NULL AND expires_at > ? AND ${deactivated}`,
      at, userId, at, userId,
    ),
  ]);
  if (user?.changes === 1) return;

  const found = yield* findUser(userId);
  if (found.active === 1) return yield* new LastActiveAdmin({ userId });
});

/** Lets a deactivated User sign in again, with a new code. */
export const reactivateUser = Effect.fn("reactivateUser")(function* (userId: string) {
  yield* requireAdmin;
  const db = yield* Db;
  const user = yield* db.run("UPDATE users SET active = 1 WHERE id = ?", userId);
  if (user.changes !== 1) return yield* new UserNotFound({ userId });
});

/**
 * Makes a User an Admin or a Worker. It shows on their next request; nobody
 * is signed out. Refused when it would make a Worker of the last active Admin.
 */
export const changeRole = Effect.fn("changeRole")(function* (userId: string, role: Role) {
  yield* requireAdmin;
  const db = yield* Db;

  const changed = yield* db.run(
    `UPDATE users SET role = ?
     WHERE id = ? AND role <> ? AND (? = 'admin' OR active = 0 OR ${ANOTHER_ACTIVE_ADMIN})`,
    role, userId, role, role,
  );
  if (changed.changes === 1) return;

  const found = yield* findUser(userId);
  if (found.role !== role) return yield* new LastActiveAdmin({ userId });
});
