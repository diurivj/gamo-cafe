import type { Locator } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  chooseCustomer,
  confirmed,
  itemButton,
  leaveOpen,
  newSale,
  pay,
  review,
  select,
  selection,
  totalBar,
} from "./support/sell";

// Vender (UI redesign §5): choose the Items, review them, record a Payment or
// leave the Bill Open, and start the next sale only from the confirmed
// result. What is recorded is read from the database, not only from the
// screen. Both projects run a phone viewport (playwright.config.ts).

test("a cash sale: choose, change quantities, go back without losing anything, give change, start a clean sale", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  const agua = await addItem({ name: "Agua mineral", price: 1850, category: bebidas, stock: { units: 6, by: beto } });
  await addItem({ name: "Café de olla", price: 2500, category: bebidas, stock: { units: 4, by: beto } });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vender", level: 1 })).toBeVisible();
  // Nothing to charge yet: no way forward, and the screen says what to do.
  await expect(totalBar(page)).toHaveCount(0);
  await expect(page.getByText("Toca un producto para agregarlo.")).toBeVisible();

  // Every tap adds one unit; the quantity and the running total follow at once.
  const menu = page.getByRole("region", { name: "Bebidas" });
  await select(page, [["Agua mineral", 2], "Café de olla"]);
  await expect(menu.getByLabel("2 de Agua mineral")).toBeVisible();
  await expect(totalBar(page)).toContainText("3 productos");
  await expect(totalBar(page)).toContainText("$62.00");
  await menu.getByRole("button", { name: "Quitar uno de Agua mineral" }).click();
  await expect(totalBar(page)).toContainText("$43.50");
  await menu.getByRole("button", { name: "Agregar uno de Agua mineral" }).click();
  await expect(totalBar(page)).toContainText("$62.00");

  // Step 2 shows the selection; the payment is everything, in cash.
  await review(page);
  await expect(page).toHaveURL(/paso=cobrar/);
  await expect(page.getByRole("heading", { name: "Cobrar", level: 1 })).toBeFocused();
  await expect(selection(page)).toContainText("2 × Agua mineral");
  await expect(selection(page)).toContainText("$62.00");
  await expect(page.getByRole("radio", { name: "Efectivo" })).toBeChecked();
  await expect(page.getByRole("button", { name: "Registrar pago de $62.00" })).toBeVisible();

  // What was typed survives going back to change the Items, by the screen's
  // own way back and by the browser's.
  await page.getByLabel("Nota (opcional)").fill("Para llevar");
  await page.getByLabel("Efectivo que te entregan (opcional)").fill("100");
  await expect(page.getByText("Cambio: $38.00")).toBeVisible();
  await page.getByRole("button", { name: "Cambiar productos" }).click();
  await expect(page.getByRole("heading", { name: "Vender", level: 1 })).toBeFocused();
  await expect(page).not.toHaveURL(/paso=/);
  await expect(menu.getByLabel("2 de Agua mineral")).toBeVisible();
  await select(page, ["Café de olla"]);
  await review(page);
  await page.goBack();
  await expect(totalBar(page)).toContainText("$87.00");
  await page.goForward();
  await expect(page.getByLabel("Nota (opcional)")).toHaveValue("Para llevar");
  await expect(page.getByText("Cambio: $13.00")).toBeVisible();

  // Recorded once, with no second question; the change stays to be handed over.
  expect(await query("SELECT id FROM bills")).toHaveLength(0);
  await page.getByRole("button", { name: "Registrar pago de $87.00" }).click();
  await expect(page.getByRole("heading", { name: "Pago registrado", level: 1 })).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("$87.00 en efectivo. Cuenta pagada.");
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$13.00");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  // A Worker may not open a Paid Bill, and is not sent to one.
  await expect(page.getByRole("link", { name: "Ver cuenta" })).toHaveCount(0);

  const bills = await query("SELECT id, total, paid, state, note FROM bills");
  expect(bills).toMatchObject([{ total: 8700, paid: 8700, state: "paid", note: "Para llevar" }]);
  expect(await query("SELECT amount, method, received_by FROM payments")).toEqual([
    { amount: 8700, method: "cash", received_by: beto.id },
  ]);
  expect(await query("SELECT item_id, quantity FROM lines WHERE item_id = ?", [agua.id])).toEqual([
    { item_id: agua.id, quantity: 2 },
  ]);
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 4 }]);

  // Only Nueva venta starts another, and it starts from nothing.
  await newSale(page);
  await expect(page).not.toHaveURL(/paso=/);
  await expect(totalBar(page)).toHaveCount(0);
  await select(page, ["Agua mineral"]);
  await review(page);
  await expect(page.getByLabel("Nota (opcional)")).toHaveValue("");
  await expect(page.getByLabel("Efectivo que te entregan (opcional)")).toHaveValue("");
  expect(await query("SELECT id FROM bills")).toHaveLength(1);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a transfer sale says its method and amount, and the next sale is cash again", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const agua = await addItem({ name: "Agua mineral", price: 1850, stock: { units: 6, by: beto } });

  await page.goto("/");
  await select(page, [["Agua mineral", 2]]);
  await review(page);
  await page.getByRole("radio", { name: "Transferencia" }).check();
  await expect(page.getByRole("radio", { name: "Transferencia" })).toBeChecked();
  // The change is for cash only.
  await expect(page.getByLabel("Efectivo que te entregan (opcional)")).toHaveCount(0);
  await page.getByRole("button", { name: "Registrar pago de $37.00" }).click();

  await expect(page.getByRole("status")).toHaveText("$37.00 por transferencia. Cuenta pagada.");
  await expect(page.getByRole("region", { name: "Cambio" })).toHaveCount(0);
  expect(await query("SELECT amount, method FROM payments")).toEqual([{ amount: 3700, method: "transfer" }]);
  expect(await query("SELECT total, paid, state FROM bills")).toEqual([{ total: 3700, paid: 3700, state: "paid" }]);
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 4 }]);

  await newSale(page);
  await select(page, ["Agua mineral"]);
  await review(page);
  await expect(page.getByRole("radio", { name: "Efectivo" })).toBeChecked();
});

test("a Bill is left Open for a Customer, the next sale joins it, and paying the new selection leaves the earlier debt owed", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  const agua = await addItem({ name: "Agua mineral", price: 1850, category: bebidas, stock: { units: 6, by: beto } });
  await addItem({ name: "Café de olla", price: 2500, category: bebidas, stock: { units: 4, by: beto } });
  const ruiz = await addCustomer("Familia Ruiz", { by: beto });

  await page.goto("/");
  const billId = await leaveOpen(page, {
    items: [["Agua mineral", 2], "Café de olla"],
    customer: "Familia Ruiz",
    note: "Paga los viernes",
  });

  // Exactly what happened: a Bill left Open, and no Payment.
  await expect(page.getByRole("status")).toHaveText("No se registró ningún pago. La cuenta de Familia Ruiz debe $62.00.");
  await expect(page.getByRole("link", { name: "Ver cuenta" })).toHaveAttribute("href", `/cuentas/${billId}`);
  expect(await query("SELECT id, total, paid, state, customer_id, note FROM bills")).toEqual([
    { id: billId, total: 6200, paid: 0, state: "open", customer_id: ruiz.id, note: "Paga los viernes" },
  ]);
  expect(await query("SELECT id FROM payments")).toHaveLength(0);
  expect(
    await query("SELECT item_id, quantity, unit_price, added_by FROM lines WHERE bill_id = ?", [billId]),
  ).toEqual(expect.arrayContaining([{ item_id: agua.id, quantity: 2, unit_price: 1850, added_by: beto.id }]));
  // Stock is lowered, and no screen shows it to a Worker.
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 4 }]);

  // The same Customer pays for a new selection: it joins today's Open Bill,
  // the Payment covers the new selection only, and the Bill is not called Paid.
  expect(await pay(page, { items: ["Agua mineral"], customer: "Familia Ruiz" })).toBe(billId);
  await expect(page.getByRole("status")).toHaveText("$18.50 en efectivo. La cuenta de Familia Ruiz todavía debe $62.00.");
  await expect(page.getByRole("link", { name: "Ver cuenta" })).toBeVisible();
  expect(await query("SELECT id, total, paid, state FROM bills")).toEqual([
    { id: billId, total: 8050, paid: 1850, state: "partial" },
  ]);
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 3 }]);
});

test("a Bill with no Customer is left Open with a note, and a Customer is added from the picker", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  query,
}) => {
  await signInAs("worker");
  const panaderia = await addCategory("Panadería");
  // No Stock at all: selling is never blocked by it (ADR 0003).
  const pan = await addItem({ name: "Pan dulce", price: 1200, category: panaderia });

  await page.goto("/");
  await select(page, ["Pan dulce"]);
  await review(page);

  // "Add new" from the picker saves the Customer, and Quitar drops the choice.
  await page.getByLabel("Cliente", { exact: true }).pressSequentially("Leo");
  await page.getByRole("button", { name: "Agregar «Leo»" }).click();
  await expect(page.getByRole("group", { name: "Cliente" })).toContainText("Leo");
  await page.getByRole("button", { name: "Quitar", exact: true }).click();
  await expect(page.getByLabel("Cliente", { exact: true })).toBeVisible();

  await page.getByLabel("Nota (opcional)").fill("Se lo llevó Sofía");
  await page.getByRole("button", { name: "Dejar abierta" }).click();

  await expect(page.getByRole("heading", { name: "Cuenta abierta", level: 1 })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("No se registró ningún pago. La cuenta debe $12.00.");
  expect(await query("SELECT total, state, customer_id, note FROM bills")).toMatchObject([
    { total: 1200, state: "open", customer_id: null, note: "Se lo llevó Sofía" },
  ]);
  expect(await query("SELECT name, retired_at FROM customers")).toMatchObject([{ name: "Leo", retired_at: null }]);
  expect(await query("SELECT quantity, moved_stock FROM lines WHERE item_id = ?", [pan.id])).toHaveLength(1);
});

test("a part of the total is paid, and the rest stays owed", async ({ page, signInAs, addItem, addCustomer, query }) => {
  const ana = await signInAs("admin", "Ana");
  await addItem({ name: "Café de olla", price: 2500, stock: { units: 4, by: ana } });
  await addCustomer("Lupita", { by: ana });

  await page.goto("/");
  await select(page, ["Café de olla"]);
  await review(page);
  await chooseCustomer(page, "Lupita");
  await page.getByRole("button", { name: "Cobrar solo una parte" }).click();
  // Nothing typed yet: a tap says what is missing and sends nothing.
  await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Escribe cuánto se cobra.");
  // More than the selection is refused before it is sent: earlier debt is paid from Cuenta.
  await page.getByLabel("Monto a cobrar").fill("30");
  await expect(page.getByRole("alert")).toHaveText("El pago no puede ser mayor que el total de la selección.");
  await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
  expect(await query("SELECT id FROM bills")).toHaveLength(0);

  // The cash handed over is help for the change, never the amount recorded.
  await page.getByLabel("Monto a cobrar").fill("10");
  await page.getByLabel("Efectivo que te entregan (opcional)").fill("20");
  await expect(page.getByText("Cambio: $10.00")).toBeVisible();
  await page.getByRole("button", { name: "Registrar pago de $10.00" }).click();

  await expect(page.getByRole("heading", { name: "Pago registrado", level: 1 })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("$10.00 en efectivo. La cuenta de Lupita todavía debe $15.00.");
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$10.00");
  expect(await query("SELECT amount, method FROM payments")).toEqual([{ amount: 1000, method: "cash" }]);
  expect(await query("SELECT total, paid, state FROM bills")).toEqual([{ total: 2500, paid: 1000, state: "partial" }]);

  // An Admin may open any Bill, so the way to it is offered.
  await page.getByRole("link", { name: "Ver cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Cuenta", level: 1 })).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("Items are added to the Open Bill Cuenta sent the User from, which stays in sight and takes no Customer or note", async ({
  page,
  signInAs,
  addItem,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const agua = await addItem({ name: "Agua mineral", price: 1850, stock: { units: 6, by: beto } });
  await addItem({ name: "Café de olla", price: 2500, category: agua.category });
  await addCustomer("Familia Ruiz", { by: beto });

  await page.goto("/");
  const billId = await leaveOpen(page, { items: ["Agua mineral"], customer: "Familia Ruiz" });
  await page.getByRole("link", { name: "Ver cuenta" }).click();
  await page.getByRole("link", { name: "Agregar productos" }).click();
  await expect(page).toHaveURL(new RegExp(`billId=${billId}`));

  const target = page.getByRole("region", { name: "Cuenta destino" });
  await expect(target).toContainText("Se agrega a la cuenta de Familia Ruiz");
  await expect(target).toContainText("Debe $18.50");
  await select(page, ["Café de olla"]);
  await review(page);
  await expect(page.getByRole("heading", { name: "Agregar a la cuenta", level: 1 })).toBeVisible();
  await expect(target).toContainText("Se agrega a la cuenta de Familia Ruiz");
  await expect(page.getByLabel("Cliente", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Nota (opcional)")).toHaveCount(0);
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();

  await expect(page.getByRole("heading", { name: "Productos agregados", level: 1 })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("No se registró ningún pago. La cuenta de Familia Ruiz debe $43.50.");
  expect(await confirmed(page).getAttribute("data-bill-id")).toBe(billId);
  expect(await query("SELECT id, total, paid, state FROM bills")).toEqual([
    { id: billId, total: 4350, paid: 0, state: "open" },
  ]);

  // Back on Cuenta both Lines are there.
  await page.getByRole("link", { name: "Volver a la cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Cuenta", level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("1 × Café de olla");

  // Paying for what is added pays that and no more: the Bill still owes the rest.
  await page.getByRole("link", { name: "Agregar productos" }).click();
  await select(page, ["Agua mineral"]);
  await review(page);
  await page.getByRole("button", { name: "Registrar pago de $18.50" }).click();
  await expect(page.getByRole("status")).toHaveText("$18.50 en efectivo. La cuenta de Familia Ruiz todavía debe $43.50.");
  expect(await query("SELECT total, paid, state FROM bills")).toEqual([{ total: 6200, paid: 1850, state: "partial" }]);

  // Nueva venta is a new sale, not more for that Bill.
  await page.getByRole("button", { name: "Nueva venta" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(target).toHaveCount(0);
  await select(page, ["Agua mineral"]);
  await review(page);
  await expect(page.getByRole("button", { name: "Dejar abierta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Agregar a la cuenta" })).toHaveCount(0);
});

test("Items are found by search and by Category, each Category with its drawing when one fits", async ({
  page,
  signInAs,
  addCategory,
  addItem,
}) => {
  await signInAs("worker");
  const bebidas = await addCategory("Bebidas");
  const papeleria = await addCategory("Papelería");
  await addItem({ name: "Agua mineral", price: 1850, category: bebidas });
  await addItem({ name: "Café de olla", price: 2500, category: bebidas });
  await addItem({ name: "Lápiz", price: 500, category: papeleria });

  await page.goto("/");
  // A drawing beside the name it fits; a Category with none works the same.
  await expect(page.getByRole("heading", { name: "Bebidas" }).locator("svg")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Papelería" }).locator("svg")).toHaveCount(0);

  // Search ignores case and accents, across Categories.
  await page.getByLabel("Buscar producto").fill("LAPIZ");
  await expect(itemButton(page, "Lápiz")).toBeVisible();
  await expect(itemButton(page, "Agua mineral")).toHaveCount(0);
  await page.getByLabel("Buscar producto").fill("nada de esto");
  await expect(page.getByText("Ningún producto coincide.")).toBeVisible();
  await page.getByLabel("Buscar producto").fill("");

  // One Category at a time, and all of them again.
  const filter = page.getByRole("group", { name: "Categoría" });
  await expect(filter.getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "true");
  await filter.getByRole("button", { name: "Papelería" }).click();
  await expect(filter.getByRole("button", { name: "Papelería" })).toHaveAttribute("aria-pressed", "true");
  await expect(itemButton(page, "Lápiz")).toBeVisible();
  await expect(itemButton(page, "Café de olla")).toHaveCount(0);

  // What is selected stays selected while it is filtered out of sight.
  await select(page, ["Lápiz"]);
  await filter.getByRole("button", { name: "Bebidas" }).click();
  await select(page, ["Café de olla"]);
  await expect(totalBar(page)).toContainText("2 productos");
  await expect(totalBar(page)).toContainText("$30.00");
  await filter.getByRole("button", { name: "Todas" }).click();
  await expect(page.getByLabel("1 de Lápiz")).toBeVisible();
});

test("Vender does not offer a retired Item", async ({ page, signInAs, addItem, query }) => {
  await signInAs("worker");
  const active = await addItem({ name: "Activo en Vender" });
  const retired = await addItem({ name: "Retirado de Vender", category: active.category });
  await query("UPDATE items SET retired_at = ? WHERE id = ?", [Date.now(), retired.id]);

  await page.goto("/");

  await expect(itemButton(page, "Activo en Vender")).toBeVisible();
  await expect(itemButton(page, "Retirado de Vender")).toHaveCount(0);
});

test("without a menu Vender says who can add one", async ({ page, signInAs }) => {
  await signInAs("worker");
  await page.goto("/");

  await expect(page.getByText("Todavía no hay productos. Pídele a un administrador que agregue el menú.")).toBeVisible();
  await expect(page.getByLabel("Buscar producto")).toHaveCount(0);
});

test("a sale is made with the keyboard alone, the focus in sight at every stop", async ({
  page,
  signInAs,
  addItem,
  query,
  browserName,
}) => {
  await signInAs("worker", "Beto");
  const agua = await addItem({ name: "Agua mineral", price: 1850 });
  await addItem({ name: "Café de olla", price: 2500, category: agua.category });
  await page.goto("/");

  // Safari stops at links and buttons with Option+Tab unless its setting says otherwise.
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  /** Tabs forward until the control has the focus, and it is then whole on screen. */
  const tabTo = async (control: Locator) => {
    for (let stops = 0; stops < 40; stops++) {
      if (await control.evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press(tab);
    }
    await expect(control).toBeFocused();
    await expect(control).toBeInViewport({ ratio: 1 });
  };

  // Two units of one Item and one of another, then on to the review.
  await tabTo(itemButton(page, "Agua mineral"));
  await page.keyboard.press("Enter");
  await tabTo(page.getByRole("button", { name: "Agregar uno de Agua mineral" }));
  await page.keyboard.press("Space");
  await tabTo(itemButton(page, "Café de olla"));
  await page.keyboard.press("Enter");
  await expect(totalBar(page)).toContainText("$62.00");
  await tabTo(totalBar(page).getByRole("button", { name: "Cobrar" }));
  await page.keyboard.press("Enter");

  // The step's heading has the focus; the method is chosen with the arrows.
  await expect(page.getByRole("heading", { name: "Cobrar", level: 1 })).toBeFocused();
  await tabTo(page.getByRole("radio", { name: "Efectivo" }));
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "Transferencia" })).toBeChecked();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("radio", { name: "Efectivo" })).toBeChecked();
  await tabTo(page.getByLabel("Efectivo que te entregan (opcional)"));
  await page.keyboard.type("100");
  await expect(page.getByText("Cambio: $38.00")).toBeVisible();
  await tabTo(page.getByRole("button", { name: "Registrar pago de $62.00" }));
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Pago registrado", level: 1 })).toBeFocused();
  expect(await query("SELECT total, paid, state FROM bills")).toEqual([{ total: 6200, paid: 6200, state: "paid" }]);
  await tabTo(page.getByRole("button", { name: "Nueva venta" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Vender", level: 1 })).toBeFocused();
});
