import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

// Changing a Bill's Customer or note on Cuenta (spec §5.3, §4.1, §6.1,
// §7.3.4): any User while the Bill has no Payment, an Admin afterwards. Every
// change leaves a `bill_edits` fact. Both projects run a phone viewport
// (playwright.config.ts).

const menu = (page: Page, category = "Bebidas") => page.getByRole("region", { name: category });

/** Builds a one-Item selection on Vender and leaves the Bill open. */
async function leaveOpen(page: Page, item: string, sale: { note?: string; total: string }) {
  await menu(page).getByRole("button", { name: new RegExp(item) }).click();
  if (sale.note) await page.getByLabel("Nota (opcional)").fill(sale.note);
  await page.getByRole("button", { name: "Dejar abierta" }).click();
  await expect(page.getByRole("status")).toContainText(`por ${sale.total}.`);
}

/** The one Bill the test has made so far. */
async function onlyBillId(
  query: (sql: string, params?: ReadonlyArray<string | number | null>) => Promise<Array<Record<string, unknown>>>,
) {
  const [bill] = (await query("SELECT id FROM bills")) as Array<{ id: string }>;
  return bill.id;
}

test("a Worker sets the Customer and the note, and every change is recorded with its author", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Café de olla", price: 2500, category: bebidas, stock: { units: 10, by: beto } });
  const ruiz = await addCustomer("Familia Ruiz", { by: beto });

  await page.goto("/");
  await leaveOpen(page, "Café de olla", { note: "Se lo llevó Sofía", total: "$25.00" });
  const billId = await onlyBillId(query);

  await page.goto(`/cuentas/${billId}`);
  await expect(page.getByRole("heading", { name: "Cliente y nota", level: 2 })).toBeVisible();
  await expect(page.getByLabel("Nota (opcional)")).toHaveValue("Se lo llevó Sofía");

  // The picker chooses the Customer, as it does on Vender.
  await page.getByLabel("Cliente", { exact: true }).pressSequentially("Fam");
  await page.getByRole("list", { name: "Coincidencias" }).getByRole("button", { name: "Familia Ruiz" }).click();
  await expect(page.getByRole("group", { name: "Cliente" })).toContainText("Familia Ruiz");

  // ...and the note changes with it, in the same submission.
  await page.getByLabel("Nota (opcional)").fill("Paga los viernes");
  await page.getByRole("button", { name: "Guardar" }).click();

  await expect(page.getByRole("status")).toContainText("Se guardaron los cambios de la cuenta.");
  const main = page.locator("main");
  await expect(main.getByRole("link", { name: "Familia Ruiz" })).toBeVisible();
  await expect(main).toContainText("Paga los viernes");

  expect(await query("SELECT customer_id, note, revision FROM bills WHERE id = ?", [billId])).toMatchObject([
    { customer_id: ruiz.id, note: "Paga los viernes", revision: 1 },
  ]);
  expect(
    await query(
      "SELECT field, previous_value, new_value, edited_by FROM bill_edits WHERE bill_id = ? ORDER BY rowid",
      [billId],
    ),
  ).toEqual([
    { field: "customer", previous_value: null, new_value: ruiz.id, edited_by: beto.id },
    { field: "note", previous_value: "Se lo llevó Sofía", new_value: "Paga los viernes", edited_by: beto.id },
  ]);
});

test("a Worker cannot change the Bill after a Payment, and an Admin can; the picker also adds a new Customer", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Agua mineral", price: 1850, category: bebidas, stock: { units: 10, by: beto } });

  await page.goto("/");
  await leaveOpen(page, "Agua mineral", { total: "$18.50" });
  const billId = await onlyBillId(query);

  // Adding a Customer from Cuenta: "add new" saves them and chooses them.
  await page.goto(`/cuentas/${billId}`);
  await page.getByLabel("Cliente", { exact: true }).pressSequentially("Leo");
  await page.getByRole("button", { name: "Agregar «Leo»" }).click();
  await expect(page.getByRole("group", { name: "Cliente" })).toContainText("Leo");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("status")).toContainText("Se guardaron los cambios de la cuenta.");
  const [leo] = (await query("SELECT id FROM customers")) as Array<{ id: string }>;
  expect(await query("SELECT name FROM customers")).toMatchObject([{ name: "Leo" }]);

  // Quitar unlinks, and that change is recorded too.
  await page.getByRole("button", { name: "Quitar", exact: true }).click();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator("main")).toContainText("Sin cliente");

  // A partial Payment leaves the Bill Open, but the Worker's edit form goes
  // away; the operation would refuse them anyway (covered in Vitest).
  await page.getByLabel("Monto").fill("5.00");
  await page.getByRole("button", { name: "Cobrar" }).click();
  await expect(page.getByRole("status")).toContainText("Abono de $5.00 registrado.");
  await expect(page.getByRole("heading", { name: "Cliente y nota" })).toHaveCount(0);

  // An Admin gets the form back and changes the note.
  const ana = await signInAs("admin", "Ana");
  await page.goto(`/cuentas/${billId}`);
  await expect(page.getByRole("heading", { name: "Cliente y nota", level: 2 })).toBeVisible();
  await page.getByLabel("Nota (opcional)").fill("Paga el viernes");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("status")).toContainText("Se guardaron los cambios de la cuenta.");
  await expect(page.locator("main")).toContainText("Paga el viernes");

  expect(await query("SELECT customer_id, note, revision FROM bills WHERE id = ?", [billId])).toMatchObject([
    { customer_id: null, note: "Paga el viernes", revision: 4 },
  ]);
  expect(
    await query(
      "SELECT field, previous_value, new_value, edited_by FROM bill_edits WHERE bill_id = ? ORDER BY rowid",
      [billId],
    ),
  ).toEqual([
    { field: "customer", previous_value: null, new_value: leo.id, edited_by: beto.id },
    { field: "customer", previous_value: leo.id, new_value: null, edited_by: beto.id },
    { field: "note", previous_value: null, new_value: "Paga el viernes", edited_by: ana.id },
  ]);
});
