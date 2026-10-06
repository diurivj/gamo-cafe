import { env } from "cloudflare:workers";
import { type Duration, Effect, Layer } from "effect";
// The module itself, not the testing index, which re-exports unstable modules.
import * as TestClock from "effect/testing/TestClock";

import { Db } from "~/backend/db";

/**
 * The one way to run an Effect program in a test: the real local D1 (with
 * migrations applied by ./setup.ts) behind `Db`, and a test clock that starts
 * at the Unix epoch and moves only when the test moves it.
 *
 * A typed failure rejects the promise. To assert on one, turn it into a value
 * first: `yield* Effect.flip(program)` or `Effect.exit(program)`.
 */
export function runTest<A, E>(program: Effect.Effect<A, E, Db>): Promise<A> {
  return Effect.runPromise(
    program.pipe(Effect.provide(Layer.mergeAll(Db.layer(env.DB), TestClock.layer()))),
  );
}

/**
 * Sets the test clock to a wall-clock time in Mexico City, written without an
 * offset: `yield* setClock("2026-10-05T23:59:59")`.
 */
export function setClock(mexicoCityTime: string): Effect.Effect<void> {
  // America/Mexico_City has been UTC-6 all year since it dropped daylight
  // time in October 2022.
  return TestClock.setTime(Date.parse(`${mexicoCityTime}-06:00`));
}

/** Moves the test clock forward: `yield* advanceClock("10 minutes")`. */
export function advanceClock(duration: Duration.Input): Effect.Effect<void> {
  return TestClock.adjust(duration);
}
