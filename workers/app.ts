import { createRequestHandler } from "@react-router/cloudflare";
import { RouterContextProvider } from "react-router";
import { envContext } from "~/context/env";

/**
 * React Router v8 Framework Mode on the Cloudflare Workers runtime.
 *
 * The adapter's `createRequestHandler` is typed for a Cloudflare Pages
 * `EventContext`; on Workers we pass the subset it actually reads (request,
 * env, waitUntil, passThroughOnException), hence the one assertion below.
 */
const requestHandler = createRequestHandler<Env>({
  build: () => import("virtual:react-router/server-build"),
  mode: import.meta.env.MODE,
  getLoadContext({ context }) {
    const provider = new RouterContextProvider();
    provider.set(envContext, context.cloudflare.env);
    return provider;
  },
});

type AdapterEvent = Parameters<typeof requestHandler>[0];

export default {
  async fetch(request, env, ctx) {
    // A request that changes something must come from the app's own pages
    // (spec §3.5). Browsers send `Origin` with every non-GET request, so one
    // without it is not from the app either.
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      request.headers.get("Origin") !== new URL(request.url).origin
    ) {
      return new Response("Origen no permitido.", {
        status: 403,
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const response = await requestHandler({
      request,
      env,
      waitUntil: ctx.waitUntil.bind(ctx),
      passThroughOnException: ctx.passThroughOnException.bind(ctx),
    } as AdapterEvent);

    // Staff data only: nothing dynamic may be stored by a shared cache.
    if (response.headers.has("Cache-Control")) return response;
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
