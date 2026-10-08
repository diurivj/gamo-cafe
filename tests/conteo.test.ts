import { describe, expect, it } from "vitest";

import { listCounts } from "~/backend/counts";
import { listInventory, recordAdjustment } from "~/backend/inventory";

import { as, signedIn, type SignedIn } from "./support/auth";
import { seedCategory, seedItem } from "./support/catalog";
import { runTest } from "./support/effect";
import { sendCount } from "./support/sales";

// Conteo and Diferencias through the Worker (UI redesign §7): the entry step
// carries no expected numbers, the review is read from the route Conteo sends
// to and records nothing, and a Count is answered as it was recorded. The
// rules are tested in counts.test.ts, the screen's state in count.test.ts.

/** An Admin with a fresh shelf: two counted Items (47 and 12) and one untracked. */
let shelfSerial = 0;
async function shelf() {
  const serial = ++shelfSerial;
  const ana = await signedIn("admin", `Ana del conteo ${serial}`);
  const category = await runTest(seedCategory(`Conteo por la ruta ${serial}`, ana.user));
  const cafe = await runTest(
    seedItem({ name: `Café de olla ${serial}`, categoryId: category.id, startingStock: 47, by: ana.user }),
  );
  const pan = await runTest(
    seedItem({ name: `Pan dulce ${serial}`, categoryId: category.id, startingStock: 12, by: ana.user }),
  );
  const untracked = await runTest(
    seedItem({
      name: `Preparado al momento ${serial}`,
      categoryId: category.id,
      stockTracked: false,
      by: ana.user,
    }),
  );
  return { ana, cafe, pan, untracked };
}

const stockNow = (who: SignedIn, itemId: string) =>
  runTest(listInventory.pipe(as(who.user))).then((lines) => lines.find((line) => line.id === itemId)!.stock);

const countsOf = (who: SignedIn, itemId: string) =>
  runTest(listCounts(null, 100).pipe(as(who.user))).then(({ counts }) =>
    counts.filter((count) => count.lines.some((line) => line.itemId === itemId)),
  );

describe("the entry step", () => {
  it("lists Item names and no expected numbers, in its page or in its data", async () => {
    const { ana, cafe, pan, untracked } = await shelf();

    const response = await ana.fetch("/inventario/conteo");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(cafe.name);
    expect(html).toContain(pan.name);
    expect(html).not.toContain(untracked.name);
    expect(html).not.toContain("Existencias");
    expect(html).not.toContain("Esperado");
    expect(html).not.toContain('value="47"');

    // The loader data itself carries a name and nothing about Stock.
    const body = await (await ana.fetch("/inventario/conteo.data")).text();
    expect(body).toContain(cafe.name);
    expect(body).not.toContain("stock");
    expect(body).not.toContain("expected");
    expect(body).not.toContain("Existencias");
  });

  it("shows the fields, not a review, when the address asks for a review nobody read", async () => {
    const { ana, cafe } = await shelf();
    const html = await (await ana.fetch("/inventario/conteo?paso=revisar")).text();
    expect(html).toContain(cafe.name);
    expect(html).toContain("Revisar conteo");
    expect(html).not.toContain("Esperado");
  });

  it("takes no form: a Count is sent to its own route", async () => {
    const { ana, cafe } = await shelf();
    const response = await ana.fetch("/inventario/conteo", {
      method: "POST",
      body: new URLSearchParams({ intent: "registrar", [`units.${cafe.id}`]: "1" }),
    });
    expect(response.status).toBe(405);
    expect(await stockNow(ana, cafe.id)).toBe(47);
  });
});

describe("the review", () => {
  it("answers expected, found and difference, and records nothing", async () => {
    const { ana, cafe, pan } = await shelf();

    const { response, review } = await sendCount(ana, "revisar", { [cafe.id]: "45", [pan.id]: "14" });

    expect(response.status).toBe(200);
    expect(review).toEqual({
      lines: [
        { itemId: cafe.id, itemName: cafe.name, expected: 47, found: 45, difference: -2 },
        { itemId: pan.id, itemName: pan.name, expected: 12, found: 14, difference: 2 },
      ],
    });
    expect(await countsOf(ana, cafe.id)).toHaveLength(0);
    expect(await stockNow(ana, cafe.id)).toBe(47);
    expect(await stockNow(ana, pan.id)).toBe(12);
  });
});

describe("recording", () => {
  it("sets Stock to the units found and answers the Count as it was recorded", async () => {
    const { ana, cafe, pan } = await shelf();

    const { response, count } = await sendCount(
      ana,
      "registrar",
      { [cafe.id]: "45", [pan.id]: "12" },
      { note: "Conteo de la tarde" },
    );

    expect(response.status).toBe(200);
    expect(count).toMatchObject({
      lines: [
        { itemId: cafe.id, expected: 47, found: 45, difference: -2 },
        { itemId: pan.id, expected: 12, found: 12, difference: 0 },
      ],
    });
    expect(await stockNow(ana, cafe.id)).toBe(45);
    expect(await stockNow(ana, pan.id)).toBe(12);

    const html = await (await ana.fetch("/diferencias")).text();
    expect(html).toContain(`data-count-id="${count!.id}"`);
    expect(html).toContain(cafe.name);
    expect(html).toContain("Faltante: 2");
    expect(html).toContain("Sin diferencia");
    expect(html).toContain("Nota: Conteo de la tarde");
    expect(html).toContain(`Registrado por ${ana.user.name}`);
    expect(html).toContain("2 productos: 1 con faltante, 1 sin diferencia.");
  });

  it("counts only the Items that were sent: zero is a count, an empty field is not", async () => {
    const { ana, cafe, pan } = await shelf();

    const { count } = await sendCount(ana, "registrar", { [cafe.id]: "0", [pan.id]: " " });

    expect(count!.lines).toEqual([{ itemId: cafe.id, itemName: cafe.name, expected: 47, found: 0, difference: -47 }]);
    expect(await stockNow(ana, cafe.id)).toBe(0);
    expect(await stockNow(ana, pan.id)).toBe(12);
    expect(await countsOf(ana, pan.id)).toHaveLength(0);
  });

  it("records a Count with no Discrepancy like any other", async () => {
    const { ana, cafe } = await shelf();

    const { count } = await sendCount(ana, "registrar", { [cafe.id]: "47" });

    expect(count!.lines).toMatchObject([{ expected: 47, found: 47, difference: 0 }]);
    expect(await countsOf(ana, cafe.id)).toHaveLength(1);
  });

  it("expects the Stock of the moment it is recorded, not what a review showed", async () => {
    const { ana, cafe } = await shelf();
    const counted = { [cafe.id]: "45" };

    const { review } = await sendCount(ana, "revisar", counted);
    expect(review!.lines).toMatchObject([{ expected: 47, difference: -2 }]);
    // An Entrada lands between the review and the record.
    await runTest(recordAdjustment({ itemId: cafe.id, reason: "restock", units: 5 }).pipe(as(ana.user)));

    const { count } = await sendCount(ana, "registrar", counted);

    expect(count!.lines).toMatchObject([{ expected: 52, found: 45, difference: -7 }]);
    expect(await stockNow(ana, cafe.id)).toBe(45);
    expect((await countsOf(ana, cafe.id))[0]!.lines).toMatchObject([{ expected: 52, found: 45, difference: -7 }]);
  });

  it("records the same Count sent twice once, and answers both alike", async () => {
    const { ana, cafe } = await shelf();
    const send = () => sendCount(ana, "registrar", { [cafe.id]: "40" }, { note: "", submissionKey: `llave-${cafe.id}` });

    const first = await send();
    // A sale would have moved Stock in between; the repeat must not count again.
    await runTest(recordAdjustment({ itemId: cafe.id, reason: "restock", units: 3 }).pipe(as(ana.user)));
    const second = await send();

    expect([first.response.status, second.response.status]).toEqual([200, 200]);
    expect(second.count).toEqual(first.count);
    expect(await countsOf(ana, cafe.id)).toHaveLength(1);
    expect(await stockNow(ana, cafe.id)).toBe(43);
  });
});

describe("what the route cannot honour", () => {
  it("answers 400 in Spanish for units it cannot read, an empty Count and an unknown action", async () => {
    const { ana, cafe } = await shelf();

    const refuses = async (intent: string, counted: Record<string, string>, message: string) => {
      const { response, error } = await sendCount(ana, intent, counted);
      expect(response.status, JSON.stringify(counted)).toBe(400);
      expect(error, JSON.stringify(counted)).toContain(message);
    };

    for (const intent of ["revisar", "registrar"]) {
      for (const typed of ["dos", "-1", "2.5"]) {
        await refuses(intent, { [cafe.id]: typed }, "Escribe un número entero, cero o más.");
      }
      await refuses(intent, {}, "Escribe lo que contaste de al menos un producto.");
    }
    await refuses("borrar-todo", { [cafe.id]: "1" }, "No entendimos esa acción.");
    expect(await stockNow(ana, cafe.id)).toBe(47);
    expect(await countsOf(ana, cafe.id)).toHaveLength(0);
  });

  it("refuses an Item that does not count its units or does not exist, and writes nothing", async () => {
    const { ana, cafe, untracked } = await shelf();

    for (const intent of ["revisar", "registrar"]) {
      const notTracked = await sendCount(ana, intent, { [cafe.id]: "45", [untracked.id]: "1" });
      expect(notTracked.response.status, intent).toBe(400);
      expect(notTracked.error, intent).toContain("ya no lleva inventario");

      const missing = await sendCount(ana, intent, { [cafe.id]: "45", "no-existe": "1" });
      expect(missing.response.status, intent).toBe(404);
      expect(missing.error, intent).toContain("ya no existe");
    }
    expect(await stockNow(ana, cafe.id)).toBe(47);
    expect(await countsOf(ana, cafe.id)).toHaveLength(0);
  });
});

describe("a Worker", () => {
  it("is refused Conteo and Diferencias, and never reads a review or records a Count", async () => {
    const { ana, cafe } = await shelf();
    const beto = await signedIn("worker", "Beto del conteo");

    const requests: Array<[string, Promise<Response>]> = [
      ["GET /inventario/conteo", beto.fetch("/inventario/conteo")],
      ["GET /inventario/conteo.data", beto.fetch("/inventario/conteo.data")],
      ["GET /diferencias", beto.fetch("/diferencias")],
      ["GET /diferencias.data", beto.fetch("/diferencias.data")],
      ["revisar", sendCount(beto, "revisar", { [cafe.id]: "1" }).then((sent) => sent.response)],
      ["registrar", sendCount(beto, "registrar", { [cafe.id]: "1" }).then((sent) => sent.response)],
    ];

    for (const [what, request] of requests) {
      const response = await request;
      expect(response.status, what).toBe(403);
      expect(await response.text(), what).not.toContain(cafe.name);
    }
    expect(await stockNow(ana, cafe.id)).toBe(47);
    expect(await countsOf(ana, cafe.id)).toHaveLength(0);
  });
});
