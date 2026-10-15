import type { Page, Route } from "@playwright/test";

import { expect, test } from "./fixtures";
import { backToBill, closedNotice, openCorrection, payInFull, removeLine, removePayment, seeBill, summary, voidBill } from "./support/bill";
import { holdSubmissions } from "./support/held";
import { destinations } from "./support/navigate";
import { addToBill, leaveOpen } from "./support/sell";

// Corrections on Cuenta (spec §5.7, §8.4, §8.5, §10.4; UI redesign §6, §7.2):
// removing a Line, removing a Payment and voiding a Bill. Each is a step of
// its own that names the record and says what will happen, each keeps its
// author, its moment and its reason, and each returns the units its Lines
// moved. What is sent is said only as what is known: on its way, confirmed,
// refused or unknown. Requests are held or failed on purpose; no test waits
// on the network's own timing. Both projects run a phone viewport
// (playwright.config.ts).

type Query = (sql: string, params?: Array<string | number | null>) => Promise<Array<Record<string, unknown>>>;

const CORRECTION = "**/cuentas/*/corregir";
const title = (page: Page, name: string) => page.getByRole("heading", { name, level: 1 });
const dialog = (page: Page) => page.getByRole("alertdialog");
const effects = (page: Page) => page.getByRole("region", { name: /^Al (quitarlo|cancelarla)$/ });
const nothingSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/**
 * A Bill as its facts and projections hold it, for a test that is about the
 * correction's screen and not about how the Bill was sold. Its Lines moved no
 * Stock: the tests about Stock sell through Vender.
 */
async function seedBill(
  query: Query,
  bill: {
    id: string;
    by: string;
    itemId: string;
    /** One Line per entry: its units, at $10.00 each. */
    lines: ReadonlyArray<number>;
    paid?: number;
    customerId?: string | null;
    note?: string | null;
  },
) {
  const total = bill.lines.reduce((sum, units) => sum + units * 1000, 0);
  const paid = bill.paid ?? 0;
  await query(
    `INSERT INTO bills (id, day, opened_by, opened_at, customer_id, note, total, paid, state, revision)
     VALUES (?, '2026-09-29', ?, 1000, ?, ?, ?, ?, ?, 0)`,
    [bill.id, bill.by, bill.customerId ?? null, bill.note ?? null, total, paid, paid === 0 ? "open" : paid === total ? "paid" : "partial"],
  );
  for (const [index, units] of bill.lines.entries()) {
    await query(
      `INSERT INTO lines (id, bill_id, item_id, quantity, unit_price, moved_stock, added_by, added_at, day)
       VALUES (?, ?, ?, ?, 1000, 0, ?, ?, '2026-09-29')`,
      [`${bill.id}-linea-${index + 1}`, bill.id, bill.itemId, units, bill.by, 1000 + index],
    );
  }
  if (paid > 0) {
    await query(
      `INSERT INTO payments (id, bill_id, amount, method, received_by, received_at, day)
       VALUES (?, ?, ?, 'cash', ?, 2000, '2026-09-29')`,
      [`${bill.id}-pago`, bill.id, paid, bill.by],
    );
  }
}

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

  // The correction is not one tap from the Bill: its step names the Line and
  // says what will happen. A Bill with no Payment asks a Worker for no reason,
  // and a Worker is told nothing about Stock.
  await openCorrection(page, "Quitar 1 × Agua mineral", "Quitar producto");
  await expect(title(page, "Quitar producto")).toBeFocused();
  await expect(page.getByRole("region", { name: "Cuenta" })).toContainText("1 × Agua mineral");
  await expect(effects(page).getByRole("listitem")).toHaveText([
    "El total de la cuenta baja de $18.50 a $0.00.",
    "La cuenta queda sin productos y sale de Cuentas abiertas.",
    /^Deja de contar en lo vendido del /,
    "El producto sigue en la cuenta, marcado como quitado.",
  ]);
  await expect(page.getByLabel("Motivo")).toHaveCount(0);
  expect(await query("SELECT COUNT(*) AS n FROM line_removals")).toEqual([{ n: 0 }]);

  await page.getByRole("button", { name: "Quitar 1 × Agua mineral" }).click();

  // Nothing is left: the Bill counts as Paid with a zero total, which a Worker
  // may not open (§5.6, §4.1). They see the result, and the way on is the list.
  await expect(title(page, "Producto quitado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("1 × Agua mineral. La cuenta quedó sin productos.");
  await expect(page.getByRole("button", { name: "Ver cuenta" })).toHaveCount(0);
  await page.getByRole("link", { name: "Cuentas abiertas" }).click();
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

  expect(await nothingSideways(page)).toBe(true);
});

test("§8.5: an Admin removes the Payment and then voids, each with a reason; the figures follow and Stock returns once per Line", async ({
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
  // (ticket 08), and goes back to it from Inicio, which a Worker could not (§4.1).
  await signInAs("admin", "Ana");
  await page.goto(`/cuentas/${billId}`);
  await payInFull(page);
  await expect(closedNotice(page)).toHaveText("Cuenta pagada y cerrada. $37.00 en efectivo. La cuenta ya no debe nada.");
  await backToBill(page);
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 8 }]);
  const main = page.getByRole("main");
  await expect(main).toContainText("Pagada");

  // Remove the Payment: its step says what the Bill will owe again, and the
  // result says what the server recorded (spec §5.7).
  await openCorrection(page, "Quitar pago de $37.00", "Quitar pago");
  await expect(effects(page).getByRole("listitem").first()).toHaveText("La cuenta vuelve a deber $37.00.");
  await page.getByLabel("Motivo").fill("Se cobró por error");
  await page.getByRole("button", { name: "Quitar pago de $37.00" }).click();
  await expect(title(page, "Pago quitado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("$37.00 en efectivo. La cuenta debe $37.00.");
  await expect(main).toContainText("Se cobró por error");

  await seeBill(page);
  await expect(main).toContainText("Abierta");
  await expect(summary(page)).toContainText("Debe $37.00");
  await expect(summary(page)).toContainText("Pagado $0.00");
  // The Payment is still there, as it was taken, marked with who removed it and why.
  const pagos = page.getByRole("list", { name: "Pagos" });
  await expect(pagos).toContainText("$37.00");
  await expect(pagos).toContainText(/Quitado por Ana · .* · Motivo: Se cobró por error/);

  // With no Payment left, the Admin removes one Line without a reason; the
  // step tells an Admin its unit returns, and the Bill stays Open with the other.
  await openCorrection(page, "Quitar 1 × Agua mineral", "Quitar producto");
  await expect(effects(page)).toContainText("Su unidad regresa a existencias.");
  await expect(page.getByLabel("Motivo")).toHaveCount(0);
  await page.getByRole("button", { name: "Quitar 1 × Agua mineral" }).click();
  await expect(page.getByRole("status")).toHaveText("1 × Agua mineral. La cuenta suma $18.50 y debe $18.50.");
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 9 }]);
  await seeBill(page);
  await expect(summary(page)).toContainText("Total $18.50");
  await expect(page.getByRole("region", { name: "Productos" })).toContainText("Quitado por Ana");

  // Void the Bill: the step says what it does to the figures and to Stock, and
  // that it cannot be undone (spec §5.7). Nothing offers to undo it afterwards.
  await openCorrection(page, "Cancelar esta cuenta", "Cancelar cuenta");
  await expect(effects(page).getByRole("listitem")).toHaveText([
    "No se puede deshacer.",
    "Sus productos dejan de contar en lo vendido de los días en que se registraron.",
    "Ya no se podrá cobrar lo que debe: $18.50.",
    "Las unidades de sus productos regresan a existencias.",
    "La cuenta se conserva, marcada como cancelada.",
  ]);
  await page.getByLabel("Motivo").fill("La cuenta era una prueba");
  await page.getByRole("button", { name: "Cancelar cuenta", exact: true }).click();
  await expect(title(page, "Cuenta cancelada")).toBeFocused();
  await expect(main).not.toContainText(/deshacer|restaurar/i);

  await seeBill(page);
  await expect(main).toContainText("Cancelada por Ana");
  await expect(main).toContainText("La cuenta era una prueba");
  await expect(main).not.toContainText(/deshacer|restaurar/i);

  // Voiding returned exactly the Line that still counted, once: the removed
  // Line's units came back with its removal, not again here.
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 10 }]);
  // A Voided Bill offers no Lines, Payments or further corrections, and keeps
  // every record in sight.
  await expect(main.getByRole("link", { name: "Agregar productos" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: /Quitar|Cancelar/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Productos" }).getByRole("listitem")).toHaveCount(2);
  await expect(pagos.getByRole("listitem")).toHaveCount(1);

  await page.goto("/cuentas-abiertas");
  await expect(page.getByRole("list", { name: "Cuentas abiertas" })).toHaveCount(0);

  // Every record stays: both Lines, both corrections and the Payment.
  expect(await query("SELECT COUNT(*) AS n FROM lines WHERE bill_id = ?", [billId])).toEqual([{ n: 2 }]);
  expect(await query("SELECT COUNT(*) AS n FROM line_removals")).toEqual([{ n: 1 }]);
  expect(await query("SELECT COUNT(*) AS n FROM payment_removals")).toEqual([{ n: 1 }]);
  expect(await query("SELECT reason FROM bill_voids")).toEqual([{ reason: "La cuenta era una prueba" }]);

  expect(await nothingSideways(page)).toBe(true);
});

test("a Worker is offered no correction of a Bill with a Payment, and an Admin is told why a Line cannot go and what to do first", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const item = await addItem({ name: "Torta", stockTracked: false });
  await seedBill(query, { id: "con-pago", by: beto.id, itemId: item.id, lines: [2, 1], paid: 1500 });

  await page.goto("/cuentas/con-pago");
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: /Quitar|Cancelar/ })).toHaveCount(0);
  await expect(main).toContainText("Esta cuenta ya tiene pagos: solo un administrador puede quitar productos.");
  // The address of a step that is not theirs is the Bill, and sends nothing.
  for (const step of ["quitar-linea&id=con-pago-linea-1", "quitar-pago&id=con-pago-pago", "cancelar-cuenta"]) {
    await page.goto(`/cuentas/con-pago?paso=${step}`);
    await expect(title(page, "Cuenta")).toBeVisible();
    await expect(page).toHaveURL(/\/cuentas\/con-pago$/);
  }
  // And the server refuses what the screen does not offer.
  const forged = await page.request.post("/cuentas/con-pago/corregir", {
    form: { intent: "cancelar-cuenta", reason: "No me toca", revision: "0" },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(forged.status()).toBe(403);
  expect(await query("SELECT state, revision FROM bills")).toEqual([{ state: "partial", revision: 0 }]);

  // An Admin: $15.00 are paid, so the $20.00 Line cannot go and the $10.00 one can.
  await signInAs("admin", "Ana");
  await page.goto("/cuentas/con-pago");
  await openCorrection(page, "Quitar 2 × Torta", "Quitar producto");
  await expect(page.getByRole("status")).toHaveText(
    "No se puede quitar: la cuenta quedaría en $10.00 y ya tiene $15.00 pagados. Primero quita un pago.",
  );
  await expect(main.getByRole("button", { name: /^Quitar/ })).toHaveCount(0);
  await expect(page.getByLabel("Motivo")).toHaveCount(0);
  await page.getByRole("button", { name: "Volver a la cuenta" }).click();

  await openCorrection(page, "Quitar 1 × Torta", "Quitar producto");
  await expect(effects(page).getByRole("listitem").nth(1)).toHaveText("Quedará debiendo $5.00.");
  await page.getByLabel("Motivo").fill("No se lo llevó");
  await page.getByRole("button", { name: "Quitar 1 × Torta" }).click();
  await expect(page.getByRole("status")).toHaveText("1 × Torta. La cuenta suma $20.00 y debe $5.00.");
  expect(await query("SELECT line_id, reason FROM line_removals")).toEqual([
    { line_id: "con-pago-linea-2", reason: "No se lo llevó" },
  ]);
});

test("a correction on its way is said at once, shows nothing as recorded and is not left by accident", async ({
  page,
  signInAs,
  addItem,
  addCustomer,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const item = await addItem({ name: "Torta", stockTracked: false });
  const ruiz = await addCustomer("Familia Ruiz", { by: ana });
  await seedBill(query, { id: "en-camino", by: ana.id, itemId: item.id, lines: [2], customerId: ruiz.id });
  await page.goto("/cuentas/en-camino");
  await openCorrection(page, "Cancelar esta cuenta", "Cancelar cuenta");
  await page.getByLabel("Motivo").fill("Se abrió por error");

  const held = await holdSubmissions(page);
  await page.getByRole("button", { name: "Cancelar cuenta", exact: true }).click();
  await held.waitFor(1);

  await expect(title(page, "Cancelando cuenta…")).toBeFocused();
  const main = page.getByRole("main");
  // What was sent stays in sight, and nothing about it can be changed or sent again.
  await expect(main).toContainText("Familia Ruiz");
  await expect(main).toContainText("Se abrió por error");
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(main.getByRole("textbox")).toHaveCount(0);
  // Nothing says it is recorded: the server has not received it.
  await expect(page.getByText(/Cuenta cancelada|Cancelada por|ya no cuentan/)).toHaveCount(0);
  expect(await query("SELECT id FROM bill_voids")).toHaveLength(0);

  // Leaving does not cancel it, and says so; Back does not bring the form back.
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(dialog(page)).toContainText("La corrección puede estarse registrando");
  await expect(dialog(page)).toContainText("Salir no cancela el registro.");
  await dialog(page).getByRole("button", { name: "Quedarme aquí" }).click();
  await page.goBack();
  await dialog(page).getByRole("button", { name: "Quedarme aquí" }).click();
  await expect(title(page, "Cancelando cuenta…")).toBeVisible();
  await held.waitFor(1);

  await held.release();
  await expect(title(page, "Cuenta cancelada")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText(
    "Sus productos ya no cuentan. La cuenta se conserva, marcada como cancelada.",
  );
  expect(await query("SELECT reason FROM bill_voids")).toEqual([{ reason: "Se abrió por error" }]);
  await held.stop();

  // Read again only when asked: the Bill as it is now, with no way to undo.
  await seeBill(page);
  await expect(main).toContainText("Cancelada por Ana");
  await expect(page).toHaveURL(/\/cuentas\/en-camino$/);
});

test("a correction confirmed while a read of the Bill was on its way keeps its result, until the User goes on", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const item = await addItem({ name: "Torta", stockTracked: false });
  await seedBill(query, { id: "carrera", by: ana.id, itemId: item.id, lines: [2] });
  await page.goto("/cuentas/carrera");
  await openCorrection(page, "Cancelar esta cuenta", "Cancelar cuenta");
  await page.getByLabel("Motivo").fill("Era una prueba");

  // On its way, and the Admin goes back to the Bill anyway: the read that
  // navigation starts is held too, so it lands after the answer does.
  const held = await holdSubmissions(page, { loads: true });
  await page.getByRole("button", { name: "Cancelar cuenta", exact: true }).click();
  await held.waitFor(1);
  await page.goBack();
  await dialog(page).getByRole("button", { name: "Salir", exact: true }).click();
  await held.waitFor(2);

  await held.release();
  await expect(title(page, "Cuenta cancelada")).toBeVisible();
  await held.releaseAll();
  await expect(page).toHaveURL(/\/cuentas\/carrera$/);
  await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
  await held.stop();
  // The Bill, read before or after: the result is what the screen is about.
  await expect(title(page, "Cuenta cancelada")).toBeVisible();
  expect(await query("SELECT reason FROM bill_voids")).toEqual([{ reason: "Era una prueba" }]);

  await page.getByRole("button", { name: "Ver cuenta" }).click();
  await expect(title(page, "Cuenta")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Cancelada");
});

test("a correction that got no answer is of unknown outcome, never failed, and sent again it is recorded once", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const item = await addItem({ name: "Torta", stockTracked: false });
  await seedBill(query, { id: "sin-respuesta", by: ana.id, itemId: item.id, lines: [2, 1], paid: 1000, note: "Mesa 2" });
  await page.goto("/cuentas/sin-respuesta");
  await openCorrection(page, "Quitar pago de $10.00", "Quitar pago");
  await page.getByLabel("Motivo").fill("Se cobró dos veces");

  // The connection drops before the server gets anything.
  const dropped = (route: Route) => route.abort("connectionfailed");
  await page.route(CORRECTION, dropped);
  await page.getByRole("button", { name: "Quitar pago de $10.00" }).click();

  await expect(title(page, "No sabemos si se registró")).toBeFocused();
  const main = page.getByRole("main");
  await expect(main).toContainText("La corrección pudo registrarse o no. Volver a intentar no la registra dos veces.");
  await expect(main).not.toContainText(/falló|no se registró|quitado\b/i);
  // The screen is still Cuenta's own, with what was sent and nothing to edit.
  await expect(title(page, "Algo salió mal")).toHaveCount(0);
  await expect(main).toContainText("Mesa 2");
  await expect(main).toContainText("$10.00 en efectivo");
  await expect(main).toContainText("Se cobró dos veces");
  await expect(main.getByRole("textbox")).toHaveCount(0);
  await expect(main.getByRole("button")).toHaveText(["Volver a intentar"]);
  // An Admin can look for themselves; the way there warns that leaving cancels nothing.
  await main.getByRole("link", { name: "Revisar en Historial" }).click();
  await expect(dialog(page)).toContainText("Antes de repetir la corrección, revisa la cuenta.");
  await dialog(page).getByRole("button", { name: "Quedarme aquí" }).click();
  expect(await query("SELECT id FROM payment_removals")).toHaveLength(0);
  await page.unroute(CORRECTION, dropped);

  // The server records it; its answer never reaches the phone.
  const bodies: Array<string | null> = [];
  const lost = async (route: Route) => {
    bodies.push(route.request().postData());
    await route.fetch();
    await route.abort("connectionreset");
  };
  await page.route(CORRECTION, lost);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect.poll(() => query("SELECT reason FROM payment_removals")).toEqual([{ reason: "Se cobró dos veces" }]);
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await expect(main).not.toContainText(/falló|no se registró/i);
  await page.unroute(CORRECTION, lost);

  // The very same form, with the revision the step showed: the server finds
  // its own first attempt recorded, says so, and writes nothing again.
  const retried = page.waitForRequest(CORRECTION);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  expect((await retried).postData()).toBe(bodies[0]);
  expect(bodies[0]).toContain("revision=0");

  await expect(title(page, "Pago quitado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("$10.00 en efectivo. La cuenta debe $30.00.");
  expect(await query("SELECT COUNT(*) AS n FROM payment_removals")).toEqual([{ n: 1 }]);
  expect(await query("SELECT paid, state, revision FROM bills")).toEqual([{ paid: 0, state: "open", revision: 1 }]);
});

test("a correction against a Bill another phone changed is refused visibly, writes nothing and keeps the reason", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const item = await addItem({ name: "Torta", stockTracked: false });
  await seedBill(query, { id: "movida", by: ana.id, itemId: item.id, lines: [2, 1], paid: 1000 });
  await page.goto("/cuentas/movida");
  await openCorrection(page, "Quitar 1 × Torta", "Quitar producto");
  await page.getByLabel("Motivo").fill("No se lo llevó");

  // Another phone adds a Line: the Bill is no longer what the step showed.
  await query(
    `INSERT INTO lines (id, bill_id, item_id, quantity, unit_price, moved_stock, added_by, added_at, day)
     VALUES ('otra', 'movida', ?, 1, 1000, 0, ?, 3000, '2026-09-29')`,
    [item.id, ana.id],
  );
  await query("UPDATE bills SET total = total + 1000, revision = revision + 1 WHERE id = 'movida'");
  await page.getByRole("button", { name: "Quitar 1 × Torta" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "La cuenta cambió mientras intentabas corregirla y no se registró nada. Revísala y vuelve a intentar.",
  );
  // Still the step, read again: what it says is the Bill as it is now, and the
  // reason did not have to be typed twice.
  await expect(title(page, "Quitar producto")).toBeVisible();
  await expect(effects(page).getByRole("listitem").first()).toHaveText("El total de la cuenta baja de $40.00 a $30.00.");
  await expect(page.getByLabel("Motivo")).toHaveValue("No se lo llevó");
  expect(await query("SELECT id FROM line_removals")).toHaveLength(0);

  await page.getByRole("button", { name: "Quitar 1 × Torta" }).click();
  await expect(title(page, "Producto quitado")).toBeVisible();
  expect(await query("SELECT reason FROM line_removals")).toEqual([{ reason: "No se lo llevó" }]);

  // Another Admin voids the Bill while this one is about to remove its Payment:
  // there is no step left, so the Bill itself says what happened.
  await seeBill(page);
  await openCorrection(page, "Quitar pago de $10.00", "Quitar pago");
  await page.getByLabel("Motivo").fill("Por error");
  const carla = (await query("INSERT INTO users (id, name, role) VALUES ('carla', 'Carla', 'admin') RETURNING id"))[0]!;
  await query(
    "INSERT INTO bill_voids (id, bill_id, reason, voided_by, voided_at) VALUES ('v1', 'movida', 'Duplicada', ?, 4000)",
    [String(carla.id)],
  );
  await query("UPDATE bills SET state = 'voided', revision = revision + 1 WHERE id = 'movida'");
  await page.getByRole("button", { name: "Quitar pago de $10.00" }).click();

  await expect(title(page, "Cuenta")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("Esta cuenta está cancelada y ya no admite correcciones.");
  await expect(page.getByRole("main")).toContainText("Cancelada por Carla");
  await expect(page).toHaveURL(/\/cuentas\/movida$/);
  expect(await query("SELECT id FROM payment_removals")).toHaveLength(0);
});

test("a Worker whose Bill was paid from another phone is told nothing was recorded, without an error page", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const item = await addItem({ name: "Torta", stockTracked: false });
  await seedBill(query, { id: "ajena", by: beto.id, itemId: item.id, lines: [1, 1] });
  await page.goto("/cuentas/ajena");
  await openCorrection(page, "Quitar 1 × Torta", "Quitar producto");

  await query("UPDATE bills SET paid = total, state = 'paid', revision = revision + 1 WHERE id = 'ajena'");
  await page.getByRole("button", { name: "Quitar 1 × Torta" }).click();

  await expect(title(page, "No se registró la corrección")).toBeFocused();
  await expect(page.getByRole("alert")).toHaveText(
    "La cuenta ya no está abierta: se cobró o se canceló desde otro teléfono.",
  );
  await expect(title(page, "No tienes acceso a esta página")).toHaveCount(0);
  expect(await query("SELECT id FROM line_removals")).toHaveLength(0);
  await page.getByRole("link", { name: "Cuentas abiertas" }).click();
  await expect(page).toHaveURL(/cuentas-abiertas/);
});

test("a session that ended is told as that: nothing was recorded, and the reason is still there", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const item = await addItem({ name: "Torta", stockTracked: false });
  await seedBill(query, { id: "sesion", by: ana.id, itemId: item.id, lines: [1] });
  await page.goto("/cuentas/sesion");
  await openCorrection(page, "Cancelar esta cuenta", "Cancelar cuenta");
  await page.getByLabel("Motivo").fill("Era una prueba");

  await query("DELETE FROM sessions");
  await page.getByRole("button", { name: "Cancelar cuenta", exact: true }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "Tu sesión terminó y no se registró nada. Entra de nuevo y vuelve a intentar.",
  );
  await expect(title(page, "Cancelar cuenta")).toBeVisible();
  await expect(page.getByLabel("Motivo")).toHaveValue("Era una prueba");
  expect(await query("SELECT id FROM bill_voids")).toHaveLength(0);
});

const LONG_REASON =
  "La familia avisó por teléfono que la cuenta se abrió dos veces el mismo día, una desde cada teléfono, y que esta es la que sobra; se confirma con Guadalupe antes de cancelarla";

test("on a 320px phone a correction is made with the keyboard alone: the reason is asked for, and a long one stays whole", async ({
  page,
  signInAs,
  addItem,
  addCustomer,
  query,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const ana = await signInAs("admin", "María Guadalupe Hernández de la Torre");
  const item = await addItem({ name: "Chocolate caliente con malvaviscos y canela extra grande", stockTracked: false });
  const family = await addCustomer("Familia Hernández de la Torre y Villaseñor Echeverría", { by: ana });
  await seedBill(query, { id: "larga", by: ana.id, itemId: item.id, lines: [12, 3], paid: 2000, customerId: family.id });

  await page.goto("/cuentas/larga");
  expect(await nothingSideways(page)).toBe(true);
  const main = page.getByRole("main");
  // Every way into a correction is a target a thumb can hit.
  for (const link of await main.getByRole("link", { name: /^(Quitar|Cancelar)/ }).all()) {
    expect((await link.boundingBox())!.height, await link.innerText()).toBeGreaterThanOrEqual(48);
  }

  // With the keyboard: the link, then the action without a reason.
  await main.getByRole("link", { name: "Cancelar esta cuenta" }).focus();
  await page.keyboard.press("Enter");
  await expect(title(page, "Cancelar cuenta")).toBeFocused();
  expect(await nothingSideways(page)).toBe(true);
  await expect(page.getByRole("region", { name: "Cuenta" })).toContainText(
    "Familia Hernández de la Torre y Villaseñor Echeverría",
  );
  const action = page.getByRole("button", { name: "Cancelar cuenta", exact: true });
  await action.focus();
  await page.keyboard.press("Enter");

  // Nothing was sent: the field says what is missing and has the keyboard.
  const reason = page.getByLabel("Motivo");
  await expect(reason).toBeFocused();
  await expect(reason).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert")).toHaveText("Escribe el motivo.");
  expect(await query("SELECT id FROM bill_voids")).toHaveLength(0);

  await page.keyboard.type(LONG_REASON);
  // The field grows with what is typed, so the whole reason can be read back.
  expect(await reason.evaluate((field) => field.scrollHeight <= field.clientHeight + 1)).toBe(true);
  expect(await nothingSideways(page)).toBe(true);
  await page.keyboard.press("Tab");
  await expect(action).toBeFocused();
  // The bar at the bottom leaves the action in sight.
  const bar = (await destinations(page).boundingBox())!;
  const box = (await action.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  await page.keyboard.press("Enter");

  await expect(title(page, "Cuenta cancelada")).toBeFocused();
  await expect(main).toContainText(LONG_REASON);
  expect(await nothingSideways(page)).toBe(true);
  await page.getByRole("button", { name: "Ver cuenta" }).focus();
  await page.keyboard.press("Enter");
  await expect(title(page, "Cuenta")).toBeFocused();
  await expect(main).toContainText(`Motivo: ${LONG_REASON}`);
  await expect(main).toContainText("12 × Chocolate caliente con malvaviscos y canela extra grande");
  expect(await nothingSideways(page)).toBe(true);
  expect(await query("SELECT reason FROM bill_voids")).toEqual([{ reason: LONG_REASON }]);
});

test("with text twice as large a correction's step, its pending state and its result keep every word and nothing scrolls sideways", async ({
  page,
  signInAs,
  addItem,
  addCustomer,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const item = await addItem({ name: "Chocolate caliente con malvaviscos", stockTracked: false });
  const family = await addCustomer("Familia Hernández de la Torre", { by: ana });
  await seedBill(query, { id: "grande", by: ana.id, itemId: item.id, lines: [2, 1], paid: 1000, customerId: family.id });
  const enlarge = () => page.addStyleTag({ content: "html { font-size: 200% }" });

  await page.goto("/cuentas/grande");
  await enlarge();
  expect(await nothingSideways(page)).toBe(true);

  await openCorrection(page, "Quitar 1 × Chocolate caliente con malvaviscos", "Quitar producto");
  expect(await nothingSideways(page)).toBe(true);
  await expect(effects(page).getByRole("listitem").first()).toHaveText("El total de la cuenta baja de $30.00 a $20.00.");
  await page.getByLabel("Motivo").fill(LONG_REASON);
  expect(await nothingSideways(page)).toBe(true);
  const action = page.getByRole("button", { name: "Quitar 1 × Chocolate caliente con malvaviscos" });
  await action.focus();
  const bar = (await destinations(page).boundingBox())!;
  const box = (await action.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);

  const held = await holdSubmissions(page);
  await action.click();
  await held.waitFor(1);
  await expect(title(page, "Quitando 1 × Chocolate caliente con malvaviscos…")).toBeVisible();
  expect(await nothingSideways(page)).toBe(true);
  await held.release();

  await expect(title(page, "Producto quitado")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("La cuenta suma $20.00 y debe $10.00.");
  await expect(page.getByRole("main")).toContainText(LONG_REASON);
  expect(await nothingSideways(page)).toBe(true);
});
