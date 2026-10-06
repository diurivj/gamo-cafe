import { type MiddlewareFunction, redirectDocument } from "react-router";

import { pagePath, requestCookie, requireUser } from "~/session.server";

/**
 * Keeps the shell a phone shows true to its User without loading it again on
 * every navigation (spec §3.4).
 *
 * The shell's loader gives the User's name, role and navigation, and its
 * `shouldRevalidate` skips it while the shell stays on screen. What changes it
 * from elsewhere is an Admin changing that User's role. So the response that
 * carries the shell's data also sets a cookie saying whose shell the phone now
 * shows, and with which role. A later request for a page's data that does not
 * ask for the shell is compared with it: when the User is no longer that one,
 * it is answered with a reload of the page, which loads the shell again.
 *
 * `shellMiddleware` is the middleware of `app/routes/shell.tsx`, so it runs
 * for every screen inside the shell, after the session's.
 */

const SHELL_COOKIE = "gamo_shell";
/** The shell route's id, as the browser's router names it in `_routes`. */
const SHELL_ROUTE = "routes/shell";
/** As long as the session's cookie: the browser forgets both together at the latest. */
const MAX_AGE = 400 * 24 * 60 * 60;

/**
 * Whether this request runs the shell's loader. A document always does. The
 * browser's router asks for a page's data at the page's path plus `.data`, and
 * names the loaders it wants in `_routes` when it skips some.
 */
function loadsShell(url: URL): boolean {
  if (!url.pathname.endsWith(".data")) return true;
  const wanted = url.searchParams.get("_routes");
  return wanted === null || wanted.split(",").includes(SHELL_ROUTE);
}

export const shellMiddleware: MiddlewareFunction<Response> = async ({ context, request }, next) => {
  // A form is answered by its action; the request for the page that follows
  // is the one compared.
  if (request.method !== "GET") return next();

  const user = requireUser(context);
  const current = `${user.id}.${user.role}`;
  if (requestCookie(request, SHELL_COOKIE) === current) return next();

  const url = new URL(request.url);
  if (!loadsShell(url)) {
    // The phone shows another User's shell, or this User's with the role they
    // had: load the whole page again instead of answering under it.
    url.searchParams.delete("_routes");
    throw redirectDocument(pagePath(request) + url.search);
  }

  const response = await next();
  response.headers.append(
    "Set-Cookie",
    `${SHELL_COOKIE}=${current}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`,
  );
  return response;
};
