import { env } from "cloudflare:workers";
import { Data, Effect, Schema } from "effect";
import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { CurrentUser } from "~/backend/current-user";
import { Db } from "~/backend/db";
import { run } from "~/backend/run.server";
import { envContext } from "~/context/env";

/** What a loader or action receives as `context`. */
function requestContext(bindings: Env = env) {
  const context = new RouterContextProvider();
  context.set(envContext, bindings);
  return context;
}

class BillIsVoided extends Data.TaggedError("BillIsVoided")<{ readonly billId: string }> {}

const appName = Db.use((db) =>
  db.first(Schema.Struct({ value: Schema.String }), "SELECT value FROM app_meta WHERE key = ?", "app"),
);

describe("run", () => {
  it("gives a loader the program's result, read through Db from the D1 binding", async () => {
    expect(await run(requestContext(), appName)).toEqual({ value: "gamo-cafe" });
  });

  it("hands a rule violation to the caller's mapping and gives back what it returns", async () => {
    const program = Effect.gen(function* () {
      yield* appName;
      return yield* new BillIsVoided({ billId: "b1" });
    });

    const result = await run(requestContext(), program, (error) => {
      switch (error._tag) {
        case "BillIsVoided":
          return { error: `La cuenta ${error.billId} está cancelada.` };
      }
    });

    expect(result).toEqual({ error: "La cuenta b1 está cancelada." });
  });

  it("makes the compiler report a rule violation that the mapping forgot", () => {
    class PaymentExceedsOwed extends Data.TaggedError("PaymentExceedsOwed")<{}> {}
    const program = Effect.gen(function* () {
      if ((yield* appName) === undefined) return yield* new PaymentExceedsOwed();
      return yield* new BillIsVoided({ billId: "b1" });
    });

    // Checked by `npm run typecheck`; never called.
    void (() =>
      // @ts-expect-error Not all code paths return a value: PaymentExceedsOwed is unhandled.
      run(requestContext(), program, (error) => {
        switch (error._tag) {
          case "BillIsVoided":
            return { error: "Esta cuenta está cancelada." };
        }
      }));

    // @ts-expect-error The mapping is required when the program has rule violations.
    void (() => run(requestContext(), program));
  });

  it("lets the mapping answer with a thrown response, such as a redirect", async () => {
    const redirect = new Response(null, { status: 302, headers: { Location: "/entrar" } });

    await expect(
      run(requestContext(), Effect.fail(new BillIsVoided({ billId: "b1" })), () => {
        throw redirect;
      }),
    ).rejects.toBe(redirect);
  });

  it("answers a database failure with a 500 and never calls the mapping", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const mapping = vi.fn();
    const broken = Db.use((db) => db.run("INSERT INTO no_such_table (id) VALUES (?)", "x"));

    const thrown = await run(requestContext(), broken, mapping).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(500);
    expect(mapping).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("rethrows a bug in the program as it was thrown", async () => {
    const bug = new Error("bug");
    const program = Effect.sync(() => {
      throw bug;
    });

    await expect(run(requestContext(), program)).rejects.toBe(bug);
  });

  it("runs a program that needs an author once it is given the CurrentUser", async () => {
    const author = CurrentUser.useSync((user) => user.name);

    // @ts-expect-error A program that requires CurrentUser cannot run without one.
    void (() => run(requestContext(), author));

    const provided = author.pipe(
      Effect.provideService(CurrentUser, { id: "u1", name: "Ana", role: "admin" }),
    );
    expect(await run(requestContext(), provided)).toBe("Ana");
  });
});
