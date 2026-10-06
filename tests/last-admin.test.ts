import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { changeRole, deactivateUser, listUsers, reactivateUser } from "~/backend/users";

import { as, seedUser, signedIn } from "./support/auth";
import { runTest } from "./support/effect";

// Spec §3.5, §10.1: the last active Admin cannot be deactivated or made a
// Worker. The rule counts every Admin in the database, so each test here
// starts from an empty one.
beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

const activeAdmins = (asUser: Parameters<typeof as>[0]) =>
  listUsers.pipe(
    as(asUser),
    Effect.map((users) => users.filter((user) => user.active && user.role === "admin").map((user) => user.name)),
  );

describe("the last active Admin", () => {
  it("cannot be deactivated", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana");
        yield* seedUser("worker", "Beto");

        const error = yield* Effect.flip(deactivateUser(ana.id).pipe(as(ana)));

        expect(error._tag).toBe("LastActiveAdmin");
        expect(yield* activeAdmins(ana)).toEqual(["Ana"]);
      }),
    ));

  it("cannot be made a Worker", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana");

        const error = yield* Effect.flip(changeRole(ana.id, "worker").pipe(as(ana)));

        expect(error._tag).toBe("LastActiveAdmin");
        expect(yield* activeAdmins(ana)).toEqual(["Ana"]);
      }),
    ));

  it("is the last one even when a deactivated Admin exists", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana");
        const carla = yield* seedUser("admin", "Carla");
        yield* deactivateUser(carla.id).pipe(as(ana));

        const deactivating = yield* Effect.flip(deactivateUser(ana.id).pipe(as(ana)));
        const demoting = yield* Effect.flip(changeRole(ana.id, "worker").pipe(as(ana)));

        expect([deactivating._tag, demoting._tag]).toEqual(["LastActiveAdmin", "LastActiveAdmin"]);
        // The deactivated one is no Admin to protect, and can be made a Worker.
        yield* changeRole(carla.id, "worker").pipe(as(ana));
        expect(yield* activeAdmins(ana)).toEqual(["Ana"]);
      }),
    ));

  it("can be deactivated or made a Worker once there is another active Admin", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana");
        const beto = yield* seedUser("worker", "Beto");
        const carla = yield* seedUser("admin", "Carla");
        yield* deactivateUser(carla.id).pipe(as(ana));

        yield* changeRole(beto.id, "admin").pipe(as(ana));
        const betoNow = { ...beto, role: "admin" as const };
        yield* changeRole(ana.id, "worker").pipe(as(ana));
        expect(yield* activeAdmins(betoNow)).toEqual(["Beto"]);

        yield* reactivateUser(carla.id).pipe(as(betoNow));
        yield* deactivateUser(beto.id).pipe(as(carla));
        expect(yield* activeAdmins(carla)).toEqual(["Carla"]);
      }),
    ));

  it("is still there when two Admins deactivate each other at the same moment", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana");
        const carla = yield* seedUser("admin", "Carla");

        const outcomes = yield* Effect.all(
          [
            Effect.exit(deactivateUser(carla.id).pipe(as(ana))),
            Effect.exit(deactivateUser(ana.id).pipe(as(carla))),
          ],
          { concurrency: "unbounded" },
        );

        expect(outcomes.filter((exit) => exit._tag === "Success")).toHaveLength(1);
        expect(yield* activeAdmins(ana)).toHaveLength(1);
      }),
    ));

  it("is still there when one request deactivates an Admin while another makes the other a Worker", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana");
        const carla = yield* seedUser("admin", "Carla");

        const outcomes = yield* Effect.all(
          [
            Effect.exit(deactivateUser(carla.id).pipe(as(ana))),
            Effect.exit(changeRole(ana.id, "worker").pipe(as(carla))),
          ],
          { concurrency: "unbounded" },
        );

        expect(outcomes.filter((exit) => exit._tag === "Success")).toHaveLength(1);
        expect(yield* activeAdmins(ana)).toHaveLength(1);
      }),
    ));
});

describe("on Usuarios", () => {
  it("the only Admin is told why they cannot deactivate themselves or become a Worker, and stays", async () => {
    const ana = await signedIn("admin", "Ana");
    const post = (fields: Record<string, string>) =>
      ana.fetch("/usuarios", { method: "POST", body: new URLSearchParams({ userId: ana.user.id, ...fields }) });

    for (const response of [await post({ intent: "deactivate" }), await post({ intent: "change-role", role: "worker" })]) {
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Debe quedar al menos un administrador activo.");
    }
    expect((await ana.fetch("/usuarios")).status).toBe(200);
  });
});

describe("two phones racing through the app", () => {
  it("leave one active Admin when each deactivates the other", async () => {
    const ana = await signedIn("admin", "Ana");
    const carla = await signedIn("admin", "Carla");
    const deactivate = (userId: string) => ({
      method: "POST",
      body: new URLSearchParams({ intent: "deactivate", userId }),
    });

    await Promise.all([
      ana.fetch("/usuarios", deactivate(carla.user.id)),
      carla.fetch("/usuarios", deactivate(ana.user.id)),
    ]);

    const after = await Promise.all([ana.fetch("/usuarios"), carla.fetch("/usuarios")]);
    // One still manages Users; the other was signed out by being deactivated.
    expect(after.map((response) => response.status).sort()).toEqual([200, 302]);
  });
});
