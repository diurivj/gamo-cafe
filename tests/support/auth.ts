import { env, exports } from "cloudflare:workers";
import { Effect } from "effect";

import { CurrentUser, type Role } from "~/backend/current-user";
import { Db } from "~/backend/db";
import { addUser, issueSignInCode, useSignInCode } from "~/backend/sign-in";
import { SESSION_COOKIE } from "~/session.server";

/** The origin the Worker is addressed at in tests. */
export const APP_ORIGIN = "https://gamo.test";

type User = CurrentUser["Service"];

const names = { admin: "Ana", worker: "Beto" } as const;

/**
 * Adds a User, for a program run with `runTest`:
 *
 *     const ana = yield* seedUser("admin");
 *     yield* recordSomething().pipe(as(ana));
 */
export function seedUser(role: Role, name: string = names[role]) {
  return addUser(name, role);
}

/** Runs the rest of the pipe as this User: `program.pipe(as(ana))`. */
export function as(user: User) {
  return Effect.provideService(CurrentUser, user);
}

/**
 * A request to the Worker, as a browser on the app's own pages sends it:
 * redirects are not followed, and a non-GET request carries the app's
 * `Origin`. Signed out unless `init.headers` has a `Cookie`.
 */
export function appFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = init.method ?? "GET";
  if (method !== "GET" && method !== "HEAD" && !headers.has("Origin")) {
    headers.set("Origin", APP_ORIGIN);
  }
  return exports.default.fetch(
    new Request(new URL(path, APP_ORIGIN), { ...init, headers, redirect: "manual" }),
  );
}

/**
 * The page a recorded form's redirect lands on, as the browser asks for it:
 * the redirect's `Location`, carrying the cookies the redirect set — which is
 * how the notice of `~/notice.server` reaches the page.
 *
 *     const page = await landing(beto, await beto.fetch(path, { method: "POST", body }));
 *     expect(await page.text()).toContain("Abono de $20.00 registrado.");
 */
export function landing(who: SignedIn, redirected: Response): Promise<Response> {
  const location = redirected.headers.get("Location");
  if (redirected.status !== 302 || !location) {
    throw new Error(`Expected a redirect, got ${redirected.status}.`);
  }
  const set = redirected.headers.getSetCookie().map((cookie) => cookie.split(";")[0]!);
  return who.fetch(location, { headers: { Cookie: [who.cookie, ...set].join("; ") } });
}

export interface SignedIn {
  readonly user: User;
  /** The session token, as the cookie holds it. */
  readonly token: string;
  /** The `Cookie` request header of this phone. */
  readonly cookie: string;
  /** `appFetch` from this phone. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

/**
 * A new User signed in on a phone, for tests that go through the Worker:
 *
 *     const ana = await signedIn("admin");
 *     const response = await ana.fetch("/usuarios");
 *
 * The User and the session are made by the real operations, on the real
 * clock, because the Worker under test reads the real clock too.
 */
export async function signedIn(role: Role, name?: string): Promise<SignedIn> {
  const { user, token } = await Effect.runPromise(
    Effect.gen(function* () {
      const user = yield* seedUser(role, name);
      const { token } = yield* useSignInCode(yield* issueSignInCode(user.id, null));
      return { user, token };
    }).pipe(Effect.provide(Db.layer(env.DB))),
  );
  const cookie = `${SESSION_COOKIE}=${token}`;
  return {
    user,
    token,
    cookie,
    fetch(path, init = {}) {
      const headers = new Headers(init.headers);
      // A test that sends more cookies than the session's passes them all.
      if (!headers.has("Cookie")) headers.set("Cookie", cookie);
      return appFetch(path, { ...init, headers });
    },
  };
}
