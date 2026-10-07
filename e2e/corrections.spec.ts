import { expect, test } from "./fixtures";
import { payBill, seeBill } from "./support/bill";
import { addToBill, leaveOpen } from "./support/sell";

// Corrections on Cuenta (spec §5.7, §8.4, §8.5, §10.4): removing a Line,
// removing a Payment and voiding a Bill, each with its author, its moment and
// its reason, and each returning the units its Lines moved. Both projects run
// a phone viewport (playwright.config.ts).

test("§8.4: a Worker removes the wrong Line on an unpaid Bill; the Line is recorded as removed, the total drops and the units return", async ({
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
    stock: { units: 6, by: beto },
  });

  await page.goto("/");
  const billId = await leaveOpen(page, { items: ["Agua mineral"] });

  await page.goto(`/cuentas/${billId}`);

  // A Bill with no Payment needs no reason, so a Worker sees Quitar alone.
  await expect(page.locator("main")).toContainText("1 × Agua mineral");
  await expect(page.getByLabel("Motivo")).toHaveCount(0);
  await page.getByRole("button", { name: "Quitar 1 × Agua mineral" }).click();

  // Nothing is left: the Bill counts as Paid with a zero total, and a Worker
  // is sent to Cuentas abiertas, where that Bill no longer appears (§5.6, §4.1).
  await expect(page).toHaveURL(/cuentas-abiertas/);
  await expect(page.getByRole("list", { name: "Cuentas abiertas" })).toHaveCount(0);

  expect(await query("SELECT total, paid, state FROM bills WHERE id = ?", [billId])).toEqual([
    { total: 0, paid: 0, state: "paid" },
  ]);
  // The Line itself is untouched; the removal is its own record with the
  // Worker's name and no reason (spec §2.1).
  expect(await query("SELECT quantity, added_by FROM lines WHERE bill_id = ?", [billId])).toEqual([
    { quantity: 1, added_by: beto.id },
  ]);
  expect(await query("SELECT removed_by, reason FROM line_removals")).toMatchObject([
    { removed_by: beto.id, reason: null },
  ]);
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 6 }]);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("§8.5: an Admin removes the Payment and then voids, each with a reason; Stock returns once per Line", async ({
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

  // Two Lines of the same Item, left open: one will be removed before the
  // void, so voiding must not return its units a second time.
  await page.goto("/");
  const billId = await leaveOpen(page, { items: ["Agua mineral"] });
  await page.goto(`/cuentas/${billId}`);
  await page.getByRole("link", { name: "Agregar productos" }).click();
  await addToBill(page, ["Agua mineral"]);
  await page.getByRole("link", { name: "Volver a la cuenta" }).click();

  // An Admin pays it in full from Cuenta, so the Payment is on a Paid Bill
  // (ticket 08); a Worker would be sent to the list instead (§4.1).
  await signInAs("admin", "Ana");
  await page.goto(`/cuentas/${billId}`);
  await payBill(page);
  await expect(page.getByRole("status")).toHaveText("$37.00 en efectivo. Cuenta pagada.");
  await seeBill(page);
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 8 }]);

  await expect(page.locator("main")).toContainText("Pagada");

  // Remove the Payment, with the reason an Admin owes (spec §5.7).
  const pagos = page.getByRole("list", { name: "Pagos" });
  await pagos.getByLabel("Motivo").fill("Se cobró por error");
  await pagos.getByRole("button", { name: /Quitar pago/ }).click();

  await expect(page.getByRole("status")).toContainText("Pago quitado.");
  const main = page.locator("main");
  await expect(main).toContainText("Abierta");
  await expect(main).toContainText(/Debe\s*\$37\.00/);
  await expect(pagos).toContainText("Quitado por Ana");
  await expect(pagos).toContainText("Se cobró por error");

  // With no Payment left, the Admin removes one Line without a reason; the
  // units return and the Bill stays Open with the other Line.
  await page.getByRole("button", { name: "Quitar 1 × Agua mineral" }).first().click();
  await expect(page.getByRole("status")).toContainText("Producto quitado.");
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 9 }]);

  // Void the Bill, with a reason; it cannot be undone (spec §5.7).
  const cancelar = page.getByRole("region", { name: "Cancelar cuenta" });
  await cancelar.getByLabel("Motivo").fill("La cuenta era una prueba");
  await cancelar.getByRole("button", { name: "Cancelar cuenta" }).click();

  await expect(page.getByRole("status")).toContainText("Cuenta cancelada.");
  await expect(main).toContainText("Cancelada");
  await expect(main).toContainText("Cancelada por Ana");
  await expect(main).toContainText("La cuenta era una prueba");

  // Voiding returned exactly the Line that still counted, once: the removed
  // Line's units came back with its removal, not again here.
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 10 }]);
  // A Voided Bill offers no Lines, Payments or further corrections.
  await expect(page.getByRole("link", { name: "Agregar productos" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Quitar/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Cancelar cuenta" })).toHaveCount(0);

  await page.goto("/cuentas-abiertas");
  await expect(page.getByRole("list", { name: "Cuentas abiertas" })).toHaveCount(0);

  // Every record stays: both Lines, both corrections and the Payment.
  expect(await query("SELECT COUNT(*) AS n FROM lines WHERE bill_id = ?", [billId])).toEqual([{ n: 2 }]);
  expect(await query("SELECT COUNT(*) AS n FROM line_removals")).toEqual([{ n: 1 }]);
  expect(await query("SELECT COUNT(*) AS n FROM payment_removals")).toEqual([{ n: 1 }]);
  expect(await query("SELECT reason FROM bill_voids")).toEqual([{ reason: "La cuenta era una prueba" }]);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// Ticket 18's trap: the action's status appears before the loader revalidation
// lands, and Cuenta's forms used to be keyed by the revision, so a reason typed
// in that window was wiped by the remount. The forms carry the fresh revision
// in a controlled field now; a typed reason survives.
test("a reason typed right after a correction's status is not wiped by the revalidation", async ({
  page,
  signInAs,
  addCategory,
  addItem,
}) => {
  const ana = await signInAs("admin", "Ana");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Chocolate", price: 2000, category: bebidas, stock: { units: 10, by: ana } });

  await page.goto("/");
  const billId = await leaveOpen(page, { items: ["Chocolate"] });

  // One Line and a partial Payment, so the Payment can be removed.
  await page.goto(`/cuentas/${billId}`);
  await payBill(page, { amount: "10.00" });
  await expect(page.getByRole("status")).toHaveText("$10.00 en efectivo. La cuenta todavía debe $10.00.");
  await seeBill(page);

  // Remove the Payment, with the reason an Admin owes.
  const pagos = page.getByRole("list", { name: "Pagos" });
  await pagos.getByLabel("Motivo").fill("Se cobró por error");
  await pagos.getByRole("button", { name: /Quitar pago/ }).click();
  await expect(page.getByRole("status")).toContainText("Pago quitado.");

  // The loader revalidation is still on its way. Type the next reason now and
  // send it: the form must hold the value, and the correction must go through.
  const cancelar = page.getByRole("region", { name: "Cancelar cuenta" });
  const motivo = cancelar.getByLabel("Motivo");
  await motivo.fill("La cuenta era una prueba");
  await expect(motivo).toHaveValue("La cuenta era una prueba");
  await cancelar.getByRole("button", { name: "Cancelar cuenta" }).click();
  await expect(page.getByRole("status")).toContainText("Cuenta cancelada.");
  await expect(page.locator("main")).toContainText("La cuenta era una prueba");

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
