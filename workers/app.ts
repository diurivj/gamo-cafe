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
