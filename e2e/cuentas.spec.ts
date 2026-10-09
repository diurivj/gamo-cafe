import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import * as sell from "./support/sell";

// Cuentas abiertas and Cuenta (spec §6.1, §4.1, §4.2): every Open Bill with
// what it owes, one Bill with its Lines and their authors, and **Agregar
// productos** adding to any Open Bill. Both projects run a phone viewport
// (playwright.config.ts).

/** Builds a selection on Vender and leaves the Bill open, as §8.2 does. */
async function leaveOpen(
  page: Page,
  sale: {
    readonly items: ReadonlyArray<string>;
    readonly customer?: string;
    readonly note?: string;
    /** What the recorded answer says, so the next step starts after this one. */
    readonly total: string;
    readonly category?: string;
  },
) {
  await sell.leaveOpen(page, sale);
  // The answer for *this* sale: a previous one's message must not pass for it.
  await expect(page.getByRole("status")).toContainText(`debe ${sale.total}.`);
}

test("Cuentas abiertas lists every Open Bill newest first with what it owes, and searches by Customer", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  addCustomer,
}) => {
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Agua mineral", price: 1850, category: bebidas, stock: { units: 10, by: beto } });
  await addItem({ name: "Café de olla", price: 2500, category: bebidas, stock: { units: 10, by: beto } });
  await addCustomer("Familia Ruiz", { by: beto });
  await addCustomer("Familia Paz", { by: beto });

  await page.goto("/");
  await leaveOpen(page, { items: ["Agua mineral"], note: "Se lo llevó Sofía", total: "$18.50" });
  await leaveOpen(page, {
    items: ["Agua mineral", "Agua mineral", "Café de olla"],
    customer: "Familia Ruiz",
    total: "$62.00",
  });
  await leaveOpen(page, { items: ["Café de olla"], customer: "Familia Paz", total: "$25.00" });

  await page.goto("/cuentas-abiertas");

  await expect(page.getByRole("heading", { name: "Cuentas abiertas", level: 1 })).toBeVisible();
  const rows = page.getByRole("list", { name: "Cuentas abiertas" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  // Newest first: Paz, then Ruiz, then the Bill with only a note.
  await expect(rows.nth(0)).toContainText("Familia Paz");
  await expect(rows.nth(1)).toContainText("Familia Ruiz");
  await expect(rows.nth(2)).toContainText("Se lo llevó Sofía");
  // Total, paid and owed, and the state.
  await expect(rows.nth(1)).toContainText("Debe $62.00");
  await expect(rows.nth(1)).toContainText("Total $62.00 · Pagado $0.00");
  await expect(rows.nth(1)).toContainText("Abierta");
  await expect(rows.nth(0)).toContainText("Debe $25.00");

  // Search by Customer, as the name is typed (a prefix, as on Clientes).
  await page.getByLabel("Buscar por cliente").fill("familia p");

  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Familia Paz");

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Cuenta shows its Lines with who and when; Agregar productos adds to that Bill, each Line keeping its author", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Agua mineral", price: 1850, category: bebidas, stock: { units: 10, by: beto } });
  await addItem({ name: "Café de olla", price: 2500, category: bebidas, stock: { units: 10, by: beto } });
  await addCustomer("Familia Ruiz", { by: beto });

  await page.goto("/");
  await leaveOpen(page, { items: ["Agua mineral"], customer: "Familia Ruiz", total: "$18.50" });
  const [{ id: billId }] = (await query("SELECT id FROM bills")) as Array<{ id: string }>;

  // The list opens the Cuenta, which shows the Line with its author and time.
  await page.goto("/cuentas-abiertas");
  await page.getByRole("list", { name: "Cuentas abiertas" }).getByRole("link", { name: /Familia Ruiz/ }).click();

  const main = page.locator("main");
  await expect(page.getByRole("heading", { name: "Cuenta", level: 1 })).toBeVisible();
  await expect(main.getByRole("link", { name: "Cuentas abiertas" })).toBeVisible();
  await expect(main).toContainText("Familia Ruiz");
  await expect(main).toContainText("1 × Agua mineral");
  await expect(main).toContainText("$18.50 c/u");
  await expect(main).toContainText("Beto");
  await expect(main).toContainText("Abierta");

  // Agregar productos opens Vender targeting this Bill, with no Customer or
  // note fields in the way.
  await page.getByRole("link", { name: "Agregar productos" }).click();

  await expect(page).toHaveURL(new RegExp(`billId=${billId}`));
  await expect(page.getByRole("region", { name: "Cuenta destino" })).toContainText(
    "Se agrega a la cuenta de Familia Ruiz",
  );

  await sell.addToBill(page, ["Café de olla"]);
  await expect(page.getByRole("status")).toContainText("La cuenta de Familia Ruiz debe $43.50.");

  // Back on Cuenta both Lines are there, by Beto.
  await page.getByRole("link", { name: "Volver a la cuenta" }).click();

  await expect(page.getByRole("heading", { name: "Cuenta", level: 1 })).toBeVisible();
  await expect(main).toContainText("1 × Agua mineral");
  await expect(main).toContainText("1 × Café de olla");
  await expect(main).toContainText("$43.50");

  // Any User can add to any Open Bill: Ana adds from the same Cuenta, and each
  // Line keeps its own author.
  const ana = await signInAs("admin", "Ana");
  await page.goto("/cuentas-abiertas");
  await page.getByRole("list", { name: "Cuentas abiertas" }).getByRole("link", { name: /Familia Ruiz/ }).click();
  await page.getByRole("link", { name: "Agregar productos" }).click();
  await sell.addToBill(page, ["Agua mineral"]);
  await page.getByRole("link", { name: "Volver a la cuenta" }).click();

  await expect(main).toContainText("Beto");
  await expect(main).toContainText("Ana");
  await expect(main).toContainText("$62.00");

  const lines = (await query("SELECT added_by, quantity FROM lines WHERE bill_id = ? ORDER BY rowid", [
    billId,
  ])) as Array<{ added_by: string; quantity: number }>;
  expect(lines).toEqual([
    { added_by: beto.id, quantity: 1 },
    { added_by: beto.id, quantity: 1 },
    { added_by: ana.id, quantity: 1 },
  ]);
  expect(await query("SELECT id FROM bills")).toHaveLength(1);
});

test("a Worker is refused a Paid Bill's page, and an Admin opens it", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  query,
}) => {
  await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Producto pagado", price: 1000, category: bebidas });

  await page.goto("/");
  await leaveOpen(page, { items: ["Producto pagado"], total: "$10.00" });
  const [{ id: billId }] = (await query("SELECT id FROM bills")) as Array<{ id: string }>;
  // The projections a Payment writes (ticket 08), set directly: this test is
  // about the refusal, not about taking one.
  await query("UPDATE bills SET paid = total, state = 'paid' WHERE id = ?", [billId]);

  const refused = await page.goto(`/cuentas/${billId}`);

  // Refused, and told why: this is where the browser's Back leads a Worker
  // who has just taken the Bill's last Payment.
  expect(refused?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "Esta cuenta ya no está abierta", level: 1 })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toContainText("Se pagó o se canceló. Lo registrado se conserva, y solo un administrador puede abrirla.");
  await expect(main).not.toContainText("Producto pagado");
  await expect(main.getByRole("link")).toHaveText(["Cuentas abiertas", "Ir a Vender"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // It is not offered on Cuentas abiertas either.
  await page.goto("/cuentas-abiertas");
  await expect(page.getByRole("list", { name: "Cuentas abiertas" })).toHaveCount(0);

  await signInAs("admin", "Ana");
  const allowed = await page.goto(`/cuentas/${billId}`);

  expect(allowed?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Cuenta", level: 1 })).toBeVisible();
  await expect(page.locator("main")).toContainText("Pagada");
  await expect(page.locator("main")).toContainText("1 × Producto pagado");
});
