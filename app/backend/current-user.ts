import { Context, Data, Effect } from "effect";

export type Role = "admin" | "worker";

/**
 * The signed-in User (spec §3.2). An operation that records something reads
 * its author from here, so the compiler refuses to run it for nobody:
 *
 *     const user = yield* CurrentUser;
 *
 * A loader or action takes the User from the session with `requireUser` in
 * `~/session.server` and provides it for the request with
 * `Effect.provideService(CurrentUser, user)`.
 */
export class CurrentUser extends Context.Service<CurrentUser, {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
}>()("gamo-cafe/backend/CurrentUser") {}

/** A Worker asked for something only an Admin may do (spec §4.1). */
export class AdminOnly extends Data.TaggedError("AdminOnly")<{}> {}

/**
 * The signed-in User, who must be an Admin. An operation that only an Admin
 * may run starts with it, which puts `AdminOnly` in its error type, so the
 * route that calls it has to answer that case:
 *
 *     const admin = yield* requireAdmin;
 */
export const requireAdmin: Effect.Effect<CurrentUser["Service"], AdminOnly, CurrentUser> =
  Effect.gen(function* () {
    const user = yield* CurrentUser;
    if (user.role !== "admin") return yield* new AdminOnly();
    return user;
  });
