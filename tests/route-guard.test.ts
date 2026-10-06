import { describe, expect, it } from "vitest";
import * as build from "virtual:react-router/server-build";

import { appFetch } from "./support/auth";

/**
 * Spec §10.1: no loader or action other than sign-in responds without a valid
 * session. This sweeps every route the app has, so a route added later is
 * covered without touching this file.
 *
 * The exemptions, each with its reason. Adding one is a decision, not a fix.
 */
const exemptions: Record<string, string> = {
  "/entrar": "Sign-in itself.",
  "/healthz": "Liveness for the developer's deploy check. Answers { ok } and nothing the app holds.",
};

type Routes = typeof build.routes;
type RouteEntry = NonNullable<Routes[string]>;

/** The URL path of a route, with `x` standing in for each parameter. */
function pathOf(route: RouteEntry, routes: Routes): string {
  const segments: string[] = [];
  for (let at: RouteEntry | undefined = route; at; at = at.parentId ? routes[at.parentId] : undefined) {
    if (at.path) segments.unshift(at.path);
  }
  const path = segments
    .join("/")
    .split("/")
    .map((segment) => (segment.startsWith(":") || segment === "*" ? "x" : segment.replace(/\?$/, "")))
    .join("/");
  return `/${path}`;
}

const routes = Object.values(build.routes).filter((route) => route !== undefined);
const paths = [...new Set(routes.map((route) => pathOf(route, build.routes)))].sort();
const guarded = paths.filter((path) => !(path in exemptions));

function expectSentToSignIn(response: Response, what: string) {
  expect(response.status, what).toBe(302);
  expect(response.headers.get("Location"), what).toBe("/entrar");
}

describe("without a valid session", () => {
  it("the sweep sees the app's routes", () => {
    expect(paths).toContain("/");
    expect(paths).toContain("/entrar");
    expect(paths).toContain("/salir");
    expect(Object.keys(exemptions).filter((path) => !paths.includes(path))).toEqual([]);
  });

  it.for(guarded)("GET %s only sends the visitor to Entrar", async (path) => {
    expectSentToSignIn(await appFetch(path), "document");
  });

  it.for(guarded)("POST %s only sends the visitor to Entrar", async (path) => {
    expectSentToSignIn(await appFetch(path, { method: "POST", body: new URLSearchParams() }), "form post");
  });

  // What the browser's router asks for on a client-side navigation or a
  // fetcher submission. The redirect travels inside a 202 here, and no route's
  // data may travel with it.
  it.for(guarded)("the data request for %s carries nothing but the way to Entrar", async (path) => {
    const dataPath = path === "/" ? "/_.data" : `${path}.data`;

    for (const init of [{}, { method: "POST", body: new URLSearchParams() }]) {
      const response = await appFetch(dataPath, init);
      const body = await response.text();

      expect([202, 204, 302], `${init.method ?? "GET"} ${dataPath}`).toContain(response.status);
      if (response.status === 302) expect(response.headers.get("Location")).toBe("/entrar");
      else expect(body).toContain('"/entrar"');
      expect(body).not.toContain("routes/");
    }
  });

  it("a session cookie with a made-up token is no session", async () => {
    for (const path of guarded) {
      const response = await appFetch(path, { headers: { Cookie: "__Host-gamo-session=made-up" } });
      expectSentToSignIn(response, path);
    }
  });
});
