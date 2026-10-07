import { describe, expect, it } from "vitest";

import { sendForRecord, SIGNED_OUT } from "~/shared/record-request";

// How a form that records something ended (UI redesign §6.1): only the
// server's own answer makes it confirmed or refused. Anything else is unknown.

const answering = (response: () => Response | Promise<Response>) => ({ send: (async () => response()) as typeof fetch });
const body = new URLSearchParams({ a: "1" });
const confirms = (answer: object): answer is { sale: unknown } => "sale" in answer;

describe("a form sent to be recorded", () => {
  it("is sent as a POST with its fields", async () => {
    const sent: Array<[unknown, RequestInit | undefined]> = [];
    await sendForRecord("/vender/registrar", body, confirms, {
      send: (async (path: unknown, init?: RequestInit) => {
        sent.push([path, init]);
        return Response.json({ sale: {} });
      }) as typeof fetch,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toBe("/vender/registrar");
    expect(sent[0]![1]).toMatchObject({ method: "POST", body });
  });

  it("is confirmed by the server's 200 answer", async () => {
    expect(await sendForRecord("/x", body, confirms, answering(() => Response.json({ sale: { billId: "b" } })))).toEqual({
      outcome: "confirmed",
      answer: { sale: { billId: "b" } },
    });
  });

  it("is refused by an answer with the reason, with what else it carries", async () => {
    const refused = () => Response.json({ error: "Agrega al menos un producto.", unavailable: ["x"] }, { status: 400 });

    expect(await sendForRecord("/x", body, confirms, answering(refused))).toEqual({
      outcome: "refused",
      answer: { error: "Agrega al menos un producto.", unavailable: ["x"] },
    });
  });

  it("is refused when the session ended: Entrar answered in the action's place", async () => {
    const entrar = () => {
      const response = new Response("<html>Entrar</html>", { headers: { "Content-Type": "text/html" } });
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    };

    expect(await sendForRecord("/x", body, confirms, answering(entrar))).toEqual({
      outcome: "refused",
      answer: { error: SIGNED_OUT, sessionEnded: true },
    });
  });

  it("is unknown when the request fails, the server fails, or the answer is not the route's", async () => {
    const outcomes = await Promise.all([
      sendForRecord("/x", body, confirms, answering(() => Promise.reject(new TypeError("Failed to fetch")))),
      sendForRecord("/x", body, confirms, answering(() => new Response("Internal Server Error", { status: 500 }))),
      sendForRecord("/x", body, confirms, answering(() => Response.json({ message: "boom" }, { status: 500 }))),
      sendForRecord("/x", body, confirms, answering(() => new Response("<html></html>"))),
      sendForRecord("/x", body, confirms, answering(() => Response.json(null))),
      // A 200 that is not what the route says it recorded confirms nothing.
      sendForRecord("/x", body, confirms, answering(() => Response.json({ ok: true }))),
    ]);

    expect(outcomes).toEqual(Array.from({ length: 6 }, () => ({ outcome: "unknown" })));
  });

  it("is unknown when no answer comes in time", async () => {
    const never = ((_path: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
      })) as typeof fetch;

    expect(await sendForRecord("/x", body, confirms, { patience: 10, send: never })).toEqual({ outcome: "unknown" });
  });
});
