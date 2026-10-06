import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { requireAdmin } from "~/backend/current-user";

import { as, seedUser } from "./support/auth";
import { runTest } from "./support/effect";

describe("requireAdmin", () => {
  it("gives an Admin back as the author", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        expect(yield* requireAdmin.pipe(as(ana))).toEqual(ana);
      }),
    ));

  it("stops a Worker with the typed error AdminOnly", () =>
    runTest(
      Effect.gen(function* () {
        const beto = yield* seedUser("worker");
        const error = yield* Effect.flip(requireAdmin.pipe(as(beto)));
        expect(error._tag).toBe("AdminOnly");
      }),
    ));

  it("cannot run for nobody", () => {
    // @ts-expect-error requireAdmin needs a CurrentUser.
    void (() => Effect.runPromise(requireAdmin));
  });
});
