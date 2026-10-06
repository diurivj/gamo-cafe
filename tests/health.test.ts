import { exports } from "cloudflare:workers";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { Db } from "~/backend/db";
import { checkHealth } from "~/backend/health";

import { runTest, setClock } from "./support/effect";

describe("checkHealth", () => {
  it("reports the migrated database and the cafeteria's current Day", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T19:30:00");
        expect(yield* checkHealth).toEqual({ ok: true, day: "2026-10-05" });
      }),
    ));

  it("reports not ok, instead of failing, when D1 cannot be queried", async () => {
    const unreachable = {
      prepare() {
        throw new Error("D1 is unreachable");
      },
    } as unknown as D1Database;

    const health = await Effect.runPromise(checkHealth.pipe(Effect.provide(Db.layer(unreachable))));

    expect(health).toEqual({ ok: false });
  });
});

describe("GET /healthz", () => {
  it("answers 200 with JSON once the Worker has queried D1", async () => {
    const response = await exports.default.fetch("https://gamo.test/healthz");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });
});
