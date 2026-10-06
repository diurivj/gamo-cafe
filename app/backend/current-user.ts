import { Context } from "effect";

export type Role = "admin" | "worker";

/**
 * The signed-in User (spec §3.2). An operation that records something reads
 * its author from here, so the compiler refuses to run it for nobody:
 *
 *     const user = yield* CurrentUser;
 *
 * A loader or action provides it for the request with
 * `Effect.provideService(CurrentUser, user)`.
 */
export class CurrentUser extends Context.Service<CurrentUser, {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
}>()("gamo-cafe/backend/CurrentUser") {}
