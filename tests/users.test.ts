import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { Role } from "~/backend/current-user";
import { authenticate, issueSignInCode, useSignInCode } from "~/backend/sign-in";
import {
  addUserWithCode,
  changeRole,
  deactivateUser,
  issueCodeForUser,
  listUsers,
  reactivateUser,
  signOutEverywhere,
} from "~/backend/users";

import { as, seedUser } from "./support/auth";
import { runTest } from "./support/effect";

// Tests in this file share one D1. Names are unique per test, and nothing here
// depends on how many Admins there are: that rule is in last-admin.test.ts.

describe("adding a User", () => {
  it("gives the Admin a one-time code that signs the new User in", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana 1");

        const { user, code } = yield* addUserWithCode("Beto 1", "worker").pipe(as(ana));

        expect(user).toMatchObject({ name: "Beto 1", role: "worker" });
        expect(code).toMatch(/^[A-Z2-9]{8}$/);
        const { token } = yield* useSignInCode(code);
        expect(yield* authenticate(token)).toEqual(user);
      }),
    ));

  it("is refused to a Worker, and adds nobody", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana 2");
        const beto = yield* seedUser("worker", "Beto 2");

        const error = yield* Effect.flip(addUserWithCode("Carla 2", "admin").pipe(as(beto)));

        expect(error._tag).toBe("AdminOnly");
        const names = (yield* listUsers.pipe(as(ana))).map((user) => user.name);
        expect(names).toContain("Beto 2");
        expect(names).not.toContain("Carla 2");
      }),
    ));

  it("takes the name without the spaces around it, and refuses an empty one", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana 3");

        const { user } = yield* addUserWithCode("  Dora 3 ", "worker").pipe(as(ana));
        const error = yield* Effect.flip(addUserWithCode("   ", "worker").pipe(as(ana)));

        expect(user.name).toBe("Dora 3");
        expect(error._tag).toBe("UserNameRequired");
      }),
    ));

  it("refuses a name another User already has, whatever its capitals", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana 4");
        yield* addUserWithCode("Elena 4", "worker").pipe(as(ana));

        const error = yield* Effect.flip(addUserWithCode("elena 4", "admin").pipe(as(ana)));

        expect(error._tag).toBe("UserNameTaken");
        const elenas = (yield* listUsers.pipe(as(ana))).filter((user) => /^elena 4$/i.test(user.name));
        expect(elenas).toEqual([expect.objectContaining({ name: "Elena 4", role: "worker", active: true })]);
      }),
    ));
});

/** A User signed in on one phone: the User and that phone's session token. */
const onAPhone = (role: Role, name: string) =>
  Effect.gen(function* () {
    const user = yield* seedUser(role, name);
    const { token } = yield* useSignInCode(yield* issueSignInCode(user.id, null));
    return { user, token };
  });

const isSignedIn = (token: string) =>
  authenticate(token).pipe(
    Effect.as(true),
    Effect.catchTag("NotSignedIn", () => Effect.succeed(false)),
  );

describe("a new code for an existing User", () => {
  it("signs them in on another phone and leaves the first one signed in", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana 5");
        const beto = yield* onAPhone("worker", "Beto 5");

        const { code } = yield* issueCodeForUser(beto.user.id).pipe(as(ana));

        const secondPhone = yield* useSignInCode(code);
        expect(yield* authenticate(secondPhone.token)).toEqual(beto.user);
        expect(yield* isSignedIn(beto.token)).toBe(true);
      }),
    ));

  it("is refused to a Worker, for a User that does not exist, and for a deactivated one", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana 6");
        const beto = yield* seedUser("worker", "Beto 6");
        const carla = yield* seedUser("worker", "Carla 6");
        yield* deactivateUser(carla.id).pipe(as(ana));

        const tags = [
          yield* Effect.flip(issueCodeForUser(ana.id).pipe(as(beto))),
          yield* Effect.flip(issueCodeForUser("nobody").pipe(as(ana))),
          yield* Effect.flip(issueCodeForUser(carla.id).pipe(as(ana))),
        ].map((error) => error._tag);

        expect(tags).toEqual(["AdminOnly", "UserNotFound", "UserIsDeactivated"]);
      }),
    ));
});

describe("signing a User out everywhere", () => {
  it("ends every session of that User and of nobody else, and they can sign in again", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* onAPhone("admin", "Ana 7");
        const beto = yield* onAPhone("worker", "Beto 7");
        const secondPhone = yield* useSignInCode(yield* issueSignInCode(beto.user.id, null));

        yield* signOutEverywhere(beto.user.id).pipe(as(ana.user));

        expect(yield* isSignedIn(beto.token)).toBe(false);
        expect(yield* isSignedIn(secondPhone.token)).toBe(false);
        expect(yield* isSignedIn(ana.token)).toBe(true);
        const again = yield* useSignInCode((yield* issueCodeForUser(beto.user.id).pipe(as(ana.user))).code);
        expect(yield* isSignedIn(again.token)).toBe(true);
      }),
    ));

  it("is refused to a Worker, and for a User that does not exist", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* onAPhone("admin", "Ana 8");
        const beto = yield* seedUser("worker", "Beto 8");

        const refused = yield* Effect.flip(signOutEverywhere(ana.user.id).pipe(as(beto)));
        const missing = yield* Effect.flip(signOutEverywhere("nobody").pipe(as(ana.user)));

        expect(refused._tag).toBe("AdminOnly");
        expect(missing._tag).toBe("UserNotFound");
        expect(yield* isSignedIn(ana.token)).toBe(true);
      }),
    ));
});

describe("deactivating a User", () => {
  it("signs them out everywhere, keeps them on the list, and makes their unused code worthless", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana 9");
        const beto = yield* onAPhone("worker", "Beto 9");
        const { code: unused } = yield* issueCodeForUser(beto.user.id).pipe(as(ana));

        yield* deactivateUser(beto.user.id).pipe(as(ana));

        expect(yield* isSignedIn(beto.token)).toBe(false);
        expect((yield* Effect.flip(useSignInCode(unused)))._tag).toBe("SignInCodeRejected");
        const listed = (yield* listUsers.pipe(as(ana))).find((user) => user.id === beto.user.id);
        expect(listed).toEqual({ ...beto.user, active: false });
      }),
    ));

  it("is undone by reactivating: a new code works, the old session and the old code do not", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana 10");
        const beto = yield* onAPhone("worker", "Beto 10");
        const { code: oldCode } = yield* issueCodeForUser(beto.user.id).pipe(as(ana));
        yield* deactivateUser(beto.user.id).pipe(as(ana));

        yield* reactivateUser(beto.user.id).pipe(as(ana));

        expect(yield* isSignedIn(beto.token)).toBe(false);
        expect((yield* Effect.flip(useSignInCode(oldCode)))._tag).toBe("SignInCodeRejected");
        const { token } = yield* useSignInCode((yield* issueCodeForUser(beto.user.id).pipe(as(ana))).code);
        expect(yield* authenticate(token)).toEqual(beto.user);
      }),
    ));

  it("and reactivating are refused to a Worker, and for a User that does not exist", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* onAPhone("admin", "Ana 11");
        const beto = yield* seedUser("worker", "Beto 11");

        const tags = [
          yield* Effect.flip(deactivateUser(ana.user.id).pipe(as(beto))),
          yield* Effect.flip(reactivateUser(ana.user.id).pipe(as(beto))),
          yield* Effect.flip(deactivateUser("nobody").pipe(as(ana.user))),
          yield* Effect.flip(reactivateUser("nobody").pipe(as(ana.user))),
        ].map((error) => error._tag);

        expect(tags).toEqual(["AdminOnly", "AdminOnly", "UserNotFound", "UserNotFound"]);
        expect(yield* isSignedIn(ana.token)).toBe(true);
      }),
    ));
});

describe("changing a User's role", () => {
  it("shows on that User's next request, without signing them out", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana 12");
        const beto = yield* onAPhone("worker", "Beto 12");

        yield* changeRole(beto.user.id, "admin").pipe(as(ana));
        expect(yield* authenticate(beto.token)).toEqual({ ...beto.user, role: "admin" });

        yield* changeRole(beto.user.id, "worker").pipe(as(ana));
        expect(yield* authenticate(beto.token)).toEqual(beto.user);
      }),
    ));

  it("is refused to a Worker, and for a User that does not exist", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana 13");
        const beto = yield* onAPhone("worker", "Beto 13");

        const refused = yield* Effect.flip(changeRole(beto.user.id, "admin").pipe(as(beto.user)));
        const missing = yield* Effect.flip(changeRole("nobody", "admin").pipe(as(ana)));

        expect(refused._tag).toBe("AdminOnly");
        expect(missing._tag).toBe("UserNotFound");
        expect(yield* authenticate(beto.token)).toEqual(beto.user);
      }),
    ));
});
