import { Clock, Effect } from "effect";

import { type Day, dayOf, type Instant } from "~/shared/day";

/**
 * The only two ways backend code learns what time it is. Both read Effect's
 * `Clock`, so a test moves time with the test clock. Never call `Date.now()`
 * or `new Date()` in an operation.
 */

/** The current instant, in epoch milliseconds. */
export const now: Effect.Effect<Instant> = Clock.currentTimeMillis;

/** The current Day in the cafeteria's time zone. */
export const today: Effect.Effect<Day> = Effect.map(now, dayOf);
