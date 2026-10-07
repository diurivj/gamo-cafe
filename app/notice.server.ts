import { Result, Schema } from "effect";
import { createContext, type MiddlewareFunction, replace, type RouterContextProvider } from "react-router";

import { isDataRequest, pagePath } from "~/session.server";
import { newId } from "~/shared/id";
import type { Notice, TakenNotice } from "~/shared/notice";

/**
 * What a recorded form leaves for the screen that sent it (spec §3.4).
 *
 * An action that records something answers the request that sent the form
 * with a notice: what that screen must say, in Spanish.
 *
 *     // the action
 *     return answerWithNotice(request, `/clientes/${id}`, { message: "Abono de $20.00 registrado." });
 *
 *     // the screen that sent it: the notice in the router's own data
 *     const notice = useActionData()?.notice;   // or a fetcher's `data.notice`
 *     {notice?.message ? <p role="status">{notice.message}</p> : null}
 *
 * A request the browser's router sent is a data request: the notice travels
 * in the action's own answer, so only the screen that sent the form can read
 * it. Two answers at once cannot lose or take each other's words, and no
 * other tab can take them.
 *
 * A document request — a browser without JavaScript posted the page itself —
 * is answered with the redirect below, and the notice waits in a cookie that
 * lasts a minute. `noticeMiddleware`, on the root route, reads it before the
 * loaders run and clears it on the response of the request whose loader took
 * it (`takeNotice`). The message is never in the URL, and a page other than
 * the one the redirect named neither shows it nor clears it.
 */

const NOTICE_COOKIE = "gamo_notice";
const COOKIE_ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Lax";
/** Seconds: long enough for the redirect to be followed on a bad connection. */
const MAX_AGE = 60;
const CLEARED_COOKIE = `${NOTICE_COOKIE}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`;

/** The cookie's value: the notice, and the path of the page it is for. */
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

/** The notice a screen gets, with the `id` that is new for every recorded form. */
function withNewId(notice: Notice): TakenNotice {
  return { ...notice, id: newId() };
}

/** The redirect to `to` that leaves `held` in the cookie for the page it names. */
function redirectWithNoticeCookie(to: string, held: TakenNotice): Response {
  const cookie = { ...held, to: new URL(to, "https://app.invalid").pathname };
  return replace(to, {
    headers: {
      "Set-Cookie": `${NOTICE_COOKIE}=${encodeURIComponent(JSON.stringify(cookie))}; Max-Age=${MAX_AGE}; ${COOKIE_ATTRIBUTES}`,
    },
  });
}

/**
 * The answer of an action that recorded something, for the request that sent
 * the form (spec §3.4): the notice in the answer itself when the browser's
 * router sent it, or a redirect carrying it in the cookie when the browser
 * posted the document (see the module comment).
 *
 *     return answerWithNotice(request, "/", { message, billId: result.id });
 */
export function answerWithNotice(
  request: Request,
  to: string,
  notice: Notice,
): Response | { readonly notice: TakenNotice } {
  const held = withNewId(notice);
  if (isDataRequest(request)) return { notice: held };
  return redirectWithNoticeCookie(to, held);
}

/** The notice this request carries for this page, if any. */
function carriedNotice(request: Request): TakenNotice | null {
  if (request.method !== "GET") return null;
  for (const pair of (request.headers.get("Cookie") ?? "").split(";")) {
    const [name, ...value] = pair.trim().split("=");
    if (name !== NOTICE_COOKIE) continue;
    let json: string;
    try {
      json = decodeURIComponent(value.join("="));
    } catch {
      return null;
    }
    const decoded = Schema.decodeUnknownResult(Carried)(json);
    if (!Result.isSuccess(decoded)) return null;
    const { to, ...notice } = decoded.success;
    return to === pagePath(request) ? notice : null;
  }
  return null;
}

const noticeContext = createContext<{ readonly notice: TakenNotice | null; taken: boolean } | null>(null);

export const noticeMiddleware: MiddlewareFunction<Response> = async ({ context, request }, next) => {
  const held = { notice: carriedNotice(request), taken: false };
  context.set(noticeContext, held);
  const response = await next();
  if (held.taken) response.headers.append("Set-Cookie", CLEARED_COOKIE);
  return response;
};

/**
 * What the form that redirected here left for this page, once: the response
 * of this request tells the browser to forget it. `null` on every other visit.
 */
export function takeNotice(context: Readonly<RouterContextProvider>): TakenNotice | null {
  const held = context.get(noticeContext);
  if (!held?.notice) return null;
  held.taken = true;
  return held.notice;
}
