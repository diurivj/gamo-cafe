import { Result, Schema } from "effect";
import { createContext, type MiddlewareFunction, redirect, type RouterContextProvider } from "react-router";

import { pagePath } from "~/session.server";
import { newId } from "~/shared/id";

/**
 * What a recorded form leaves for the page it redirects to (spec §3.4).
 *
 * An action that records something answers with a redirect, so a reload or
 * the back button never records it twice. What the screen says afterwards
 * travels with the redirect in a cookie that lasts a minute, and the page it
 * was meant for reads it once:
 *
 *     // the action
 *     return redirectWithFlash(`/clientes/${id}`, { message: "Abono de $20.00 registrado." });
 *
 *     // the loader of the page it lands on
 *     return { customer, flash: takeFlash(context) };
 *
 *     // the component
 *     {flash?.message ? <p role="status">{flash.message}</p> : null}
 *
 * `flashMiddleware`, on the root route, reads the cookie before the loaders
 * run and clears it on the response of the request whose loader took it. The
 * message is never in the URL, and a page other than the one the redirect
 * named neither shows it nor clears it.
 */

/** What an action says about what it recorded. Every field is optional. */
export interface Flash {
  /** What the screen says, in Spanish. */
  readonly message?: string;
  /** Which form of the page was recorded, for a page with several. */
  readonly form?: string;
  /** The Bill a selection was recorded on, for Vender. */
  readonly billId?: string;
  /** A one-time sign-in code to read out, for Usuarios. */
  readonly code?: { readonly name: string; readonly code: string };
}

/** A flash as a loader gets it. */
export interface TakenFlash extends Flash {
  /** New for every recorded form: a page keys a form on it to start it over. */
  readonly id: string;
}

const FLASH_COOKIE = "gamo_flash";
const COOKIE_ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Lax";
/** Seconds: long enough for the redirect to be followed on a bad connection. */
const MAX_AGE = 60;
const CLEARED_COOKIE = `${FLASH_COOKIE}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`;

/** The cookie's value: the flash, and the path of the page it is for. */
const Carried = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.String,
    to: Schema.String,
    message: Schema.optional(Schema.String),
    form: Schema.optional(Schema.String),
    billId: Schema.optional(Schema.String),
    code: Schema.optional(Schema.Struct({ name: Schema.String, code: Schema.String })),
  }),
);

/**
 * The answer of an action that recorded something: a redirect to `to`, a path
 * of the app, carrying `flash` for the page at that path.
 */
export function redirectWithFlash(to: string, flash: Flash): Response {
  const carried = { ...flash, id: newId(), to: new URL(to, "https://app.invalid").pathname };
  return redirect(to, {
    headers: {
      "Set-Cookie": `${FLASH_COOKIE}=${encodeURIComponent(JSON.stringify(carried))}; Max-Age=${MAX_AGE}; ${COOKIE_ATTRIBUTES}`,
    },
  });
}

/** The flash this request carries for this page, if any. */
function carriedFlash(request: Request): TakenFlash | null {
  if (request.method !== "GET") return null;
  for (const pair of (request.headers.get("Cookie") ?? "").split(";")) {
    const [name, ...value] = pair.trim().split("=");
    if (name !== FLASH_COOKIE) continue;
    let json: string;
    try {
      json = decodeURIComponent(value.join("="));
    } catch {
      return null;
    }
    const decoded = Schema.decodeUnknownResult(Carried)(json);
    if (!Result.isSuccess(decoded)) return null;
    const { to, ...flash } = decoded.success;
    return to === pagePath(request) ? flash : null;
  }
  return null;
}

const flashContext = createContext<{ readonly flash: TakenFlash | null; taken: boolean } | null>(null);

export const flashMiddleware: MiddlewareFunction<Response> = async ({ context, request }, next) => {
  const held = { flash: carriedFlash(request), taken: false };
  context.set(flashContext, held);
  const response = await next();
  if (held.taken) response.headers.append("Set-Cookie", CLEARED_COOKIE);
  return response;
};

/**
 * What the form that redirected here left for this page, once: the response
 * of this request tells the browser to forget it. `null` on every other visit.
 */
export function takeFlash(context: Readonly<RouterContextProvider>): TakenFlash | null {
  const held = context.get(flashContext);
  if (!held?.flash) return null;
  held.taken = true;
  return held.flash;
}
