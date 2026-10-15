import type { Page } from "@playwright/test";

import { verifyProjectionsSql } from "../app/backend/rebuild.ts";
import { dayOf, formatDay } from "../app/shared/day.ts";
import { expect, test } from "./fixtures";
import { backToBill, closedNotice, payBill, payInFull, removeLine, removePayment, seeBill, voidBill } from "./support/bill";
import { addItemOnScreen, catalogItem, typeItem } from "./support/catalog";
import { expectLine, recordCount, recorded, reviewCount, typeCount } from "./support/count";
import { abonar, seeCustomer } from "./support/customer";
import { expectFigures } from "./support/figures";
import { destinations, goTo } from "./support/navigate";
import { leaveOpen, pay } from "./support/sell";
import { adjust, expectStock, seeStock, stockRow } from "./support/stock";
import { anotherPhone, enterCode, openNewUser, openUser, said as saidOnUsers, shownCode } from "./support/users";

// UI redesign §10.1, read across the screens instead of one at a time: one
// day at the cafeteria on two phones, an Admin's and a Worker's. Every step
// goes by the navigation a User has, and what one screen records is read on
// the screens that depend on it: a sale in the figures and the Stock, a debt
// in Cuentas abiertas and Por cobrar, a correction in Historial and the
// figures, the catalog on Vender, a Count in Diferencias, a role in the
// navigation. It ends on the facts: what the tables hold, and that every
// projection is what the facts add up to.
//
// Each screen's own rules, and what happens when a request is held, lost or
// refused, are in that screen's spec.

const title = (page: Page, name: string | RegExp) => page.getByRole("heading", { name, level: 1 });
/** The figures of Mi día, and those of Día, which are named by the Day they are about. */
const summary = (page: Page) => page.getByRole("region", { name: "Resumen" });
const today = (page: Page) => page.getByRole("region", { name: formatDay(dayOf(Date.now())) });
const bills = (page: Page) => page.getByRole("list", { name: "Cuentas abiertas" }).getByRole("listitem");

test("a day at the cafe: what each screen records is what the others then show", async ({
  page,
  browser,
  baseURL,
  addUser,
  issueCode,
  addCategory,
  addCustomer,
  query,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(10_000);

  // --- Ana signs in with a code, and puts the menu in the catalog.
  const ana = await addUser("admin", "Ana");
  await addCategory("Bebidas");
  await addCustomer("Familia Ruiz", { by: ana });
  await page.goto("/");
  await page.getByLabel("Código de acceso").fill(await issueCode(ana));
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(title(page, "Hola, Ana")).toBeVisible();

  await goTo(page, "Productos");
  await addItemOnScreen(page, { name: "Agua mineral", price: "18.50", minimum: "6", stock: "10" });
  await addItemOnScreen(page, { name: "Café de olla", price: "25", stock: "10" });

  // --- She adds Beto, and the code she is shown opens the app on his phone.
  await goTo(page, "Usuarios");
  await openNewUser(page);
  await page.getByLabel("Nombre").fill("Beto");
  await page.getByRole("button", { name: "Agregar y dar código" }).click();
  const beto = await anotherPhone(browser, baseURL);
  beto.on("pageerror", (error) => errors.push(error.message));
  beto.setDefaultTimeout(10_000);
  await enterCode(beto, await shownCode(page, "Beto"));
  await expect(title(beto, "Hola, Beto")).toBeVisible();
  await expect(destinations(beto).getByRole("link")).toHaveText(["Inicio", "Vender", "Cuentas", "Más"]);

  // --- Beto sells what Ana just added: cash with change, a transfer, and a Bill left Open.
  await beto.getByRole("main").getByRole("link", { name: /Nueva venta/ }).click();
  await pay(beto, { items: [["Agua mineral", 2], "Café de olla"], handed: "100" });
  await expect(beto.getByRole("region", { name: "Cambio" })).toContainText("$38.00");
  await pay(beto, { items: ["Café de olla"], method: "Transferencia" });
  await expect(beto.getByRole("status")).toHaveText("$25.00 por transferencia. Cuenta pagada.");
  await leaveOpen(beto, { items: [["Agua mineral", 2]], customer: "Familia Ruiz" });

  // His own figures say it, and Inicio carries them.
  await goTo(beto, "Mi día");
  await expectFigures(summary(beto), { cobrado: "$87.00", efectivo: "$62.00", transferencia: "$25.00", vendido: "$124.00" });
  await goTo(beto, "Inicio");
  await expect(beto.getByRole("main").getByRole("link", { name: /Cobraste hoy/ })).toContainText("$87.00");
  await expect(beto.getByRole("main").getByRole("link", { name: /Cuentas abiertas/ })).toContainText("$37.00");

  // Ana sees the same Day, the debt apart from it, and the Stock that left the shelf.
  await goTo(page, "Día");
  await expectFigures(today(page), { cobrado: "$87.00", efectivo: "$62.00", transferencia: "$25.00", vendido: "$124.00" });
  await goTo(page, "Por cobrar");
  await expect(page.locator('[data-figure="owed"]')).toHaveText("$37.00");
  await goTo(page, "Inventario");
  await expectStock(page, "Agua mineral", 6);
  await expectStock(page, "Café de olla", 8);
  // At its Minimum: said in words.
  await expect(stockRow(page, "Agua mineral")).toContainText("Reponer");

  // --- Beto finds the Open Bill and takes a part; the rest is an Abonar on the Customer.
  await goTo(beto, "Cuentas");
  await beto.getByLabel("Buscar por cliente").fill("familia r");
  await expect(beto).toHaveURL(/q=familia\+r/);
  await expect(bills(beto)).toHaveCount(1);
  await bills(beto).getByRole("link").click();
  await payBill(beto, { amount: "10" });
  await expect(beto.getByRole("status")).toHaveText("$10.00 en efectivo. La cuenta de Familia Ruiz todavía debe $27.00.");
  await goTo(beto, "Clientes");
  await beto.getByRole("list", { name: "Clientes" }).getByRole("link", { name: /Familia Ruiz/ }).click();
  await abonar(beto, { method: "Transferencia" });
  await expect(beto.getByRole("status")).toHaveText("$27.00 por transferencia, en 1 cuenta. Familia Ruiz ya no debe nada.");
  await seeCustomer(beto, "Familia Ruiz");
  await goTo(beto, "Cuentas");
  await expect(bills(beto)).toHaveCount(0);
  await goTo(page, "Por cobrar");
  await expect(page.locator('[data-figure="owed"]')).toHaveText("$0.00");

  // --- A Bill with a wrong Line: Beto takes the Line off, Ana collects, then takes the Payment back and voids it.
  await goTo(beto, "Vender");
  const wrong = await leaveOpen(beto, { items: ["Café de olla", "Agua mineral"], note: "Mesa 2" });
  await beto.getByRole("main").getByText("Ver cuenta", { exact: true }).click();
  await expect(title(beto, "Cuenta")).toBeVisible();
  await removeLine(beto, "1 × Café de olla");

  await goTo(page, "Cuentas abiertas");
  await page.getByRole("list", { name: "Cuentas abiertas" }).getByRole("link", { name: /Mesa 2/ }).click();
  await expect(title(page, "Cuenta")).toBeVisible();
  // Paid in full, the Bill is closed and Ana lands on Inicio; Back is the Bill.
  await payInFull(page);
  await expect(closedNotice(page)).toHaveText("Cuenta pagada y cerrada. $18.50 en efectivo. La cuenta ya no debe nada.");
  await backToBill(page);
  await removePayment(page, "$18.50", "Se cobró a la mesa equivocada");
  await seeBill(page);
  await voidBill(page, "La mesa no consumió nada");

  // Historial has each correction with who made it and why; the figures count none of that Bill.
  await goTo(page, "Historial");
  const history = page.getByRole("main");
  await expect(history).toContainText("Producto quitado");
  await expect(history).toContainText("Pago quitado");
  await expect(history).toContainText("Se cobró a la mesa equivocada");
  await expect(history).toContainText("Cuenta cancelada");
  await expect(history).toContainText("La mesa no consumió nada");
  await goTo(page, "Día");
  await expectFigures(today(page), { cobrado: "$124.00", efectivo: "$72.00", transferencia: "$52.00", vendido: "$124.00" });
  await goTo(beto, "Mi día");
  await expectFigures(summary(beto), { cobrado: "$124.00", efectivo: "$72.00", transferencia: "$52.00", vendido: "$124.00" });
  // What the removed Line and the Voided Bill took off the shelf is back on it.
  await goTo(page, "Inventario");
  await expectStock(page, "Agua mineral", 6);
  await expectStock(page, "Café de olla", 8);

  // --- Ana restocks, counts, and reads the Discrepancy.
  await adjust(page, { item: "Agua mineral", units: "12" });
  await seeStock(page);
  await expectStock(page, "Agua mineral", 18);
  await page.getByRole("link", { name: "Contar existencias" }).click();
  await expect(title(page, "Conteo")).toBeVisible();
  await typeCount(page, { "Agua mineral": "17", "Café de olla": "8" });
  await reviewCount(page);
  await recordCount(page);
  await expectLine(recorded(page, "Agua mineral"), { expected: 18, found: 17, discrepancy: "Faltante: 1" });
  await page.getByRole("link", { name: "Ver diferencias" }).click();
  await expect(title(page, "Diferencias")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Faltante: 1");
  await expect(page.getByRole("main")).toContainText("Sin diferencia");
  await goTo(page, "Inventario");
  await expectStock(page, "Agua mineral", 17);

  // --- A new price reaches Beto's next sale, and no Bill already recorded.
  await goTo(page, "Productos");
  await catalogItem(page, "Café de olla").click();
  await typeItem(page, { price: "30" });
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Cambios guardados.");
  await goTo(beto, "Vender");
  await pay(beto, { items: ["Café de olla"] });
  await expect(beto.getByRole("status")).toHaveText("$30.00 en efectivo. Cuenta pagada.");
  await goTo(page, "Día");
  await expectFigures(today(page), { cobrado: "$154.00", efectivo: "$102.00", transferencia: "$52.00", vendido: "$154.00" });

  // --- Beto's access changes under him: an Admin's navigation, a Worker's again, and then none.
  await goTo(page, "Usuarios");
  await openUser(page, "Beto");
  const role = page.getByRole("region", { name: "Rol" });
  await role.getByRole("button", { name: "Hacer administrador" }).click();
  await expect(saidOnUsers(page)).toHaveText("Ahora es Administrador.");
  await goTo(beto, "Inicio");
  await expect(destinations(beto).getByRole("link")).toHaveText(["Inicio", "Vender", "Día", "Más"]);
  await goTo(beto, "Día");
  await expectFigures(today(beto), { cobrado: "$154.00", efectivo: "$102.00", transferencia: "$52.00", vendido: "$154.00" });

  await role.getByRole("button", { name: "Hacer empleado" }).click();
  await expect(saidOnUsers(page)).toHaveText("Ahora es Empleado.");
  await beto.getByRole("link", { name: "Por cobrar" }).click();
  await expect(beto.getByText("No tienes acceso a esta página")).toBeVisible();
  await expect(destinations(beto).getByRole("link")).toHaveText(["Inicio", "Vender", "Cuentas", "Más"]);

  await page.getByRole("button", { name: "Desactivar usuario" }).click();
  await expect(saidOnUsers(page)).toHaveText("Usuario desactivado. Ya no puede entrar.");
  await destinations(beto).getByRole("link", { name: "Vender", exact: true }).click();
  await expect(beto.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await expect(beto.getByRole("status")).toHaveText("Tu sesión terminó. Entra con un código nuevo.");
  await beto.context().close();

  // --- The facts: each thing once, by who did it, and every projection what the facts add up to.
  const betoId = (await query("SELECT id FROM users WHERE name = 'Beto'"))[0]!.id;
  expect(await query("SELECT state, total, paid FROM bills ORDER BY rowid")).toEqual([
    { state: "paid", total: 6200, paid: 6200 },
    { state: "paid", total: 2500, paid: 2500 },
    { state: "paid", total: 3700, paid: 3700 },
    { state: "voided", total: 1850, paid: 0 },
    { state: "paid", total: 3000, paid: 3000 },
  ]);
  expect(await query("SELECT amount, method, received_by = ? AS betos FROM payments ORDER BY rowid", [String(betoId)])).toEqual([
    { amount: 6200, method: "cash", betos: 1 },
    { amount: 2500, method: "transfer", betos: 1 },
    { amount: 1000, method: "cash", betos: 1 },
    { amount: 2700, method: "transfer", betos: 1 },
    { amount: 1850, method: "cash", betos: 0 },
    { amount: 3000, method: "cash", betos: 1 },
  ]);
  expect(await query("SELECT unit_price FROM lines WHERE bill_id != ? AND item_id = (SELECT id FROM items WHERE name = 'Café de olla') ORDER BY rowid", [wrong])).toEqual([
    { unit_price: 2500 },
    { unit_price: 2500 },
    { unit_price: 3000 },
  ]);
  expect(await query("SELECT i.name, s.units FROM stock_levels s JOIN items i ON i.id = s.item_id ORDER BY i.name")).toEqual([
    { name: "Agua mineral", units: 17 },
    { name: "Café de olla", units: 7 },
  ]);
  expect(await query(verifyProjectionsSql)).toEqual([]);
  expect(errors).toEqual([]);
});
