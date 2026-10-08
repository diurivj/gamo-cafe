import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { recordSelection } from "~/backend/bills";
import { Db } from "~/backend/db";

import { as, signedIn, type SignedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { runTest } from "./support/effect";

// Mi día through the Worker (spec §4.2, §6.1, §10.6): the screen reads the
// signed-in User from the session and takes no User from the request, so a
// Worker cannot ask for another one's figures. Records are made on the real
// clock, because the route reads the real clock too.

/** Records a selection with its Payment now, on the real clock. */
const sell = (
  user: SignedIn["user"],
  itemId: string,
  quantity: number,
  method: "cash" | "transfer",
) =>
  Effect.runPromise(
    recordSelection({ items: [{ itemId, quantity }], payment: { method } }).pipe(
      as(user),
      Effect.provide(Db.layer(env.DB)),
    ),
  );

describe("Mi día", () => {
  it("shows a Worker only their own records, whatever the query string asks", async () => {
    const beto = await signedIn("worker", "Beto");
    const ana = await signedIn("admin", "Ana");
    const item = await runTest(seedItem({ name: "Solo de Beto en la ruta", price: 1850 }));
    await sell(beto.user, item.id, 1, "cash");
    await sell(ana.user, item.id, 3, "transfer");

    const html = await (await beto.fetch("/mi-dia")).text();

    expect(html).toContain("Mi día");
    // The screen says whose figures these are.
    expect(html).toMatch(/Solo lo que registró\s*(<!-- -->)?\s*<strong[^>]*>Beto<\/strong>/);
    expect(html).toContain("Solo de Beto en la ruta");
    expect(html).toContain("$18.50");
    expect(html).toContain("Efectivo");
    expect(html).not.toContain("$55.50");

    // A query that names another User changes nothing: there is no argument.
    const asked = await (await beto.fetch(`/mi-dia?userId=${ana.user.id}`)).text();
    expect(asked).toContain("$18.50");
    expect(asked).not.toContain("$55.50");
  });

  it("shows an Admin their own Day as well", async () => {
    const ana = await signedIn("admin", "Ana");
    const item = await runTest(seedItem({ name: "De la administradora", price: 2500 }));
    await sell(ana.user, item.id, 2, "transfer");

    const html = await (await ana.fetch("/mi-dia")).text();

    expect(html).toContain("De la administradora");
    expect(html).toContain("$50.00");
    expect(html).toContain("Transferencia");
  });
});
