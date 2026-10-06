import { Effect } from "effect";
import { expect, it } from "vitest";

import { as, landing, seedUser, signedIn, type SignedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { runTest } from "./support/effect";

/**
 * Spec §4.2: what a Worker never sees. Stock numbers, another User's totals,
 * Paid or Voided Bills outside their own activity for today, and History.
 *
 * §4.1 says the same in the matrix rows; this file reads the pages a Worker
 * *can* open and checks those things are not in them, so a screen that starts
 * rendering what a loader returned would fail even with the route gate in
 * place.
 */

const form = (fields: Record<string, string>) => ({
  method: "POST",
  body: new URLSearchParams(fields),
});

/** The Bill a Vender response recorded, from the status message it renders. */
function billIdOf(html: string, label: string): string {
  const found = /data-bill-id="([^"]+)"/.exec(html);
  expect(found, label).not.toBeNull();
  return found![1]!;
}

/** One sale through Vender, by this phone. */
async function sell(
  who: SignedIn,
  itemId: string,
  options: { intent: "dejar-abierta" | "cobrar"; amount?: string },
): Promise<string> {
  const response = await who.fetch(
    "/?index",
    form({
      intent: options.intent,
      selection: JSON.stringify([{ itemId, quantity: 1 }]),
      ...(options.amount ? { method: "cash", amount: options.amount } : {}),
    }),
  );
  // Recorded sales answer with a redirect; the page it lands on names the Bill.
  return billIdOf(await (await landing(who, response)).text(), "the sale response carries the Bill");
}

/** The distinctive words of the screens §4.1 keeps for Admins. */
const hiddenWords = [
  "Existencias",
  "Mínimo:",
  "Reponer",
  "Bajo cero",
  "Movimientos",
  "Correcciones y ajustes",
  "Por cobrar",
] as const;

it("a Worker's pages carry no Stock, no other User's totals, no History and no Paid or Voided Bills", async () => {
  const beto = await signedIn("worker", "Beto Visible");
  const carla = await signedIn("worker", "Carla Visible");
  const ana = await signedIn("admin", "Ana Visible");

  // Items are an Admin's to add; a distinctive stock number lets the pages be
  // searched for a Stock value directly.
  const [theirs, mine] = await runTest(
    Effect.gen(function* () {
      const author = yield* seedUser("admin", "Semilla Visible");
      const theirs = yield* seedItem({
        name: "Producto Visible",
        price: 2500,
        startingStock: 98765,
        by: author,
      });
      const mine = yield* seedItem({ name: "Producto Propio", price: 1000, startingStock: 4, by: author });
      return [theirs, mine] as const;
    }),
  );

  // Beto's paid sale and Carla's open one, both today and both through the
  // Worker, so Mi día has something to hide and something to show.
  const theirsBill = await sell(beto, theirs.id, { intent: "cobrar", amount: "25.00" });
  const mineBill = await sell(carla, mine.id, { intent: "dejar-abierta" });

  // ---- What a Worker sees, while her Bill is Open ----

  // Vender: the menu, and no Stock of any kind.
  const menu = await carla.fetch("/");
  expect(menu.status).toBe(200);
  const menuHtml = await menu.text();
  expect(menuHtml).toContain("Producto Propio");
  for (const word of hiddenWords) expect(menuHtml, `Vender does not say «${word}»`).not.toContain(word);
  expect(menuHtml, "Vender shows no Stock number").not.toContain("98765");
  expect(menuHtml, "Vender offers no Inventario").not.toContain("Inventario");
  expect(menuHtml, "Vender offers no Historial").not.toContain("Historial");

  // Cuentas abiertas: Carla's Open Bill is there, neither settled Bill is.
  const open = await carla.fetch("/cuentas-abiertas");
  expect(open.status).toBe(200);
  const openHtml = await open.text();
  expect(openHtml, "her own Open Bill is there").toContain(mineBill);
  expect(openHtml, "a Paid Bill is not").not.toContain(theirsBill);
  for (const word of hiddenWords) expect(openHtml, `Cuentas abiertas does not say «${word}»`).not.toContain(word);

  // Cuenta: an Open Bill is readable; another User's Paid Bill is refused.
  expect((await carla.fetch(`/cuentas/${mineBill}`)).status, "her own Open Bill").toBe(200);
  expect((await carla.fetch(`/cuentas/${theirsBill}`)).status, "another User's Paid Bill").toBe(403);

  // Mi día: Carla's own name and money, and none of Beto's.
  const mineDay = await carla.fetch("/mi-dia");
  expect(mineDay.status).toBe(200);
  const mineDayHtml = await mineDay.text();
  expect(mineDayHtml, "her own name").toContain("Carla Visible");
  expect(mineDayHtml, "her own sale").toContain("Producto Propio");
  expect(mineDayHtml, "no other User's name").not.toContain("Beto Visible");
  expect(mineDayHtml, "no other User's money").not.toContain("$25.00");
  expect(mineDayHtml, "no Stock number").not.toContain("98765");

  // The lists §4.1 reserves for Admins, each refused to a Worker's face.
  for (const path of [
    "/dia",
    "/cuentas",
    "/por-cobrar",
    "/inventario",
    "/inventario/conteo",
    "/diferencias",
    "/historial",
  ]) {
    expect((await carla.fetch(path)).status, `${path} for a Worker`).toBe(403);
  }

  // ---- An Admin voids Carla's Bill and records an Adjustment ----

  const voided = await ana.fetch(
    `/cuentas/${mineBill}`,
    form({ intent: "cancelar-cuenta", reason: "Era una prueba", revision: "0" }),
  );
  expect(voided.status, "the Admin voids Carla's Bill").toBe(302);
  const adjusted = await ana.fetch(
    "/inventario",
    form({ intent: "record-adjustment", itemId: mine.id, reason: "waste", units: "2" }),
  );
  expect(adjusted.status, "the Admin records an Adjustment").toBe(302);

  // The Voided Bill leaves her list, and its page stays out of her reach.
  const openAfter = await carla.fetch("/cuentas-abiertas");
  expect(await openAfter.text(), "the Cancelled Bill leaves her list").not.toContain(mineBill);
  expect((await carla.fetch(`/cuentas/${mineBill}`)).status, "her own Cancelled Bill").toBe(403);
});
