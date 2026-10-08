import type { Locator, Page, Route } from "@playwright/test";

import { expect, test } from "./fixtures";
import { openPay, payBill, seeBill, summary, typePayment } from "./support/bill";
import { holdSubmissions } from "./support/held";
import { destinations, goTo } from "./support/navigate";
import { addToBill, leaveOpen } from "./support/sell";

// Finding an Open Bill and collecting a Payment (UI redesign §5.3, §6, §7,
// §10.1.7): Cuentas abiertas by Customer, Cuenta leading with what is owed,
// its two routine actions apart, and a Payment that is sent once, frozen, and
// said only as what is known: on its way, confirmed, refused or unknown.
// Requests are held or failed on purpose; no test waits on the network's own
// timing. Both projects run a phone viewport (playwright.config.ts).

type Query = (sql: string, params?: Array<string | number | null>) => Promise<Array<Record<string, unknown>>>;

const PAYMENT = "**/cuentas/*/cobrar";
const title = (page: Page, name: string) => page.getByRole("heading", { name, level: 1 });
const dialog = (page: Page) => page.getByRole("alertdialog");
const rows = (page: Page) => page.getByRole("list", { name: "Cuentas abiertas" }).getByRole("listitem");
const nothingSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** An Open Bill as its projections hold it, for a test that is about its Payment and not its Lines. */
const openBill = (
  query: Query,
  bill: { id: string; by: string; total: number; paid?: number; customerId?: string | null; note?: string | null },
) =>
  query(
    `INSERT INTO bills (id, day, opened_by, opened_at, customer_id, note, total, paid, state, revision)
     VALUES (?, '2026-09-29', ?, 1000, ?, ?, ?, ?, ?, 0)`,
    [
      bill.id,
      bill.by,
      bill.customerId ?? null,
      bill.note ?? null,
      bill.total,
      bill.paid ?? 0,
      (bill.paid ?? 0) > 0 ? "partial" : "open",
    ],
  );

/** What another phone's Payment leaves on the Bill: its projections and a new revision. */
const paidElsewhere = (query: Query, billId: string, paid: number) =>
  query(
    `UPDATE bills SET paid = ?, state = CASE WHEN ? = total THEN 'paid' ELSE 'partial' END, revision = revision + 1
     WHERE id = ?`,
    [paid, paid, billId],
  );

/** Taps and reports what the page showed when the browser painted its next frame. */
async function tapAndSeeNextFrame(control: Locator, text: string): Promise<boolean> {
  await control.evaluate((element, wanted) => {
    element.addEventListener(
      "click",
      () =>
        requestAnimationFrame(() => {
          (window as unknown as { seen?: boolean }).seen = document.body.innerText.includes(wanted);
        }),
      { once: true },
    );
  }, text);
  await control.click();
  const seen = await control.page().waitForFunction(() => (window as unknown as { seen?: boolean }).seen !== undefined);
  await seen.dispose();
  return control.page().evaluate(() => (window as unknown as { seen?: boolean }).seen === true);
}

test("a Worker finds a Customer's Bill by search, adds Items to it through Vender and takes a part and then the rest", async ({
  page,
  signInAs,
  addItem,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const agua = await addItem({ name: "Agua mineral", price: 1850, stock: { units: 10, by: beto } });
  await addItem({ name: "Café de olla", price: 2500, category: agua.category, stock: { units: 10, by: beto } });
  await addCustomer("Familia Ruiz", { by: beto });
  await addCustomer("Familia Paz", { by: beto });
  await page.goto("/");
  const billId = await leaveOpen(page, { items: ["Agua mineral"], customer: "Familia Ruiz", note: "Paga los viernes" });
  await leaveOpen(page, { items: ["Café de olla"], customer: "Familia Paz" });

  // Cuentas is the Worker's own destination, and it searches by Customer.
  await goTo(page, "Cuentas");
  await expect(rows(page)).toHaveCount(2);
  await page.getByLabel("Buscar por cliente").fill("familia r");
  await expect(rows(page)).toHaveCount(1);
  await expect(page).toHaveURL(/q=familia\+r/);
  const row = rows(page).first();
  await expect(row).toContainText("Familia Ruiz");
  await expect(row).toContainText("Paga los viernes");
  await expect(row).toContainText("Abierta");
  await expect(row).toContainText("Debe $18.50");
  await expect(row).toContainText("Total $18.50 · Pagado $0.00");
  await row.getByRole("link").click();

  // Cuenta leads with its state and what it owes, and names no owner.
  await expect(title(page, "Cuenta")).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toContainText("Abierta");
  await expect(summary(page)).toContainText("Debe $18.50");
  await expect(main.getByRole("link", { name: "Familia Ruiz" })).toBeVisible();
  await expect(main).not.toContainText(/Cuenta de Beto|Abierta por|Abrió/);
  // Taking money and adding Items are two actions, each with its own words.
  await expect(main.getByRole("link", { name: "Cobrar", exact: true })).toBeVisible();

  // Agregar productos is Vender's own flow, targeting this Bill to the end.
  await main.getByRole("link", { name: "Agregar productos" }).click();
  await expect(page.getByRole("region", { name: "Cuenta destino" })).toContainText("Se agrega a la cuenta de Familia Ruiz");
  expect(await addToBill(page, ["Café de olla"])).toBe(billId);
  await expect(page.getByRole("status")).toHaveText("No se registró ningún pago. La cuenta de Familia Ruiz debe $43.50.");
  await page.getByRole("link", { name: "Volver a la cuenta" }).click();
  await expect(summary(page)).toContainText("Debe $43.50");
  await expect(main).toContainText("1 × Agua mineral");
  await expect(main).toContainText("1 × Café de olla");

  // A part, in cash, with the change for what was handed over.
  await payBill(page, { amount: "20", handed: "50" });
  await expect(title(page, "Pago registrado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("$20.00 en efectivo. La cuenta de Familia Ruiz todavía debe $23.50.");
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$30.00");
  await seeBill(page);
  await expect(main).toContainText("Pago parcial");
  await expect(summary(page)).toContainText("Debe $23.50");
  const payments = page.getByRole("list", { name: "Pagos" }).getByRole("listitem");
  await expect(payments).toHaveText([/Efectivo\s*\$20\.00\s*Beto · \d{2}:\d{2}/]);
  // With a Payment, the Customer and the note are an Admin's to change.
  await expect(page.getByRole("heading", { name: "Cliente y nota" })).toHaveCount(0);

  // The rest: the Payment already is what the Bill owes, and more than that is not accepted.
  await openPay(page);
  await expect(page.getByRole("region", { name: "Cuenta" })).toContainText("Debe $23.50");
  await expect(page.getByRole("radio", { name: "Efectivo" })).toBeChecked();
  await typePayment(page, { method: "Transferencia", amount: "23.51" });
  await expect(page.getByRole("alert")).toHaveText("El pago no puede ser mayor que lo que debe la cuenta.");
  await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
  await expect(title(page, "Cobrar")).toBeVisible();
  await page.getByRole("button", { name: "Cobrar todo" }).click();
  await expect(page.getByLabel("Efectivo que te entregan (opcional)")).toHaveCount(0);
  await page.getByRole("button", { name: "Registrar pago de $23.50" }).click();

  // The Worker sees the result without being sent into a Bill they may no longer open.
  await expect(title(page, "Pago registrado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("$23.50 por transferencia. Cuenta pagada.");
  await expect(page.getByRole("region", { name: "Cambio" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ver cuenta" })).toHaveCount(0);
  await expect(title(page, "No tienes acceso a esta página")).toHaveCount(0);

  // Back on the list the search is as it was left, and the Paid Bill is gone.
  await main.getByRole("link", { name: "Cuentas abiertas" }).click();
  await expect(page).toHaveURL(/\/cuentas-abiertas\?q=familia\+r$/);
  await expect(page.getByLabel("Buscar por cliente")).toHaveValue("familia r");
  await expect(main).toContainText("Ninguna cuenta abierta es de un cliente que empiece con «familia r».");
  await main.getByRole("link", { name: "Ver todas las cuentas abiertas" }).click();
  await expect(rows(page)).toHaveText([/Familia Paz/]);

  expect(await query("SELECT total, paid, state FROM bills WHERE id = ?", [billId])).toEqual([
    { total: 4350, paid: 4350, state: "paid" },
  ]);
  expect(await query("SELECT amount, method, received_by FROM payments ORDER BY rowid")).toEqual([
    { amount: 2000, method: "cash", received_by: beto.id },
    { amount: 2350, method: "transfer", received_by: beto.id },
  ]);
  expect(await nothingSideways(page)).toBe(true);
});

test("an Admin finds a Bill, adds Items, takes a part and the rest, and opens the Paid Bill with its corrections", async ({
  page,
  signInAs,
  addItem,
  addCustomer,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  await addItem({ name: "Agua mineral", price: 1850, stock: { units: 10, by: ana } });
  const ruiz = await addCustomer("Familia Ruiz", { by: ana });
  await openBill(query, { id: "de-ruiz", by: ana.id, customerId: ruiz.id, total: 5000 });
  await openBill(query, { id: "sin-cliente", by: ana.id, note: "Mesa 4", total: 1000 });

  // An Admin reaches the same list from Más.
  await page.goto("/inicio");
  await goTo(page, "Cuentas abiertas");
  await page.getByLabel("Buscar por cliente").fill("fam");
  await expect(rows(page)).toHaveCount(1);
  await rows(page).first().getByRole("link").click();
  await expect(summary(page)).toContainText("Debe $50.00");

  await page.getByRole("link", { name: "Agregar productos" }).click();
  await addToBill(page, [["Agua mineral", 2]]);
  await expect(page.getByRole("status")).toHaveText("No se registró ningún pago. La cuenta de Familia Ruiz debe $87.00.");
  await page.getByRole("link", { name: "Volver a la cuenta" }).click();

  await payBill(page, { method: "Transferencia", amount: "37" });
  await expect(page.getByRole("status")).toHaveText("$37.00 por transferencia. La cuenta de Familia Ruiz todavía debe $50.00.");
  await seeBill(page);
  // An Admin still changes the Customer and the note after a Payment.
  await expect(page.getByRole("heading", { name: "Cliente y nota", level: 2 })).toBeVisible();

  await payBill(page, { handed: "100" });
  await expect(page.getByRole("status")).toHaveText("$50.00 en efectivo. Cuenta pagada.");
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$50.00");

  // An Admin may open the Paid Bill, and every correction is still there.
  await seeBill(page);
  const main = page.getByRole("main");
  await expect(main).toContainText("Pagada");
  await expect(summary(page)).toContainText("Debe $0.00");
  await expect(summary(page)).toContainText("Pagado $87.00");
  await expect(main.getByRole("link", { name: "Cobrar", exact: true })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Agregar productos" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: /^Quitar pago de / })).toHaveCount(2);
  await expect(main.getByRole("link", { name: "Cancelar esta cuenta" })).toBeVisible();

  expect(await query("SELECT amount, method FROM payments ORDER BY rowid")).toEqual([
    { amount: 3700, method: "transfer" },
    { amount: 5000, method: "cash" },
  ]);
});

test("a Payment on its way is said at once, keeps what was sent, shows no money as recorded and is not left by accident", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const ruiz = await addCustomer("Familia Ruiz", { by: beto });
  await openBill(query, { id: "en-camino", by: beto.id, customerId: ruiz.id, total: 5000 });
  await page.goto("/cuentas/en-camino");
  await openPay(page);
  await typePayment(page, { amount: "20", handed: "50" });

  const held = await holdSubmissions(page);
  const record = page.getByRole("button", { name: "Registrar pago de $20.00" });
  // Acknowledged by the next painted frame, with the request not even sent.
  expect(await tapAndSeeNextFrame(record, "Registrando pago de $20.00…")).toBe(true);
  await held.waitFor(1);

  await expect(title(page, "Registrando pago de $20.00…")).toBeFocused();
  const main = page.getByRole("main");
  // What was sent stays in sight, and nothing about it can be changed or sent again.
  await expect(main).toContainText("Familia Ruiz");
  await expect(main).toContainText("$20.00 · Efectivo");
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(main.getByRole("textbox")).toHaveCount(0);
  // Nothing says it is recorded: the server has not received it.
  await expect(page.getByText(/Pago registrado|todavía debe|Cuenta pagada/)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Cambio" })).toHaveCount(0);
  expect(await query("SELECT id FROM payments")).toHaveLength(0);

  // Leaving does not cancel it, and says so; Back does not bring the form back.
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(dialog(page)).toContainText("El pago puede estarse registrando");
  await expect(dialog(page)).toContainText("Salir no cancela el registro.");
  await dialog(page).getByRole("button", { name: "Quedarme aquí" }).click();
  await page.goBack();
  await dialog(page).getByRole("button", { name: "Quedarme aquí" }).click();
  await expect(title(page, "Registrando pago de $20.00…")).toBeVisible();
  await held.waitFor(1);

  await held.release();
  await expect(title(page, "Pago registrado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("$20.00 en efectivo. La cuenta de Familia Ruiz todavía debe $30.00.");
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$30.00");
  expect(await query("SELECT amount FROM payments")).toEqual([{ amount: 2000 }]);

  // A confirmed Payment has nothing to lose: leaving it asks nothing.
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(page).toHaveURL(/\/inicio$/);
});

test("a Payment that got no answer is of unknown outcome, never failed, and is retried as the very same Payment", async ({
  page,
  signInAs,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  await openBill(query, { id: "sin-respuesta", by: beto.id, note: "Mesa 2", total: 5000 });
  await page.goto("/cuentas/sin-respuesta");
  await openPay(page);
  await typePayment(page, { amount: "20", handed: "50" });

  // The connection drops before the server gets anything.
  const dropped = (route: Route) => route.abort("connectionfailed");
  await page.route(PAYMENT, dropped);
  await page.getByRole("button", { name: "Registrar pago de $20.00" }).click();

  await expect(title(page, "No sabemos si se registró")).toBeFocused();
  const main = page.getByRole("main");
  await expect(main).toContainText("El pago pudo registrarse o no. Volver a intentar no lo registra dos veces.");
  await expect(main).not.toContainText(/falló|no se registró|registrado\b|pagada/i);
  // The screen is still Cuenta's own, with what was sent and nothing to edit.
  await expect(title(page, "Algo salió mal")).toHaveCount(0);
  await expect(main).toContainText("Mesa 2");
  await expect(main).toContainText("$20.00 · Efectivo");
  await expect(main.getByRole("textbox")).toHaveCount(0);
  await expect(main.getByRole("button")).toHaveText(["Volver a intentar"]);
  expect(await query("SELECT id FROM payments")).toHaveLength(0);
  await page.unroute(PAYMENT, dropped);

  // The server fails: unknown too, and the screen is not replaced by an error page.
  const broken = (route: Route) => route.fulfill({ status: 500, body: "Internal Server Error" });
  await page.route(PAYMENT, broken);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await expect(title(page, "Algo salió mal")).toHaveCount(0);
  await page.unroute(PAYMENT, broken);

  // The server records it; its answer never reaches the phone.
  const bodies: Array<string | null> = [];
  const lost = async (route: Route) => {
    bodies.push(route.request().postData());
    await route.fetch();
    await route.abort("connectionreset");
  };
  await page.route(PAYMENT, lost);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect.poll(() => query("SELECT amount FROM payments")).toEqual([{ amount: 2000 }]);
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await expect(main).not.toContainText(/falló|no se registró/i);
  await page.unroute(PAYMENT, lost);

  // The very same form, its key and its content: answered as the first, recorded once.
  const retried = page.waitForRequest(PAYMENT);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  expect((await retried).postData()).toBe(bodies[0]);
  expect(bodies[0]).toMatch(/submissionKey=[0-9a-f-]{36}/);

  await expect(title(page, "Pago registrado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("$20.00 en efectivo. La cuenta todavía debe $30.00.");
  // The change it was sent with is still there to hand over.
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$30.00");
  expect(await query("SELECT amount FROM payments")).toEqual([{ amount: 2000 }]);
  expect(await query("SELECT paid, state FROM bills")).toEqual([{ paid: 2000, state: "partial" }]);
});

test("a session that ended is told as that on a first attempt: nothing was recorded", async ({ page, signInAs, query }) => {
  const beto = await signInAs("worker", "Beto");
  await openBill(query, { id: "sesion", by: beto.id, total: 5000 });
  await page.goto("/cuentas/sesion");
  await openPay(page);
  await typePayment(page, { method: "Transferencia" });

  await query("DELETE FROM sessions");
  await page.getByRole("button", { name: "Registrar pago de $50.00" }).click();

  // Entrar answered before any action ran, and what was chosen is still chosen.
  await expect(page.getByRole("alert")).toHaveText(
    "Tu sesión terminó y no se registró nada. Entra de nuevo y vuelve a intentar.",
  );
  await expect(title(page, "Cobrar")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Transferencia" })).toBeChecked();
  expect(await query("SELECT id FROM payments")).toHaveLength(0);
});

test("a Payment of unknown outcome warns before it is left, and after a session ended says only what is known", async ({
  page,
  signInAs,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  await openBill(query, { id: "sesion", by: beto.id, total: 5000 });
  await page.goto("/cuentas/sesion");
  await openPay(page);

  // Recorded, and the answer lost.
  const lost = async (route: Route) => {
    await route.fetch();
    await route.abort("connectionreset");
  };
  await page.route(PAYMENT, lost);
  await page.getByRole("button", { name: "Registrar pago de $50.00" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await page.unroute(PAYMENT, lost);

  // A retry that finds the session ended does not say nothing was recorded.
  await query("DELETE FROM sessions");
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  const main = page.getByRole("main");
  await expect(main).toContainText("Tu sesión terminó antes de saberlo.");
  await expect(main).not.toContainText(/no se registró nada/i);
  await expect(main.getByRole("link", { name: "Entrar de nuevo" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Volver a intentar" })).toHaveCount(0);

  // The way to check what was recorded warns that leaving cancels nothing.
  await main.getByRole("link", { name: "Revisar en Mi día" }).click();
  await expect(dialog(page)).toContainText("Salir no cancela el registro. Antes de repetir el pago, revisa Mi día.");
  await dialog(page).getByRole("button", { name: "Quedarme aquí" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  expect(await query("SELECT amount FROM payments")).toEqual([{ amount: 5000 }]);
});

test("a Payment against a Bill another phone changed is refused visibly, writes nothing, and is typed again against what is owed now", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const ruiz = await addCustomer("Familia Ruiz", { by: ana });
  await openBill(query, { id: "cambiada", by: ana.id, customerId: ruiz.id, total: 5000 });
  await page.goto("/cuentas/cambiada");
  await openPay(page);
  await typePayment(page, { method: "Transferencia" });

  // Another phone takes $30.00 first.
  await paidElsewhere(query, "cambiada", 3000);
  await page.getByRole("button", { name: "Registrar pago de $50.00" }).click();

  // Refused, on the step it was sent from, with what was chosen still chosen...
  await expect(page.getByRole("alert")).toHaveText(
    "La cuenta cambió mientras registrabas el pago. Revisa el monto y vuelve a intentar.",
  );
  await expect(title(page, "Cobrar")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Transferencia" })).toBeChecked();
  expect(await query("SELECT id FROM payments")).toHaveLength(0);
  // ...and the Bill read again: the Payment is now for what it owes today.
  await expect(page.getByRole("region", { name: "Cuenta" })).toContainText("Debe $20.00");
  const record = page.getByRole("button", { name: "Registrar pago de $20.00" });
  await expect(record).toBeVisible();

  await record.click();
  await expect(title(page, "Pago registrado")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("$20.00 por transferencia. Cuenta pagada.");
  expect(await query("SELECT amount, method FROM payments")).toEqual([{ amount: 2000, method: "transfer" }]);
  expect(await query("SELECT paid, state FROM bills")).toEqual([{ paid: 5000, state: "paid" }]);
});

test("an Admin whose Bill was paid in full from another phone is told on the Bill, with nothing left to charge", async ({
  page,
  signInAs,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  await openBill(query, { id: "ya-pagada", by: ana.id, total: 5000 });
  await openBill(query, { id: "otra", by: ana.id, note: "Mesa 3", total: 1000 });
  await page.goto("/cuentas-abiertas");
  await rows(page).filter({ hasText: "$50.00" }).getByRole("link").click();
  await openPay(page);

  await paidElsewhere(query, "ya-pagada", 5000);
  await page.getByRole("button", { name: "Registrar pago de $50.00" }).click();

  await expect(title(page, "Cuenta")).toBeVisible();
  await expect(page).toHaveURL(/\/cuentas\/ya-pagada$/);
  await expect(page.getByRole("alert")).toContainText("La cuenta cambió mientras registrabas el pago.");
  await expect(page.getByRole("main")).toContainText("Pagada");
  await expect(page.getByRole("link", { name: "Cobrar", exact: true })).toHaveCount(0);
  expect(await query("SELECT id FROM payments")).toHaveLength(0);

  // The step left no second entry of the Bill behind: the way back is the list.
  await page.getByRole("main").getByRole("link", { name: "Cuentas abiertas" }).click();
  await expect(page).toHaveURL(/\/cuentas-abiertas$/);
  await expect(rows(page)).toHaveText([/Mesa 3/]);
});

test("a Payment confirmed after its step was left still shows its result and its change", async ({
  page,
  signInAs,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  await openBill(query, { id: "tardia", by: ana.id, total: 5000 });
  await page.goto("/cuentas/tardia");
  await openPay(page);
  await typePayment(page, { handed: "100" });

  // Recorded, the answer lost, and the User goes back to the Bill anyway.
  const lost = async (route: Route) => {
    await route.fetch();
    await route.abort("connectionreset");
  };
  await page.route(PAYMENT, lost);
  await page.getByRole("button", { name: "Registrar pago de $50.00" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await page.unroute(PAYMENT, lost);
  await page.goBack();
  await dialog(page).getByRole("button", { name: "Salir", exact: true }).click();
  await expect(page).toHaveURL(/\/cuentas\/tardia$/);
  // The Bill was read again meanwhile; the Payment is still what the screen is about.
  await expect(title(page, "No sabemos si se registró")).toBeVisible();

  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(title(page, "Pago registrado")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("$50.00 en efectivo. Cuenta pagada.");
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$50.00");
  expect(await query("SELECT amount FROM payments")).toEqual([{ amount: 5000 }]);

  await seeBill(page);
  await expect(page.getByRole("main")).toContainText("Pagada");
});

test("a Worker whose Bill was paid from another phone is told nothing was recorded, without an error page", async ({
  page,
  signInAs,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  await openBill(query, { id: "ajena", by: beto.id, note: "Mesa 7", total: 5000 });
  await page.goto("/cuentas-abiertas");
  await rows(page).first().getByRole("link").click();
  await openPay(page);

  await paidElsewhere(query, "ajena", 5000);
  await page.getByRole("button", { name: "Registrar pago de $50.00" }).click();

  await expect(title(page, "No se registró el pago")).toBeFocused();
  await expect(page.getByRole("alert")).toHaveText(
    "La cuenta ya no está abierta: se cobró o se canceló desde otro teléfono.",
  );
  const main = page.getByRole("main");
  await expect(main).toContainText("Mesa 7");
  await expect(title(page, "No tienes acceso a esta página")).toHaveCount(0);
  await expect(main.getByRole("button")).toHaveCount(0);
  expect(await query("SELECT id FROM payments")).toHaveLength(0);

  await main.getByRole("link", { name: "Cuentas abiertas" }).click();
  await expect(page).toHaveURL(/\/cuentas-abiertas$/);
  await expect(main).toContainText("No hay cuentas abiertas.");
});

test("Cliente y nota saved against a Bill that changed says so and applies nothing", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  await addCustomer("Familia Ruiz", { by: beto });
  await openBill(query, { id: "editada", by: beto.id, note: "Mesa 1", total: 5000 });
  await page.goto("/cuentas/editada");

  await page.getByLabel("Cliente", { exact: true }).pressSequentially("Fam");
  await page.getByRole("list", { name: "Coincidencias" }).getByRole("button", { name: "Familia Ruiz" }).click();
  await page.getByLabel("Nota (opcional)").fill("Mesa 9");
  // Another phone adds to the Bill meanwhile.
  await query("UPDATE bills SET total = 6000, revision = revision + 1 WHERE id = 'editada'");
  await page.getByRole("button", { name: "Guardar" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "La cuenta cambió mientras la editabas y no se guardó nada. Revisa el cliente y la nota, y guarda de nuevo.",
  );
  // Neither field was applied, and what was typed is still there to send again.
  expect(await query("SELECT customer_id, note FROM bills")).toEqual([{ customer_id: null, note: "Mesa 1" }]);
  expect(await query("SELECT id FROM bill_edits")).toHaveLength(0);
  await expect(summary(page)).toContainText("Debe $60.00");
  await expect(page.getByLabel("Nota (opcional)")).toHaveValue("Mesa 9");
  await expect(page.getByRole("group", { name: "Cliente" })).toContainText("Familia Ruiz");

  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("status")).toHaveText("Se guardaron los cambios de la cuenta.");
  expect(await query("SELECT field, edited_by FROM bill_edits ORDER BY rowid")).toEqual([
    { field: "customer", edited_by: beto.id },
    { field: "note", edited_by: beto.id },
  ]);
});

test("on a 320px phone long names and large amounts stay whole, and the Payment is taken with the keyboard alone", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const ana = await signInAs("admin", "María Guadalupe Hernández de la Torre");
  const family = await addCustomer("Familia Hernández de la Torre y Villaseñor Echeverría", { by: ana });
  await openBill(query, { id: "larga", by: ana.id, customerId: family.id, note: "Paga a fin de mes, sin falta", total: 12345678 });
  await query(
    "INSERT INTO payments (id, bill_id, amount, method, received_by, received_at, day) VALUES ('p1', 'larga', 100000, 'transfer', ?, 2000, '2026-09-29')",
    [ana.id],
  );
  await paidElsewhere(query, "larga", 100000);

  await page.goto("/cuentas-abiertas");
  const row = rows(page).first();
  await expect(row).toContainText("Familia Hernández de la Torre y Villaseñor Echeverría");
  await expect(row).toContainText("Pago parcial");
  await expect(row).toContainText("Debe $122,456.78");
  expect(await nothingSideways(page)).toBe(true);
  // Nothing is cut: the row's words fit inside it.
  expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  // With the keyboard: the row, then Cobrar, the method, and the action.
  await row.getByRole("link").focus();
  await page.keyboard.press("Enter");
  await expect(title(page, "Cuenta")).toBeVisible();
  expect(await nothingSideways(page)).toBe(true);
  await expect(summary(page)).toContainText("Debe $122,456.78");
  await expect(page.getByRole("list", { name: "Pagos" })).toContainText("María Guadalupe Hernández de la Torre");
  for (const control of await page.getByRole("main").getByRole("link").or(page.getByRole("main").getByRole("button")).all()) {
    if ((await control.getAttribute("class"))?.includes("underline")) continue;
    expect((await control.boundingBox())!.height, await control.innerText()).toBeGreaterThanOrEqual(48);
  }

  await page.getByRole("link", { name: "Cobrar", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(title(page, "Cobrar")).toBeFocused();
  expect(await nothingSideways(page)).toBe(true);
  await page.getByRole("radio", { name: "Efectivo" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "Transferencia" })).toBeChecked();
  const record = page.getByRole("button", { name: "Registrar pago de $122,456.78" });
  await record.focus();
  // The bar at the bottom leaves the action in sight.
  const bar = (await destinations(page).boundingBox())!;
  const box = (await record.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  await page.keyboard.press("Enter");

  await expect(title(page, "Pago registrado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText(
    "$122,456.78 por transferencia. Cuenta pagada.",
  );
  expect(await nothingSideways(page)).toBe(true);
  await page.getByRole("button", { name: "Ver cuenta" }).focus();
  await page.keyboard.press("Enter");
  await expect(title(page, "Cuenta")).toBeFocused();
  await expect(page.getByRole("main")).toContainText("Pagada");
  expect(await nothingSideways(page)).toBe(true);
});

test("with text twice as large the list, the Bill, the Payment and its result keep every word and nothing scrolls sideways", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const family = await addCustomer("Familia Hernández de la Torre", { by: beto });
  await openBill(query, { id: "grande", by: beto.id, customerId: family.id, total: 123450 });
  const enlarge = () => page.addStyleTag({ content: "html { font-size: 200% }" });

  await page.goto("/cuentas-abiertas");
  await enlarge();
  expect(await nothingSideways(page)).toBe(true);
  await expect(rows(page).first()).toContainText("Debe $1,234.50");
  await expect(page.getByLabel("Buscar por cliente")).toBeVisible();

  await rows(page).first().getByRole("link").click();
  await expect(title(page, "Cuenta")).toBeVisible();
  expect(await nothingSideways(page)).toBe(true);
  await expect(summary(page)).toContainText("Debe $1,234.50");

  await openPay(page);
  expect(await nothingSideways(page)).toBe(true);
  await typePayment(page, { amount: "1000", handed: "1500" });
  await expect(page.getByText("Cambio: $500.00")).toBeVisible();
  expect(await nothingSideways(page)).toBe(true);
  const record = page.getByRole("button", { name: "Registrar pago de $1,000.00" });
  await record.focus();
  const bar = (await destinations(page).boundingBox())!;
  const box = (await record.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  await record.click();

  await expect(title(page, "Pago registrado")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("todavía debe $234.50.");
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$500.00");
  expect(await nothingSideways(page)).toBe(true);
});
