import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { addUser, authenticate, issueSignInCode, signOut, useSignInCode } from "~/backend/sign-in";

import { advanceClock, runTest, setClock } from "./support/effect";

// Tests in this file share one D1, and the sign-in limit counts failures
// across the whole app, so each test lives on its own date.

describe("using a sign-in code", () => {
  it("signs in the User it was issued for", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-01-01T09:00:00");
        const ana = yield* addUser("Ana", "admin");
        const code = yield* issueSignInCode(ana.id, null);

        const { token } = yield* useSignInCode(code);

        expect(yield* authenticate(token)).toEqual({ id: ana.id, name: "Ana", role: "admin" });
      }),
    ));

  it("accepts the code however it was typed", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-01-02T09:00:00");
        const ana = yield* addUser("Ana", "admin");
        const code = yield* issueSignInCode(ana.id, null);

        const typed = ` ${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()} `;

        const { token } = yield* useSignInCode(typed);
        expect((yield* authenticate(token)).id).toBe(ana.id);
      }),
    ));

  it("works once: the second phone to type it is refused", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-01-03T09:00:00");
        const ana = yield* addUser("Ana", "admin");
        const code = yield* issueSignInCode(ana.id, null);
        yield* useSignInCode(code);

        const error = yield* Effect.flip(useSignInCode(code));

        expect(error._tag).toBe("SignInCodeRejected");
      }),
    ));

  it("still works just before 10 minutes have passed", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-01-04T09:00:00");
        const ana = yield* addUser("Ana", "admin");
        const code = yield* issueSignInCode(ana.id, null);
        yield* advanceClock("599 seconds");

        const { token } = yield* useSignInCode(code);

        expect((yield* authenticate(token)).id).toBe(ana.id);
      }),
    ));

  it("is refused 10 minutes after it was issued", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-01-05T09:00:00");
        const ana = yield* addUser("Ana", "admin");
        const code = yield* issueSignInCode(ana.id, null);
        yield* advanceClock("10 minutes");

        const error = yield* Effect.flip(useSignInCode(code));

        expect(error._tag).toBe("SignInCodeRejected");
      }),
    ));

  it("refuses a code that was never issued", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-01-06T09:00:00");

        const error = yield* Effect.flip(useSignInCode("ABCD 2345"));

        expect(error._tag).toBe("SignInCodeRejected");
      }),
    ));
});

describe("a session", () => {
  const signIn = Effect.gen(function* () {
    const beto = yield* addUser("Beto", "worker");
    const { token } = yield* useSignInCode(yield* issueSignInCode(beto.id, null));
    return { beto, token };
  });

  it("is refused when the token is not one the app handed out", () =>
    runTest(
      Effect.gen(function* () {
        const error = yield* Effect.flip(authenticate("not-a-token"));
        expect(error._tag).toBe("NotSignedIn");
      }),
    ));

  it("lasts 60 days without use, less a moment", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-03-01T09:00:00");
        const { beto, token } = yield* signIn;
        yield* advanceClock("60 days");
        yield* advanceClock(-1);

        expect((yield* authenticate(token)).id).toBe(beto.id);
      }),
    ));

  it("ends after 60 days without use", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-03-02T09:00:00");
        const { token } = yield* signIn;
        yield* advanceClock("60 days");

        const error = yield* Effect.flip(authenticate(token));

        expect(error._tag).toBe("NotSignedIn");
      }),
    ));

  it("is extended by each use", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-03-03T09:00:00");
        const { beto, token } = yield* signIn;
        yield* advanceClock("59 days");
        yield* authenticate(token);
        yield* advanceClock("59 days");

        // 118 days after sign-in, 59 after the last use.
        expect((yield* authenticate(token)).id).toBe(beto.id);

        yield* advanceClock("60 days");
        expect((yield* Effect.flip(authenticate(token)))._tag).toBe("NotSignedIn");
      }),
    ));

  it("stays ended once it has ended, whatever is tried afterwards", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-03-04T09:00:00");
        const { token } = yield* signIn;
        yield* advanceClock("61 days");
        yield* Effect.flip(authenticate(token));

        expect((yield* Effect.flip(authenticate(token)))._tag).toBe("NotSignedIn");
      }),
    ));

  it("ends when its phone signs out, and only that phone's", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-03-05T09:00:00");
        const { beto, token } = yield* signIn;
        const other = yield* useSignInCode(yield* issueSignInCode(beto.id, null));

        yield* signOut(token);

        expect((yield* Effect.flip(authenticate(token)))._tag).toBe("NotSignedIn");
        expect((yield* authenticate(other.token)).id).toBe(beto.id);
      }),
    ));
});

describe("the sign-in limit", () => {
  const failTimes = (times: number) =>
    Effect.forEach(Array.from({ length: times }), () => Effect.flip(useSignInCode("WRNG WRNG")));

  it("refuses the eleventh entry within 10 minutes even though its code is valid", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-02-01T09:00:00");
        const ana = yield* addUser("Ana", "admin");
        const code = yield* issueSignInCode(ana.id, null);
        yield* failTimes(10);

        const error = yield* Effect.flip(useSignInCode(code));

        expect(error._tag).toBe("TooManySignInFailures");
      }),
    ));

  it("still accepts a valid code after nine failures", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-02-02T09:00:00");
        const ana = yield* addUser("Ana", "admin");
        const code = yield* issueSignInCode(ana.id, null);
        yield* failTimes(9);

        const { token } = yield* useSignInCode(code);

        expect((yield* authenticate(token)).id).toBe(ana.id);
      }),
    ));

  it("lets sign-in through again once the 10 minutes have passed", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-02-03T09:00:00");
        const ana = yield* addUser("Ana", "admin");
        yield* failTimes(10);
        // Entries refused by the limit do not keep it closed.
        yield* failTimes(5);
        yield* advanceClock("10 minutes");
        const code = yield* issueSignInCode(ana.id, null);

        const { token } = yield* useSignInCode(code);

        expect((yield* authenticate(token)).id).toBe(ana.id);
      }),
    ));
});
