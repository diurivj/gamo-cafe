import { expect, test } from "./fixtures";
import { payBill, removeLine, removePayment, seeBill, voidBill } from "./support/bill";
import { goTo } from "./support/navigate";
import { leaveOpen } from "./support/sell";

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

  // A sale left open, and its note set afterwards.
  await page.goto("/");
  const billId = await leaveOpen(page, { items: ["Agua mineral"] });
  await page.goto(`/cuentas/${billId}`);
  await page.getByLabel("Nota (opcional)").fill("Mesa 4");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("status")).toContainText("Se guardaron los cambios");

  // Paid in full by an Admin, who may go on opening it (a Worker may not).
  await signInAs("admin", "Ana");
  await page.goto(`/cuentas/${billId}`);
  await payBill(page);
  await expect(page.getByRole("status")).toContainText("Cuenta pagada");
  await seeBill(page);

  // Remove the Payment: an Admin, with a reason (spec §5.7).
  await removePayment(page, "$18.50", "Se cobró por error");
  await seeBill(page);

  // With no Payment left, the Line goes without a reason.
  await removeLine(page, "1 × Agua mineral");
  await seeBill(page);
  await expect(page.getByRole("region", { name: "Productos" })).toContainText("Quitado por Ana");

  // Void the Bill, with a reason.
  await voidBill(page, "Era una prueba");

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
  await goTo(page, "Historial");
  await expect(page).toHaveURL(/historial/);
  await expect(page.getByRole("heading", { name: "Historial" })).toBeVisible();

  const movimientos = page.getByRole("list", { name: "Movimientos" });
  const textos = await movimientos.getByRole("listitem").allInnerTexts();
  // Seven entries: the fixture's starting Stock is a Restock of its own.
  expect(textos).toHaveLength(7);
  expect(textos[0]).toContain("Ajuste cancelado");
  expect(textos[0]).toContain("Entrada +5 · Agua mineral");
  expect(textos[0]).toContain("Cancelado por Ana");
  expect(textos[1]).toContain("Ajuste de existencias");
  expect(textos[1]).toContain("Entrada +5 · Agua mineral");
  expect(textos[1]).toContain("Compra semanal");
  expect(textos[2]).toContain("Cuenta cancelada");
  expect(textos[2]).toContain("Total $0.00 · Pagado $0.00");
  expect(textos[2]).toContain("Cancelada por Ana");
  expect(textos[3]).toContain("Producto quitado");
  expect(textos[3]).toContain("1 × Agua mineral — $18.50");
  expect(textos[4]).toContain("Pago quitado");
  expect(textos[4]).toContain("$18.50 · Efectivo");
  expect(textos[5]).toContain("Nota cambiada");
  expect(textos[5]).toContain("Sin nota → «Mesa 4»");
  expect(textos[5]).toContain("Cambiada por Beto");
  expect(textos[6]).toContain("Entrada +10 · Agua mineral");
  expect(textos[6]).toContain("Registrado por Beto");
  // The record each correction is about, as it was made: whose Line and whose
  // Payment it was, beside who removed it. And which Bill.
  expect(textos[3]).toContain("Agregado por Beto");
  expect(textos[3]).toContain("Quitado por Ana");
  expect(textos[4]).toContain("Recibido por Ana");
  expect(textos[0]).toContain("Registrado por Ana");
  for (const texto of textos.slice(2, 5)) expect(texto).toContain("Cuenta de Mesa 4");
  // When, on every entry; the why where a reason was owed.
  for (const texto of textos) {
    expect(texto).toMatch(/\d{1,2}:\d{2}/);
  }
  expect(textos[4]).toContain("Motivo: Se cobró por error");
  expect(textos[2]).toContain("Motivo: Era una prueba");
  expect(textos[0]).toContain("Motivo: Se contó dos veces");
  // The Line removal needed no reason (the Bill had no Payment), so none is shown.
  expect(textos[3]).not.toContain("Motivo:");

  // Entries lead to the Bill or the Item concerned (spec §6.2), and the Bill
  // leads back to this list, where it was left.
  await expect(movimientos.getByRole("link", { name: /^Ver cuenta/ })).toHaveCount(4);
  await expect(movimientos.getByRole("link", { name: /^Ver producto/ })).toHaveCount(3);
  await movimientos.getByRole("link", { name: /^Ver cuenta: Pago quitado/ }).click();
  await expect(page).toHaveURL(new RegExp(`/cuentas/${billId}$`));
  // The Bill still holds what was corrected, as it was recorded.
  await expect(page.getByRole("list", { name: "Pagos" })).toContainText("$18.50");
  await expect(page.getByRole("list", { name: "Pagos" })).toContainText("Motivo: Se cobró por error");
  await page.getByRole("link", { name: "Historial", exact: true }).click();
  await expect(page).toHaveURL(/\/historial$/);
  await expect(movimientos.getByRole("listitem")).toHaveCount(7);

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

test("an empty Historial says so, and long words stay whole on a 320px phone with text twice as large", async ({
  page,
  signInAs,
  addItem,
  addCustomer,
  query,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const ana = await signInAs("admin", "María Guadalupe Hernández de la Torre");
  await page.goto("/historial");
  await expect(page.getByRole("main")).toContainText("Todavía no hay correcciones ni ajustes.");
  await expect(page.getByRole("list", { name: "Movimientos" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Cargar más" })).toHaveCount(0);

  const reason =
    "La familia avisó que la cuenta se abrió dos veces el mismo día, una desde cada teléfono, y que esta es la que sobra";
  const item = await addItem({ name: "Chocolate caliente con malvaviscos y canela extra grande", stockTracked: false });
  const family = await addCustomer("Familia Hernández de la Torre y Villaseñor Echeverría", { by: ana });
  await query(
    `INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
     VALUES ('larga', '2026-09-29', ?, 1000, ?, 12345678, 0, 'voided', 1)`,
    [ana.id, family.id],
  );
  await query(
    `INSERT INTO lines (id, bill_id, item_id, quantity, unit_price, moved_stock, added_by, added_at, day)
     VALUES ('l1', 'larga', ?, 1, 12345678, 0, ?, 1000, '2026-09-29')`,
    [item.id, ana.id],
  );
  await query("INSERT INTO bill_voids (id, bill_id, reason, voided_by, voided_at) VALUES ('v1', 'larga', ?, ?, 2000)", [
    reason,
    ana.id,
  ]);

  await page.reload();
  await page.addStyleTag({ content: "html { font-size: 200% }" });
  const entry = page.getByRole("list", { name: "Movimientos" }).getByRole("listitem");
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("Total $123,456.78 · Pagado $0.00");
  await expect(entry).toContainText("Cuenta de Familia Hernández de la Torre y Villaseñor Echeverría");
  await expect(entry).toContainText("Cancelada por María Guadalupe Hernández de la Torre");
  await expect(entry).toContainText(`Motivo: ${reason}`);
  expect(await entry.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // With the keyboard: the entry's link, and the way back.
  await entry.getByRole("link").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Cuenta", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Historial", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Historial", level: 1 })).toBeVisible();
});

test("a Worker is offered no Historial and is refused its page", async ({ page, signInAs }) => {
  await signInAs("worker", "Beto");

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Historial" })).toHaveCount(0);

  const response = await page.goto("/historial");
  expect(response?.status()).toBe(403);
  await expect(page.locator("body")).toContainText("No tienes acceso a esta página");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
