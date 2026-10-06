import { expect, test } from "./fixtures";

// Flow §8.2: build a selection, choose the Customer, tap Dejar abierta, and
// the Lines go onto the Customer's Open Bill for today. Both projects run a
// phone viewport (playwright.config.ts).

test("a Worker leaves a sale open for a Customer, and the next sale joins the same Bill", async ({
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
  await expect(page.getByRole("heading", { name: "Vender", level: 1 })).toBeVisible();

  // Every tap adds one unit, and the selection shows the running total.
  const menu = page.getByRole("region", { name: "Bebidas" });
  await menu.getByRole("button", { name: /Agua mineral/ }).click();
  await menu.getByRole("button", { name: /Agua mineral/ }).click();
  await menu.getByRole("button", { name: /Café de olla/ }).click();

  const selection = page.getByRole("region", { name: "Selección" });
  await expect(selection).toContainText("Total");
  await expect(selection).toContainText("$62.00");
  await selection.getByRole("button", { name: "Quitar uno de Agua mineral" }).click();
  await expect(selection).toContainText("$43.50");
  await selection.getByRole("button", { name: "Agregar uno de Agua mineral" }).click();
  await expect(selection).toContainText("$62.00");

  // Choosing the Customer: matches appear while the name is typed.
  await page.getByLabel("Cliente", { exact: true }).pressSequentially("Fam");
  await page.getByRole("list", { name: "Coincidencias" }).getByRole("button", { name: "Familia Ruiz" }).click();
  await expect(page.getByRole("group", { name: "Cliente" })).toContainText("Familia Ruiz");

  await page.getByLabel("Nota (opcional)").fill("Paga los viernes");
  await page.getByRole("button", { name: "Dejar abierta" }).click();

  await expect(page.getByRole("status")).toContainText("Se dejó abierta la cuenta de Familia Ruiz por $62.00.");

  const bills = await query("SELECT id, day, total, paid, state, customer_id, note FROM bills");
  expect(bills).toHaveLength(1);
  expect(bills[0]).toMatchObject({
    day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    total: 6200,
    paid: 0,
    state: "open",
    customer_id: ruiz.id,
    note: "Paga los viernes",
  });
  const billId = bills[0]!.id as string;
  expect(
    await query("SELECT item_id, quantity, unit_price, added_by FROM lines WHERE bill_id = ?", [billId]),
  ).toEqual(
    expect.arrayContaining([{ item_id: agua.id, quantity: 2, unit_price: 1850, added_by: beto.id }]),
  );
  // Stock is lowered, and no screen shows it to a Worker.
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 4 }]);

  // A second sale for the same Customer joins the same Bill while it is Open.
  await menu.getByRole("button", { name: /Agua mineral/ }).click();
  await page.getByLabel("Cliente", { exact: true }).pressSequentially("Fam");
  await page.getByRole("list", { name: "Coincidencias" }).getByRole("button", { name: "Familia Ruiz" }).click();
  await page.getByRole("button", { name: "Dejar abierta" }).click();

  await expect(page.getByRole("status")).toContainText("Se dejó abierta la cuenta de Familia Ruiz por $80.50.");
  expect(await query("SELECT id, total, paid, state FROM bills")).toMatchObject([
    { id: billId, total: 8050, paid: 0, state: "open" },
  ]);
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 3 }]);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a Worker adds a new Customer from the picker, and leaves a Bill with no Customer open with a note", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  query,
}) => {
  await signInAs("worker");
  const panaderia = await addCategory("Panadería");
  await addItem({ name: "Pan dulce", price: 1200, category: panaderia });

  await page.goto("/");
  await page.getByRole("region", { name: "Panadería" }).getByRole("button", { name: /Pan dulce/ }).click();

  // "Add new" from the picker saves the Customer, and Quitar drops the choice.
  await page.getByLabel("Cliente", { exact: true }).pressSequentially("Leo");
  await page.getByRole("button", { name: "Agregar «Leo»" }).click();
  await expect(page.getByRole("group", { name: "Cliente" })).toContainText("Leo");
  await page.getByRole("button", { name: "Quitar", exact: true }).click();
  await expect(page.getByLabel("Cliente", { exact: true })).toBeVisible();

  await page.getByLabel("Nota (opcional)").fill("Se lo llevó Sofía");
  await page.getByRole("button", { name: "Dejar abierta" }).click();

  await expect(page.getByRole("status")).toContainText("Se dejó abierta una cuenta por $12.00.");
  expect(await query("SELECT total, state, customer_id, note FROM bills")).toMatchObject([
    { total: 1200, state: "open", customer_id: null, note: "Se lo llevó Sofía" },
  ]);
  expect(await query("SELECT name, retired_at FROM customers")).toMatchObject([{ name: "Leo", retired_at: null }]);
});

test("Vender does not offer a retired Item", async ({ page, signInAs, addItem, query }) => {
  await signInAs("worker");
  const active = await addItem({ name: "Activo en Vender" });
  const retired = await addItem({ name: "Retirado de Vender", category: active.category });
  await query("UPDATE items SET retired_at = ? WHERE id = ?", [Date.now(), retired.id]);

  await page.goto("/");

  await expect(page.getByRole("button", { name: /Activo en Vender/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Retirado de Vender/ })).toHaveCount(0);
});
