import { createContext, type MiddlewareFunction, redirect, type RouterContextProvider } from "react-router";

import type { CurrentUser } from "~/backend/current-user";
import { run } from "~/backend/run.server";
import { authenticate } from "~/backend/sign-in";
import { SESSION_COOKIE } from "~/shared/secret";

/**
 * The one place a request becomes a User (spec §3.5, §10.1).
 *
 * `sessionMiddleware` is the root route's middleware, so it runs before every
 * loader and action of every route. It reads the session cookie, asks
 * `authenticate` whose it is, and, unless the path is in `PUBLIC_PATHS`,
 * answers a request without a live session with a redirect to Entrar. No
 * loader or action runs for a signed-out visitor outside those paths.
 *
 * A loader or action then takes the User from the context:
 *
 *     const user = requireUser(context);
 *     return run(context, program.pipe(Effect.provideService(CurrentUser, user)));
 */

type User = CurrentUser["Service"];

export const SIGN_IN_PATH = "/entrar";

/**
 * Paths answered without a session. Each one is an exemption from §10.1 and
 * must also be listed, with its reason, in tests/route-guard.test.ts.
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([SIGN_IN_PATH, "/healthz"]);

export { SESSION_COOKIE };

const COOKIE_ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Lax";

/**
 * How long the browser keeps the cookie: the longest browsers allow. The
 * session's real end, 60 days after its last use, is decided on the server.
 */
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/** The `Set-Cookie` value that signs this phone in. */
export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Max-Age=${COOKIE_MAX_AGE}; ${COOKIE_ATTRIBUTES}`;
}

/** The `Set-Cookie` value that makes this phone forget its session. */
export const clearedSessionCookie = `${SESSION_COOKIE}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`;

/** The value of one cookie of this request, as it was sent; `undefined` when it has none. */
export function requestCookie(request: Request, cookie: string): string | undefined {
  for (const pair of (request.headers.get("Cookie") ?? "").split(";")) {
    const [name, ...value] = pair.trim().split("=");
    if (name === cookie) return value.join("=") || undefined;
  }
  return undefined;
}

/** The session token this request carries, if any. */
export function sessionToken(request: Request): string | undefined {
  return requestCookie(request, SESSION_COOKIE);
}

/**
 * The path of the page a request is about. The browser's router asks for a
 * page's data at the page's path plus `.data` (`/_.data` for the home page),
 * and middleware sees that address as it was sent.
 */
export function pagePath(request: Request): string {
  const { pathname } = new URL(request.url);
  return pathname.replace(/(\/_)?\.data$/, "") || "/";
}

const userContext = createContext<User | null>(null);

export const sessionMiddleware: MiddlewareFunction<Response> = async ({ context, request }, next) => {
  const token = sessionToken(request);
  const user = token
    ? await run(context, authenticate(token), (error) => {
        switch (error._tag) {
          case "NotSignedIn":
            return null;
        }
      })
    : null;
  context.set(userContext, user);

  if (!user && !PUBLIC_PATHS.has(pagePath(request))) throw redirect(SIGN_IN_PATH);
  return next();
};

/** The signed-in User, or `null` on a public path visited without a session. */
export function optionalUser(context: Readonly<RouterContextProvider>): User | null {
  return context.get(userContext);
}

/**
 * The signed-in User, for every loader and action. The middleware has already
 * turned signed-out visitors away; this also does, so that a route which is
 * somehow reached without a User still answers with Entrar and nothing else.
 */
export function requireUser(context: Readonly<RouterContextProvider>): User {
  const user = context.get(userContext);
  if (!user) throw redirect(SIGN_IN_PATH);
  return user;
}
