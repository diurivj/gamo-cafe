/**
 * Sends a form that records something and says how it ended (UI redesign §6):
 * confirmed, refused, or unknown. It is the browser's own `fetch`, not the
 * router's, because the router answers a request that failed on its way with
 * an error screen, and that screen would take the place of the very form a
 * safe retry needs.
 *
 *     const outcome = await sendForRecord("/vender/registrar", saleBody(snapshot), isSaleAnswer);
 *
 * The route it posts to answers JSON: what it recorded with 200, or
 * `{ error }` with the Spanish reason when a rule refused it. Everything else
 * — no connection, no answer in time, a failure of the server, a 200 that is
 * not the route's answer — is `unknown`: the form may or may not have been
 * recorded, and only sending the same form again, with the same submission
 * key, tells (README, "One submission per form").
 *
 * A session that ended is a refusal with `sessionEnded`: Entrar answered in
 * the action's place, so *this* request recorded nothing. An earlier attempt
 * of the same form may have; the caller that retries has to mind that.
 *
 * Safe in the browser: no Effect import.
 */

/** What a refusal carries: the reason, and whatever else the route adds. */
export interface Refusal {
  readonly error: string;
  /** Set here, never by a route: the session ended before the action ran. */
  readonly sessionEnded?: true;
}

export type Recorded<Answer, Refused extends Refusal = Refusal> =
  | { readonly outcome: "confirmed"; readonly answer: Answer }
  | { readonly outcome: "refused"; readonly answer: Refused }
  | { readonly outcome: "unknown" };

/** What a first attempt is told when the session ended: Entrar answered before any action ran. */
export const SIGNED_OUT = "Tu sesión terminó y no se registró nada. Entra de nuevo y vuelve a intentar.";

/** Milliseconds a phone waits for an answer before saying it does not know. */
const PATIENCE = 20_000;

export async function sendForRecord<Answer, Refused extends Refusal = Refusal>(
  path: string,
  body: URLSearchParams,
  /** Whether a 200 answer is what the route says it recorded. */
  confirms: (answer: object) => answer is Answer & object,
  { patience = PATIENCE, send = fetch }: { readonly patience?: number; readonly send?: typeof fetch } = {},
): Promise<Recorded<Answer, Refused>> {
  try {
    const response = await send(path, { method: "POST", body, signal: AbortSignal.timeout(patience) });
    if (response.redirected) {
      return { outcome: "refused", answer: { error: SIGNED_OUT, sessionEnded: true } as Refused };
    }
    const answer: unknown = await response.json();
    if (typeof answer !== "object" || answer === null) return { outcome: "unknown" };
    if (response.ok) return confirms(answer) ? { outcome: "confirmed", answer } : { outcome: "unknown" };
    // A rule's refusal is a 4xx with its reason; a failure of the server is not one.
    const refused = response.status < 500 && "error" in answer && typeof answer.error === "string";
    return refused ? { outcome: "refused", answer: answer as Refused } : { outcome: "unknown" };
  } catch {
    return { outcome: "unknown" };
  }
}
