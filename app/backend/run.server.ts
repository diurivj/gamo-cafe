import { Cause, type Effect, Exit, ManagedRuntime, Option } from "effect";
import type { RouterContextProvider } from "react-router";

import { getEnv } from "~/context/env";

import { Db, DbError } from "./db";

// One runtime per isolate (spec §3.2): built on the first request from the D1
// binding and reused by every later request that the isolate serves.
const runtimes = new WeakMap<D1Database, ManagedRuntime.ManagedRuntime<Db, never>>();

function runtimeFor(d1: D1Database) {
  let runtime = runtimes.get(d1);
  if (!runtime) {
    runtime = ManagedRuntime.make(Db.layer(d1));
    runtimes.set(d1, runtime);
  }
  return runtime;
}

/**
 * The one way a loader or action runs an Effect program.
 *
 * - Success: resolves with the program's value.
 * - A rule violation (any typed error other than `DbError`): `onError` turns
 *   it into what the route answers with. Return a value, typically a Spanish
 *   message for the form, or throw a `redirect(...)`. The argument is required
 *   exactly when the program can fail that way, and a `switch` on `error._tag`
 *   is checked by the compiler for a missing case.
 * - `DbError`: logged and thrown as a 500 for the error boundary. A program
 *   that wants to answer it differently catches it itself with
 *   `Effect.catchTag("DbError", ...)`.
 * - A defect (a bug): rethrown as it was.
 *
 * The program may require `Db` only. Provide `CurrentUser` before calling.
 */
export function run<A>(
  context: Readonly<RouterContextProvider>,
  program: Effect.Effect<A, DbError, Db>,
): Promise<A>;
export function run<A, E, B>(
  context: Readonly<RouterContextProvider>,
  program: Effect.Effect<A, E, Db>,
  onError: (error: Exclude<E, DbError>) => B,
): Promise<A | B>;
export async function run<A, E, B>(
  context: Readonly<RouterContextProvider>,
  program: Effect.Effect<A, E, Db>,
  onError?: (error: Exclude<E, DbError>) => B,
): Promise<A | B> {
  const exit = await runtimeFor(getEnv(context).DB).runPromiseExit(program);
  if (Exit.isSuccess(exit)) return exit.value;

  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isNone(failure)) throw Cause.squash(exit.cause);

  const error = failure.value;
  if (error instanceof DbError) {
    console.error("DbError", error.cause);
    throw new Response(null, { status: 500 });
  }
  // The overloads make `onError` required whenever E has such an error.
  return onError!(error as Exclude<E, DbError>);
}
