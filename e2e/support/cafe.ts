import type { APIRequestContext, Page } from "@playwright/test";

import { expect, type SeededCategory, type SeededCustomer, type SeededItem, type SeededUser, type TestFixtures } from "../fixtures";

/**
 * A cafeteria with a day behind it, for a test that is about the whole app
 * and not about one screen: two Users, a menu with every kind of Stock, three
 * Customers, a Bill in each state, a correction of each kind, Adjustments and
 * a Count.
 *
 *     const cafe = await openCafe({ page, baseURL, addUser, signIn, addCategory, addItem, addCustomer, query });
 *     await signIn(cafe.beto);
 *     await page.goto(`/cuentas/${cafe.bills.open}`);
 *
 * The catalog and the Customers are rows, as the fixtures write them. Every
 * Bill, Payment, correction, Adjustment and Count is recorded by the app's
 * own routes, sent as the screens send them, so the facts and their
 * projections are the ones the operations write. It leaves the browser
 * signed in as Ana, the Admin.
 */
export interface Cafe {
  readonly ana: SeededUser;
  readonly beto: SeededUser;
  readonly categories: { readonly drinks: SeededCategory; readonly bakery: SeededCategory };
  readonly items: {
    /** Stock-tracked, well above its Minimum. */
    readonly coffee: SeededItem;
    /** Stock-tracked, under its Minimum. */
    readonly water: SeededItem;
    /** Stock-tracked, sold below zero. */
    readonly bread: SeededItem;
    /** Stock-tracked, with no Minimum, as the shelf has it. */
    readonly cookie: SeededItem;
    /** Not stock-tracked, with a long name and a large price. */
    readonly juice: SeededItem;
    readonly retired: SeededItem;
  };
  readonly customers: {
    /** Owes on an Open Bill of Beto's. */
    readonly ruiz: SeededCustomer;
    /** A long name; owes on a Bill that was corrected. */
    readonly long: SeededCustomer;
    readonly retired: SeededCustomer;
  };
  readonly bills: {
    /** Open, Familia Ruiz's, recorded by Beto: nothing paid. */
    readonly open: string;
    /** Partially paid, with a note and no Customer, recorded by Beto. */
    readonly partial: string;
    /** Paid in full in cash, recorded by Beto. */
    readonly paid: string;
    /** Voided by Ana. */
    readonly voided: string;
    /** Open, with a removed Line and a removed Payment. */
    readonly corrected: string;
  };
  /** An Adjustment that still stands, and one Ana cancelled. */
  readonly adjustments: { readonly standing: string; readonly cancelled: string };
}

type Fixtures = Pick<
  TestFixtures,
  "addUser" | "signIn" | "addCategory" | "addItem" | "addCustomer" | "query"
> & { readonly page: Page; readonly baseURL: string | undefined };

export const LONG_CUSTOMER = "María Guadalupe Hernández de la Torre";
export const LONG_ITEM = "Jugo de naranja natural grande con hielo";

/** Sends a form to one of the app's recording routes, as the screen's own `fetch` does, and reads its JSON. */
async function record<Answer>(
  request: APIRequestContext,
  baseURL: string,
  path: string,
  form: Record<string, string>,
): Promise<Answer> {
  // A non-GET request must carry the app's own Origin (workers/app.ts).
  const response = await request.post(path, { form, headers: { Origin: new URL(baseURL).origin } });
  expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
  return (await response.json()) as Answer;
}

export async function openCafe(fixtures: Fixtures): Promise<Cafe> {
  const { page, addUser, signIn, addCategory, addItem, addCustomer, query } = fixtures;
  const baseURL = fixtures.baseURL!;
  const send = <Answer>(path: string, form: Record<string, string>) =>
    record<Answer>(page.request, baseURL, path, form);

  const ana = await addUser("admin", "Ana");
  const beto = await addUser("worker", "Beto");

  const drinks = await addCategory("Bebidas");
  const bakery = await addCategory("Panadería");
  const coffee = await addItem({ name: "Café de olla", price: 2500, category: drinks, minimum: 5, stock: { units: 20, by: ana } });
  const water = await addItem({ name: "Agua mineral", price: 1850, category: drinks, minimum: 6, stock: { units: 8, by: ana } });
  const bread = await addItem({ name: "Pan dulce", price: 1200, category: bakery, stock: { units: 1, by: ana } });
  const cookie = await addItem({ name: "Galleta de nuez", price: 900, category: bakery, stock: { units: 3, by: ana } });
  const juice = await addItem({ name: LONG_ITEM, price: 123450, category: drinks, stockTracked: false });
  const retired = await addItem({ name: "Galleta de avena", price: 800, category: bakery, retired: true });

  const ruiz = await addCustomer("Familia Ruiz", { by: beto, note: "Paga los viernes" });
  const long = await addCustomer(LONG_CUSTOMER, { by: ana });
  const gone = await addCustomer("Don Pepe", { by: ana, retired: true });

  type Line = readonly [item: SeededItem, quantity: number];
  const sale = async (
    lines: ReadonlyArray<Line>,
    fields: { readonly customerId?: string; readonly note?: string; readonly pay?: { readonly method: string; readonly amount?: string } },
  ) => {
    const answer = await send<{ sale: { billId: string } }>("/vender/registrar", {
      intent: fields.pay ? "cobrar" : "dejar-abierta",
      selection: JSON.stringify(lines.map(([item, quantity]) => ({ itemId: item.id, quantity }))),
      customerId: fields.customerId ?? "",
      note: fields.note ?? "",
      billId: "",
      submissionKey: crypto.randomUUID(),
      ...(fields.pay ? { method: fields.pay.method, amount: fields.pay.amount ?? "" } : {}),
    });
    return answer.sale.billId;
  };
  const revisionOf = async (billId: string) =>
    String((await query("SELECT revision FROM bills WHERE id = ?", [billId]))[0]!.revision);
  const correct = async (billId: string, fields: Record<string, string>) =>
    send(`/cuentas/${billId}/corregir`, { ...fields, revision: await revisionOf(billId) });

  // Beto's morning: a sale paid in cash, a Bill left Open for a Customer, and
  // one with a note of which only a part was paid.
  await signIn(beto);
  const paid = await sale([[coffee, 2], [bread, 2]], { pay: { method: "cash" } });
  const open = await sale([[water, 1], [juice, 1]], { customerId: ruiz.id });
  const partial = await sale([[coffee, 1]], { note: "Mesa 4", pay: { method: "transfer", amount: "10.00" } });

  // Ana's: a Bill she voided, one she corrected, the shelf, and a Count.
  await signIn(ana);
  const voided = await sale([[water, 1]], { note: "Era una prueba" });
  await correct(voided, { intent: "cancelar-cuenta", reason: "Se registró por error" });

  const corrected = await sale([[coffee, 1], [water, 1]], { customerId: long.id });
  const [line] = await query("SELECT id FROM lines WHERE bill_id = ? AND item_id = ?", [corrected, coffee.id]);
  await correct(corrected, { intent: "quitar-linea", lineId: String(line!.id), reason: "No se lo llevó" });
  await send(`/cuentas/${corrected}/cobrar`, {
    method: "cash",
    amount: "5.00",
    revision: await revisionOf(corrected),
    submissionKey: crypto.randomUUID(),
  });
  const [payment] = await query("SELECT id FROM payments WHERE bill_id = ?", [corrected]);
  await correct(corrected, { intent: "quitar-pago", paymentId: String(payment!.id), reason: "Se cobró de más" });

  const adjust = async (item: SeededItem, reason: string, units: string, note = "") => {
    await send("/inventario/ajustar", {
      intent: "registrar",
      itemId: item.id,
      reason,
      units,
      note,
      submissionKey: crypto.randomUUID(),
    });
    const [newest] = await query("SELECT id FROM adjustments WHERE item_id = ? ORDER BY rowid DESC LIMIT 1", [item.id]);
    return String(newest!.id);
  };
  const standing = await adjust(coffee, "restock", "4", "Llegó el pedido");
  await adjust(water, "waste", "1");
  const cancelled = await adjust(coffee, "internal_use", "1");
  await send("/inventario/ajustar", { intent: "cancelar", adjustmentId: cancelled, reason: "Se anotó dos veces" });

  // One short, one over and one as expected. Pan dulce is left below zero.
  const stock = async (item: SeededItem) =>
    Number((await query("SELECT units FROM stock_levels WHERE item_id = ?", [item.id]))[0]!.units);
  await send("/inventario/conteo/registrar", {
    intent: "registrar",
    [`units.${coffee.id}`]: String((await stock(coffee)) - 2),
    [`units.${water.id}`]: String((await stock(water)) + 1),
    [`units.${cookie.id}`]: String(await stock(cookie)),
    note: "Conteo de la tarde",
    submissionKey: crypto.randomUUID(),
  });

  return {
    ana,
    beto,
    categories: { drinks, bakery },
    items: { coffee, water, bread, cookie, juice, retired },
    customers: { ruiz, long, retired: gone },
    bills: { open, partial, paid, voided, corrected },
    adjustments: { standing, cancelled },
  };
}
