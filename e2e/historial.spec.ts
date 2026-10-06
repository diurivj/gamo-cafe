import { expect, test } from "./fixtures";

// Historial (spec §6.2, §8.4, §8.5, §8.6, §10.4): every correction and
// Adjustment appears with who, when and why, newest first, and the records it
// corrects stay on file. Both projects run a phone viewport
// (playwright.config.ts).

test("§10.4: each correction and Adjustment appears in Historial with its author, time and reason, and the records stay", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  const agua = await addItem({
    name: "Agua mineral",
    price: 1850,
    category: bebidas,
    stock: { units: 10, by: beto },
  });

  // A sale left open, then paid in full; a Worker would be sent to the list
  // after paying, so the Admin continues on Cuenta.
  await page.goto("/");
  await page.getByRole("region", { name: "Bebidas" }).getByRole("button", { name: /Agua mineral/ }).click();
  await page.getByRole("button", { name: "Dejar abierta" }).click();
  const billId = await page.getByRole("status").getAttribute("data-bill-id");

  await signInAs("admin", "Ana");
  await page.goto(`/cuentas/${billId}`);
  await page.getByRole("region", { name: "Cobrar" }).getByRole("button", { name: "Cobrar" }).click();
  await expect(page.getByRole("status")).toContainText("Cuenta pagada");

  // Remove the Payment: an Admin, with a reason (spec §5.7).
  const pagos = page.getByRole("list", { name: "Pagos" });
  await pagos.getByLabel("Motivo").fill("Se cobró por error");
  await pagos.getByRole("button", { name: /Quitar pago/ }).click();
  await expect(page.getByRole("status")).toContainText("Pago quitado.");
  // Wait for the Bill's new state, not only the action's message: the forms
  // are keyed by the revision, and a revalidation remounts them.
  await expect(pagos).toContainText("Quitado por Ana");

  // With no Payment left, the Line goes without a reason.
  await page.getByRole("button", { name: "Quitar 1 × Agua mineral" }).click();
  await expect(page.getByRole("status")).toContainText("Producto quitado.");
  const productos = page.getByRole("region", { name: "Productos" });
  await expect(productos).toContainText("Quitado por Ana");

  // Void the Bill, with a reason.
  const cancelar = page.getByRole("region", { name: "Cancelar cuenta" });
  const motivo = cancelar.getByLabel("Motivo");
  await motivo.fill("Era una prueba");
  await expect(motivo).toHaveValue("Era una prueba");
  await cancelar.getByRole("button", { name: "Cancelar cuenta" }).click();
  await expect(page.getByRole("status")).toContainText("Cuenta cancelada.");

  // An Adjustment, and its cancellation (spec §8.6).
  await page.goto("/inventario");
  await page.getByLabel("Producto").selectOption({ label: "Agua mineral" });
  await page.getByLabel("Unidades").fill("5");
  await page.getByLabel("Nota (opcional)").fill("Compra semanal");
  await page.getByRole("button", { name: "Registrar ajuste" }).click();

  const reciente = page.locator("li").filter({ hasText: "Entrada +5" }).first();
  await reciente.getByLabel("Motivo de la cancelación").fill("Se contó dos veces");
  await reciente.getByRole("button", { name: "Cancelar ajuste" }).click();
  await expect(reciente).toContainText("Se contó dos veces");

  // Historial: newest first, each with who, when and why.
  await page.getByRole("link", { name: "Historial" }).click();
  await expect(page).toHaveURL(/historial/);
  await expect(page.getByRole("heading", { name: "Historial" })).toBeVisible();

  const movimientos = page.getByRole("list", { name: "Movimientos" });
  const textos = await movimientos.getByRole("listitem").allInnerTexts();
  // Six entries: the fixture's starting Stock is a Restock of its own.
  expect(textos).toHaveLength(6);
  expect(textos[0]).toContain("Ajuste cancelado: Entrada +5 · Agua mineral");
  expect(textos[1]).toContain("Entrada +5 · Agua mineral");
  expect(textos[1]).toContain("Compra semanal");
  expect(textos[2]).toContain("Cuenta cancelada: $0.00");
  expect(textos[3]).toContain("Producto quitado: 1 × Agua mineral — $18.50");
  expect(textos[4]).toContain("Pago quitado: $18.50 · Efectivo");
  expect(textos[5]).toContain("Entrada +10 · Agua mineral");
  expect(textos[5]).toContain("Beto");
  // Who and when, on every entry; the why where a reason was owed.
  for (const texto of textos) {
    expect(texto).toMatch(/\d{1,2}:\d{2}/);
  }
  for (const texto of textos.slice(0, 5)) {
    expect(texto).toContain("Ana");
  }
  expect(textos.join("\n")).toContain("Se cobró por error");
  expect(textos.join("\n")).toContain("Era una prueba");
  expect(textos.join("\n")).toContain("Se contó dos veces");
  // The Line removal needed no reason (the Bill had no Payment), so none is shown.
  expect(textos[3]).not.toContain("Motivo:");

  // Entries link to the Bill or the Item concerned (spec §6.2).
  await expect(movimientos.getByRole("link", { name: "Ver cuenta" })).toHaveCount(3);
  await expect(movimientos.getByRole("link", { name: "Ver producto" })).toHaveCount(3);
  await movimientos.getByRole("link", { name: "Ver cuenta" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/cuentas/${billId}$`));

  // Nothing was deleted: the Line, the Payment, the Bill, the Adjustment and
  // the cancellation are all still on file (spec §2.1, §10.4).
  expect(await query("SELECT COUNT(*) AS n FROM lines WHERE bill_id = ?", [billId])).toEqual([{ n: 1 }]);
  expect(await query("SELECT COUNT(*) AS n FROM payments WHERE bill_id = ?", [billId])).toEqual([{ n: 1 }]);
  expect(await query("SELECT reason FROM line_removals")).toEqual([{ reason: null }]);
  expect(await query("SELECT reason FROM payment_removals")).toEqual([{ reason: "Se cobró por error" }]);
  expect(await query("SELECT reason FROM bill_voids")).toEqual([{ reason: "Era una prueba" }]);
  expect(await query("SELECT COUNT(*) AS n FROM adjustments WHERE item_id = ?", [agua.id])).toEqual([{ n: 2 }]);
  expect(await query("SELECT reason FROM adjustment_cancellations")).toEqual([{ reason: "Se contó dos veces" }]);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a Worker is offered no Historial and is refused its page", async ({ page, signInAs }) => {
  await signInAs("worker", "Beto");

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Historial" })).toHaveCount(0);

  const response = await page.goto("/historial");
  expect(response?.status()).toBe(403);
  await expect(page.locator("body")).toContainText("Algo salió mal");
});
