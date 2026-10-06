import { expect, test } from "./fixtures";

// Payments (spec §5.5, §5.6, §6.1, §8.1, §10.2, §10.3): **Cobrar** on Vender
// records the selection and a Payment in one batch, and Cuenta takes a
// Payment with what the Bill still owes by default. Both projects run a phone
// viewport (playwright.config.ts).

test("a walk-up sale is cobrada: one Paid Bill whose Lines and Payment carry the signed-in User", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  const agua = await addItem({ name: "Agua mineral", price: 1850, category: bebidas, stock: { units: 6, by: beto } });

  await page.goto("/");
  const menu = page.getByRole("region", { name: "Bebidas" });
  await menu.getByRole("button", { name: /Agua mineral/ }).click();
  await menu.getByRole("button", { name: /Agua mineral/ }).click();
  await expect(page.getByRole("region", { name: "Selección" })).toContainText("$37.00");

  // Cobrar: the method, and for cash the amount handed over with the change.
  const cobrar = page.getByRole("region", { name: "Cobrar" });
  await expect(cobrar.getByRole("radio", { name: "Efectivo" })).toBeChecked();
  await cobrar.getByLabel("Efectivo entregado (opcional)").fill("50");
  await expect(cobrar).toContainText("Cambio: $13.00");

  await cobrar.getByRole("button", { name: "Cobrar" }).click();

  await expect(page.getByRole("status")).toContainText("Cuenta pagada: $37.00.");

  // One Bill, Paid, with its Lines and its Payment carrying the signed-in User.
  const bills = (await query("SELECT id, day, total, paid, state FROM bills")) as Array<Record<string, unknown>>;
  expect(bills).toHaveLength(1);
  expect(bills[0]).toMatchObject({ total: 3700, paid: 3700, state: "paid" });
  const billId = bills[0]!.id as string;
  expect(await query("SELECT item_id, quantity, added_by FROM lines WHERE bill_id = ?", [billId])).toMatchObject([
    { item_id: agua.id, quantity: 2, added_by: beto.id },
  ]);
  expect(await query("SELECT bill_id, amount, method, received_by FROM payments WHERE bill_id = ?", [billId])).toMatchObject([
    { bill_id: billId, amount: 3700, method: "cash", received_by: beto.id },
  ]);
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 4 }]);

  // The day's sale is done: a second selection with the Payment makes a second,
  // separate Bill.
  await menu.getByRole("button", { name: /Agua mineral/ }).click();
  await page.getByRole("region", { name: "Cobrar" }).getByRole("button", { name: "Cobrar" }).click();
  await expect(page.getByRole("status")).toContainText("Cuenta pagada: $18.50.");
  expect(await query("SELECT state FROM bills")).toHaveLength(2);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a partial sale leaves Pago parcial, and Cuenta lists its Payments and collects the rest", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Café de olla", price: 2500, category: bebidas, stock: { units: 4, by: beto } });

  await page.goto("/");
  await page.getByRole("region", { name: "Bebidas" }).getByRole("button", { name: /Café de olla/ }).click();
  const cobrar = page.getByRole("region", { name: "Cobrar" });
  await cobrar.getByLabel("Monto").fill("10.00");
  await cobrar.getByRole("button", { name: "Cobrar" }).click();

  await expect(page.getByRole("status")).toContainText("Abono registrado. Debe $15.00.");
  const [{ id: billId }] = (await query("SELECT id FROM bills")) as Array<{ id: string }>;
  expect(await query("SELECT paid, state FROM bills WHERE id = ?", [billId])).toMatchObject([
    { paid: 1000, state: "partial" },
  ]);

  // Cuenta shows Pago parcial and the Payment with who, when and method.
  await page.goto(`/cuentas/${billId}`);
  const main = page.locator("main");
  await expect(page.getByRole("heading", { name: "Cuenta", level: 1 })).toBeVisible();
  await expect(main).toContainText("Pago parcial");
  const pagos = page.getByRole("list", { name: "Pagos" });
  await expect(pagos).toContainText("Efectivo");
  await expect(pagos).toContainText("$10.00");
  await expect(pagos).toContainText("Beto");
  await expect(pagos).toContainText(/\d{2}:\d{2}/);

  // An Admin empties nothing: the amount already holds what the Bill owes, and
  // paying it makes the Bill Pagada.
  await signInAs("admin", "Ana");
  await page.goto(`/cuentas/${billId}`);
  const cobrarCuenta = page.getByRole("region", { name: "Cobrar" });
  await expect(cobrarCuenta.getByLabel("Monto")).toHaveValue("$15.00");
  await cobrarCuenta.getByRole("button", { name: "Cobrar" }).click();

  await expect(page.getByRole("status")).toContainText("Cuenta pagada: $25.00.");
  await expect(main).toContainText("Pagada");
  await expect(page.getByRole("list", { name: "Pagos" }).getByRole("listitem")).toHaveCount(2);
  expect(
    await query("SELECT amount, method FROM payments WHERE bill_id = ? ORDER BY received_at", [billId]),
  ).toMatchObject([
    { amount: 1000, method: "cash" },
    { amount: 1500, method: "cash" },
  ]);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
