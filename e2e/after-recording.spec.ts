import type { Page, Route } from "@playwright/test";

import { expect, test } from "./fixtures";
import { openCorrection, openPay, typePayment } from "./support/bill";
import { openCafe } from "./support/cafe";
import { openAbonar } from "./support/customer";
import { recordCount, reviewCount, typeCount } from "./support/count";
import { destinations } from "./support/navigate";
import { openAdjustments, openCancel, typeAdjustment } from "./support/stock";

// UI redesign §6.1, for every screen that records with `sendForRecord` besides
// Vender (whose own case is in e2e/vender-recovery.spec.ts): a confirmed
// result needs no read, so a phone that can read nothing still shows it; and
// when the read the User then asks for fails — or, for a Payment that closes
// its Bill, the read of Inicio it leads to — what is shown in its place still
// says what was recorded, repeats nothing, and gives way to the record once it
// can be read.
// The second half is the double tap on the two actions that carry no
// submission key, a correction and a cancellation: one request, one fact.

const title = (page: Page, name: string | RegExp) => page.getByRole("heading", { name, level: 1 });

/** From here on no page data can be read; answers what was asked for, and the way to let reads through again. */
async function unreadable(page: Page) {
  const reads: string[] = [];
  const fail = (route: Route) => {
    reads.push(new URL(route.request().url()).pathname);
    return route.abort("connectionfailed");
  };
  await page.route("**/*.data*", fail);
  return { reads, readable: () => page.unroute("**/*.data*", fail) };
}

/**
 * The read a User asks for after a result fails: the screen that stands in
 * says so inside the navigation, still says what was recorded, and the same
 * address shows the record once it can be read.
 */
async function failsThenShows(
  page: Page,
  connection: Awaited<ReturnType<typeof unreadable>>,
  recorded: string | RegExp,
  shows: string | RegExp,
) {
  await expect(title(page, "Algo salió mal")).toBeVisible();
  const main = page.getByRole("main");
  // The result that was on screen is not taken back, and nothing is to be repeated.
  await expect(main.getByRole("status")).toContainText(recorded);
  await expect(main).toContainText("Eso quedó registrado: no lo repitas.");
  await expect(main).not.toContainText(/puede que|no se (guardó|registró)/i);
  await expect(destinations(page)).toBeVisible();
  expect(connection.reads.length).toBeGreaterThan(0);
  await connection.readable();
  await main.getByRole("link", { name: "Volver a intentar" }).click();
  await expect(title(page, shows)).toBeVisible();
}

test("Cuenta's Payment and correction stay confirmed with every read failing, and the Bill is read when it can be", async ({
  page,
  baseURL,
  addUser,
  signIn,
  addCategory,
  addItem,
  addCustomer,
  query,
}) => {
  const cafe = await openCafe({ page, baseURL, addUser, signIn, addCategory, addItem, addCustomer, query });
  const paymentsOf = (billId: string) =>
    query("SELECT amount FROM payments WHERE bill_id = ? AND id NOT IN (SELECT payment_id FROM payment_removals)", [billId]);

  // A Payment: $1,253.00 are owed, and $20.00 of them are paid.
  await page.goto(`/cuentas/${cafe.bills.open}`);
  await openPay(page);
  await typePayment(page, { amount: "20", handed: "50" });
  let connection = await unreadable(page);
  await page.getByRole("button", { name: "Registrar pago de $20.00" }).click();
  await expect(title(page, "Pago registrado")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("$20.00 en efectivo. La cuenta de Familia Ruiz todavía debe $1,233.00.");
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$30.00");
  // Nothing was read to say so.
  expect(connection.reads).toEqual([]);
  expect(await paymentsOf(cafe.bills.open)).toEqual([{ amount: 2000 }]);

  await page.getByRole("button", { name: "Ver cuenta" }).click();
  await failsThenShows(page, connection, "Pago registrado. $20.00 en efectivo.", "Cuenta");
  await expect(page.getByRole("region", { name: "Resumen" })).toContainText("$1,233.00");
  expect(await paymentsOf(cafe.bills.open)).toEqual([{ amount: 2000 }]);

  // A correction: that Payment is taken back, with its reason.
  await openCorrection(page, "Quitar pago de $20.00", "Quitar pago");
  await page.getByLabel("Motivo").fill("Se cobró a otra cuenta");
  connection = await unreadable(page);
  await page.getByRole("button", { name: "Quitar pago de $20.00", exact: true }).click();
  await expect(title(page, "Pago quitado")).toBeVisible();
  expect(connection.reads).toEqual([]);
  expect(await query("SELECT reason FROM payment_removals WHERE reason = 'Se cobró a otra cuenta'")).toHaveLength(1);

  await page.getByRole("button", { name: "Ver cuenta" }).click();
  await failsThenShows(page, connection, /^Pago quitado\./, "Cuenta");
  await expect(page.getByRole("region", { name: "Resumen" })).toContainText("$1,253.00");
  expect(await paymentsOf(cafe.bills.open)).toEqual([]);
  expect(await query("SELECT reason FROM payment_removals WHERE reason = 'Se cobró a otra cuenta'")).toHaveLength(1);
});

test("a Payment that closes its Bill is still said, change included, when Inicio cannot be read", async ({
  page,
  baseURL,
  addUser,
  signIn,
  addCategory,
  addItem,
  addCustomer,
  query,
}) => {
  const cafe = await openCafe({ page, baseURL, addUser, signIn, addCategory, addItem, addCustomer, query });

  // Everything Familia Ruiz's Bill owes, $1,253.00, with $1,300.00 handed over.
  await page.goto(`/cuentas/${cafe.bills.open}`);
  await openPay(page);
  await typePayment(page, { handed: "1300" });
  const connection = await unreadable(page);
  await page.getByRole("button", { name: "Registrar pago de $1,253.00" }).click();

  // The Bill is closed and Inicio is read for the User: the one read there
  // is, and it fails. What stands in still says what was recorded, and the
  // change to hand over is still in sight.
  await expect(title(page, "Algo salió mal")).toBeVisible();
  expect(connection.reads).toEqual(["/inicio.data"]);
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$47.00");
  await failsThenShows(
    page,
    connection,
    "Cuenta pagada y cerrada. $1,253.00 en efectivo. La cuenta de Familia Ruiz ya no debe nada.",
    /^Hola, /,
  );
  expect(await query("SELECT amount FROM payments WHERE bill_id = ?", [cafe.bills.open])).toEqual([{ amount: 125300 }]);
});

test("an Abonar stays confirmed with every read failing, and the Customer is read when they can be", async ({
  page,
  baseURL,
  addUser,
  signIn,
  addCategory,
  addItem,
  addCustomer,
  query,
}) => {
  const cafe = await openCafe({ page, baseURL, addUser, signIn, addCategory, addItem, addCustomer, query });
  await signIn(cafe.beto);
  await page.goto(`/clientes/${cafe.customers.ruiz.id}`);
  await openAbonar(page);
  await typePayment(page, { amount: "53", method: "Transferencia" });
  const connection = await unreadable(page);
  await page.getByRole("button", { name: "Registrar abono de $53.00" }).click();

  await expect(title(page, "Abono registrado")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("$53.00 por transferencia, en 1 cuenta. Familia Ruiz todavía debe $1,200.00.");
  expect(connection.reads).toEqual([]);

  await page.getByRole("button", { name: "Ver cliente" }).click();
  await failsThenShows(page, connection, "Abono registrado. $53.00 por transferencia", "Familia Ruiz");
  await expect(page.getByRole("region", { name: "Resumen" })).toContainText("$1,200.00");
  expect(await query("SELECT amount, method FROM payments WHERE bill_id = ?", [cafe.bills.open])).toEqual([
    { amount: 5300, method: "transfer" },
  ]);
});

test("an Adjustment, its cancellation and a Count stay confirmed with every read failing, and Stock is read when it can be", async ({
  page,
  baseURL,
  addUser,
  signIn,
  addCategory,
  addItem,
  addCustomer,
  query,
}) => {
  const cafe = await openCafe({ page, baseURL, addUser, signIn, addCategory, addItem, addCustomer, query });
  const stockOf = async (itemId: string) =>
    Number((await query("SELECT units FROM stock_levels WHERE item_id = ?", [itemId]))[0]!.units);
  const cookies = cafe.items.cookie;
  const before = await stockOf(cookies.id);

  // An Adjustment.
  await page.goto("/inventario?paso=ajustar");
  await typeAdjustment(page, { item: "Galleta de nuez", units: "4" });
  let connection = await unreadable(page);
  await page.getByRole("button", { name: "Registrar entrada de 4" }).click();
  await expect(title(page, "Entrada registrada")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(`+4 de Galleta de nuez. Existencias: ${before + 4}.`);
  expect(connection.reads).toEqual([]);
  await page.getByRole("button", { name: "Volver a Inventario" }).click();
  await failsThenShows(page, connection, "Entrada registrada. +4 de Galleta de nuez.", "Inventario");
  expect(await stockOf(cookies.id)).toBe(before + 4);
  expect(await query("SELECT units FROM adjustments WHERE item_id = ? AND units = 4", [cookies.id])).toHaveLength(1);

  // Its cancellation.
  await openAdjustments(page);
  await openCancel(page, "Entrada de 4 de Galleta de nuez");
  await page.getByLabel("Motivo de la cancelación").fill("No llegó el pedido");
  connection = await unreadable(page);
  await page.getByRole("button", { name: "Cancelar entrada de 4" }).click();
  await expect(title(page, "Ajuste cancelado")).toBeVisible();
  expect(connection.reads).toEqual([]);
  await page.getByRole("button", { name: "Volver a Inventario" }).click();
  await failsThenShows(page, connection, /^Ajuste cancelado\./, "Inventario");
  expect(await stockOf(cookies.id)).toBe(before);

  // A Count.
  const counts = async () => Number((await query("SELECT COUNT(*) AS n FROM counts"))[0]!.n);
  const counted = await counts();
  await page.goto("/inventario/conteo");
  await typeCount(page, { "Galleta de nuez": "1" });
  await reviewCount(page);
  connection = await unreadable(page);
  await recordCount(page);
  expect(connection.reads).toEqual([]);
  await page.getByRole("link", { name: "Volver a Inventario" }).click();
  await failsThenShows(page, connection, /^Conteo registrado\./, "Inventario");
  expect(await counts()).toBe(counted + 1);
  expect(await stockOf(cookies.id)).toBe(1);
});

test("a double tap on a correction and on a cancellation sends each once and records each once", async ({
  page,
  baseURL,
  addUser,
  signIn,
  addCategory,
  addItem,
  addCustomer,
  query,
}) => {
  const cafe = await openCafe({ page, baseURL, addUser, signIn, addCategory, addItem, addCustomer, query });
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") sent.push(new URL(request.url()).pathname);
  });
  /** Twice in the same instant, before the screen can take the button away. */
  const twice = (name: string) =>
    page.getByRole("button", { name, exact: true }).evaluate((button: HTMLElement) => {
      button.click();
      button.click();
    });

  await page.goto(`/cuentas/${cafe.bills.partial}`);
  await openCorrection(page, "Cancelar esta cuenta", "Cancelar cuenta");
  await page.getByLabel("Motivo").fill("Se abrió dos veces");
  await twice("Cancelar cuenta");
  await expect(title(page, "Cuenta cancelada")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(sent).toEqual([`/cuentas/${cafe.bills.partial}/corregir`]);
  expect(await query("SELECT reason FROM bill_voids WHERE bill_id = ?", [cafe.bills.partial])).toEqual([
    { reason: "Se abrió dos veces" },
  ]);

  const coffee = async () =>
    Number((await query("SELECT units FROM stock_levels WHERE item_id = ?", [cafe.items.coffee.id]))[0]!.units);
  const before = await coffee();
  await page.goto(`/inventario?paso=cancelar&ajuste=${cafe.adjustments.standing}`);
  await page.getByLabel("Motivo de la cancelación").fill("Se anotó en otro producto");
  await twice("Cancelar entrada de 4");
  await expect(title(page, "Ajuste cancelado")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(sent).toEqual([`/cuentas/${cafe.bills.partial}/corregir`, "/inventario/ajustar"]);
  // The Entrada of 4 is taken back once.
  expect(await coffee()).toBe(before - 4);
});
