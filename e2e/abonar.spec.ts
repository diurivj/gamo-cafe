import type { Locator, Page, Route } from "@playwright/test";

import { expect, test } from "./fixtures";
import { typePayment } from "./support/bill";
import { abonar, handovers, openAbonar, openBills, owed, seeCustomer } from "./support/customer";
import { holdSubmissions } from "./support/held";
import { destinations, goTo } from "./support/navigate";
import { review, select } from "./support/sell";

// Finding a Customer and collecting what they owe (spec §5.5, §8.3, §10.3; UI
// redesign §5.3, §6, §7, §10.1.7): the Customer's page leads with who they are
// and what they owe, and Abonar is a step that takes one handover across
// their Open Bills, oldest first — one shared-reference Payment per Bill, all
// or nothing — sent once, frozen, and said only as what is known. A Customer
// with several Open Bills is seeded directly: the routing rule of §5.3 keeps
// one Open Bill per Customer per Day. Requests are held or failed on purpose;
// no test waits on the network's own timing. Both projects run a phone
// viewport (playwright.config.ts).

type Query = (sql: string, params?: Array<string | number | null>) => Promise<Array<Record<string, unknown>>>;

const HANDOVER = "**/clientes/*/abonar";
const title = (page: Page, name: string) => page.getByRole("heading", { name, level: 1 });
const dialog = (page: Page) => page.getByRole("alertdialog");
const nothingSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** A Customer's Bills as their projections hold them, oldest first: `[id, total, paid]`. */
async function billsOf(
  query: Query,
  customerId: string,
  by: string,
  bills: ReadonlyArray<readonly [id: string, total: number, paid?: number]>,
) {
  for (const [index, [id, total, paid = 0]] of bills.entries()) {
    await query(
      `INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [id, `2026-09-${20 + index}`, by, 1000 * (index + 1), customerId, total, paid, paid === total ? "paid" : paid > 0 ? "partial" : "open"],
    );
  }
}

/** What another phone's Payment leaves on a Bill: its projections and a new revision. */
const paidElsewhere = (query: Query, billId: string, paid: number) =>
  query(
    `UPDATE bills SET paid = ?, state = CASE WHEN ? = total THEN 'paid' ELSE 'partial' END, revision = revision + 1
     WHERE id = ?`,
    [paid, paid, billId],
  );

const payments = (query: Query) =>
  query("SELECT bill_id, amount, method, received_by, handover_reference FROM payments ORDER BY rowid");

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

test("a Worker finds a Customer, pays part by transfer and the rest in cash, oldest Bill first", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const ruiz = await addCustomer("Familia Ruiz", { by: beto });
  await addCustomer("Rosa", { by: beto });
  // Two Open Bills, oldest first: $50.00 and $30.00, plus a Paid one that
  // must not move or show.
  await billsOf(query, ruiz.id, beto.id, [
    ["ruiz-pagada", 1000, 1000],
    ["ruiz-vieja", 5000],
    ["ruiz-nueva", 3000],
  ]);

  await page.goto("/inicio");
  await goTo(page, "Clientes");
  await page.getByLabel("Buscar o agregar").pressSequentially("fam");
  await page.getByRole("list", { name: "Clientes" }).getByRole("link", { name: /Familia Ruiz/ }).click();

  // Who they are and what they owe come first; only the Open Bills are listed.
  await expect(title(page, "Familia Ruiz")).toBeVisible();
  await expect(owed(page)).toContainText("Debe $80.00");
  await expect(owed(page)).toContainText("En 2 cuentas abiertas.");
  await expect(openBills(page)).toHaveCount(2);
  await expect(openBills(page).first()).toContainText("Debe $50.00");
  await expect(page.getByRole("main")).not.toContainText("ruiz-pagada");
  // A Worker is not sent the past Bills, nor offered what only an Admin does.
  await expect(page.getByRole("heading", { name: "Cuentas pasadas" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Administrar cliente" })).toHaveCount(0);

  await openAbonar(page);
  await expect(page).toHaveURL(/\?paso=abonar$/);
  await expect(page.getByRole("region", { name: "Cliente" })).toContainText("Familia Ruiz");
  await expect(page.getByRole("region", { name: "Cliente" })).toContainText("Debe $80.00");
  await expect(page.getByText("Paga primero la cuenta más antigua.")).toBeVisible();
  // Everything they owe by default, in cash.
  await expect(page.getByRole("radio", { name: "Efectivo" })).toBeChecked();
  await expect(page.getByRole("button", { name: "Registrar abono de $80.00" })).toBeVisible();

  // More than they owe is said on the field, and nothing is sent.
  await typePayment(page, { amount: "100.00" });
  await expect(page.getByRole("alert")).toHaveText("El abono no puede ser mayor que lo que debe el cliente.");
  await page.getByRole("button", { name: "Registrar abono", exact: true }).click();
  await expect(title(page, "Abonar")).toBeVisible();
  expect(await payments(query)).toHaveLength(0);

  // $60.00 covers the oldest Bill and puts $10.00 on the next one.
  await page.getByLabel("Monto a cobrar").fill("60");
  await page.getByRole("radio", { name: "Transferencia" }).check();
  await page.getByRole("button", { name: "Registrar abono de $60.00" }).click();

  await expect(title(page, "Abono registrado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText(
    "$60.00 por transferencia, en 2 cuentas. Familia Ruiz todavía debe $20.00.",
  );
  await expect(page.getByRole("region", { name: "Cambio" })).toHaveCount(0);
  expect(await query("SELECT id, paid, state FROM bills ORDER BY opened_at")).toEqual([
    { id: "ruiz-pagada", paid: 1000, state: "paid" },
    { id: "ruiz-vieja", paid: 5000, state: "paid" },
    { id: "ruiz-nueva", paid: 1000, state: "partial" },
  ]);
  // One Payment per Bill, same method, receiver and reference.
  const first = await payments(query);
  expect(first).toMatchObject([
    { bill_id: "ruiz-vieja", amount: 5000, method: "transfer", received_by: beto.id },
    { bill_id: "ruiz-nueva", amount: 1000, method: "transfer", received_by: beto.id },
  ]);
  expect(first[0]!.handover_reference).toBeTruthy();
  expect(first[1]!.handover_reference).toBe(first[0]!.handover_reference);

  // The rest in cash is another handover: it starts as cash for what is left.
  await page.getByRole("button", { name: "Registrar otro abono" }).click();
  await expect(title(page, "Abonar")).toBeFocused();
  await expect(page.getByRole("radio", { name: "Efectivo" })).toBeChecked();
  await expect(page.getByRole("region", { name: "Cliente" })).toContainText("Debe $20.00");
  await typePayment(page, { handed: "50" });
  await expect(page.getByText("Cambio: $30.00")).toBeVisible();
  await page.getByRole("button", { name: "Registrar abono de $20.00" }).click();

  await expect(title(page, "Abono registrado")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("$20.00 en efectivo, en 1 cuenta. Familia Ruiz ya no debe nada.");
  // The change stays in sight to hand over, and nothing more is offered to collect.
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$30.00");
  await expect(page.getByRole("button", { name: "Registrar otro abono" })).toHaveCount(0);
  const all = await payments(query);
  expect(all).toMatchObject([
    { bill_id: "ruiz-vieja", amount: 5000, method: "transfer" },
    { bill_id: "ruiz-nueva", amount: 1000, method: "transfer" },
    { bill_id: "ruiz-nueva", amount: 2000, method: "cash", received_by: beto.id },
  ]);
  expect(all[2]!.handover_reference).not.toBe(all[0]!.handover_reference);
  expect(await query("SELECT state FROM bills WHERE state <> 'paid'")).toEqual([]);

  // The Customer, read again: nothing owed, and each handover as one event.
  await seeCustomer(page, "Familia Ruiz");
  await expect(page).toHaveURL(new RegExp(`/clientes/${ruiz.id}$`));
  await expect(owed(page)).toContainText("No debe nada.");
  await expect(page.getByRole("link", { name: "Abonar", exact: true })).toHaveCount(0);
  await expect(handovers(page)).toHaveCount(2);
  await expect(handovers(page).nth(0)).toContainText("Efectivo");
  await expect(handovers(page).nth(0)).toContainText("$20.00");
  await expect(handovers(page).nth(1)).toContainText("Transferencia");
  await expect(handovers(page).nth(1)).toContainText("$60.00");
  await expect(handovers(page).nth(1)).toContainText("Beto");
  await expect(handovers(page).nth(1)).toContainText("Repartido en 2 cuentas");
  expect(await nothingSideways(page)).toBe(true);

  // The way back is the list as it was searched.
  await page.getByRole("main").getByRole("link", { name: "Clientes" }).click();
  await expect(page).toHaveURL(/\/clientes\?q=fam$/);
  await expect(page.getByLabel("Buscar o agregar")).toHaveValue("fam");
  await expect(page.getByRole("list", { name: "Clientes" }).getByRole("link")).toHaveText([/Familia Ruiz/]);
});

test("an Admin pays everything a Customer owes, and moves between the Customer and their Bills", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const paz = await addCustomer("Familia Paz", { by: ana, note: "Paga los viernes" });
  await billsOf(query, paz.id, ana.id, [
    ["paz-a", 5000],
    ["paz-b", 3000, 1000],
  ]);

  await page.goto(`/clientes/${paz.id}`);
  await expect(page.getByText("Paga los viernes")).toBeVisible();
  await expect(owed(page)).toContainText("Debe $70.00");
  await expect(openBills(page).nth(1)).toContainText("Pago parcial");

  // An Open Bill opens its Cuenta, whose way back is this Customer.
  await openBills(page).first().getByRole("link").click();
  await expect(title(page, "Cuenta")).toBeVisible();
  await expect(page).toHaveURL(/\/cuentas\/paz-a$/);
  await page.getByRole("main").getByRole("link", { name: "Cliente", exact: true }).click();
  await expect(title(page, "Familia Paz")).toBeVisible();

  await abonar(page);
  await expect(page.getByRole("status")).toHaveText("$70.00 en efectivo, en 2 cuentas. Familia Paz ya no debe nada.");
  expect(await query("SELECT id, paid, state FROM bills ORDER BY opened_at")).toEqual([
    { id: "paz-a", paid: 5000, state: "paid" },
    { id: "paz-b", paid: 3000, state: "paid" },
  ]);
  expect(await payments(query)).toMatchObject([
    { bill_id: "paz-a", amount: 5000, method: "cash", received_by: ana.id },
    { bill_id: "paz-b", amount: 2000, method: "cash", received_by: ana.id },
  ]);

  // An Admin finds the Bills it paid among the past ones.
  await seeCustomer(page, "Familia Paz");
  await expect(page.getByText("No tiene cuentas abiertas.")).toBeVisible();
  const past = page.getByRole("list", { name: "Cuentas pasadas" }).getByRole("listitem");
  await expect(past).toHaveCount(2);
  await expect(past.first()).toContainText("Pagada");
  await past.first().getByRole("link").click();
  await expect(title(page, "Cuenta")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Pagada");
});

test("an Abonar on its way is said at once, keeps what was sent, shows no money as recorded and is not left by accident", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const ruiz = await addCustomer("Familia Ruiz", { by: beto });
  await billsOf(query, ruiz.id, beto.id, [["en-camino", 5000]]);
  await page.goto(`/clientes/${ruiz.id}`);
  await openAbonar(page);
  await typePayment(page, { amount: "20", handed: "50" });
  const held = await holdSubmissions(page);

  // The tap is answered by the next frame, before any answer can have come.
  expect(
    await tapAndSeeNextFrame(page.getByRole("button", { name: "Registrar abono de $20.00" }), "Registrando abono de $20.00…"),
  ).toBe(true);
  await held.waitFor(1);

  // Frozen: what was sent is in sight, and there is nothing to type or send again.
  const main = page.getByRole("main");
  await expect(title(page, "Registrando abono de $20.00…")).toBeFocused();
  await expect(main).toContainText("Espera la confirmación.");
  await expect(main).toContainText("Familia Ruiz");
  await expect(main).toContainText("$20.00 · Efectivo");
  await expect(main.getByRole("textbox")).toHaveCount(0);
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(page.getByText(/Abono registrado|todavía debe|ya no debe/)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Cambio" })).toHaveCount(0);
  expect(await payments(query)).toHaveLength(0);

  // Leaving does not cancel it, and says so; Back does not bring the form back.
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(dialog(page)).toContainText("El abono puede estarse registrando");
  await expect(dialog(page)).toContainText("Salir no cancela el registro.");
  await dialog(page).getByRole("button", { name: "Quedarme aquí" }).click();
  await page.goBack();
  await dialog(page).getByRole("button", { name: "Quedarme aquí" }).click();
  await expect(title(page, "Registrando abono de $20.00…")).toBeVisible();
  await held.waitFor(1);

  await held.release();
  await expect(title(page, "Abono registrado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("$20.00 en efectivo, en 1 cuenta. Familia Ruiz todavía debe $30.00.");
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$30.00");
  expect(await payments(query)).toMatchObject([{ bill_id: "en-camino", amount: 2000 }]);

  // A confirmed handover has nothing to lose: leaving it asks nothing.
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(page).toHaveURL(/\/inicio$/);
});

test("an Abonar that got no answer is of unknown outcome, never failed, and is retried as the very same handover", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const ruiz = await addCustomer("Familia Ruiz", { by: beto });
  await billsOf(query, ruiz.id, beto.id, [
    ["sin-respuesta-a", 5000],
    ["sin-respuesta-b", 3000],
  ]);
  await page.goto(`/clientes/${ruiz.id}`);
  await openAbonar(page);
  await typePayment(page, { amount: "60", handed: "100" });

  // The connection drops before the server gets anything.
  const dropped = (route: Route) => route.abort("connectionfailed");
  await page.route(HANDOVER, dropped);
  await page.getByRole("button", { name: "Registrar abono de $60.00" }).click();

  await expect(title(page, "No sabemos si se registró")).toBeFocused();
  const main = page.getByRole("main");
  await expect(main).toContainText("El abono pudo registrarse o no. Volver a intentar no lo registra dos veces.");
  await expect(main).not.toContainText(/falló|no se registró|registrado\b|ya no debe/i);
  // The screen is still the Customer's own, with what was sent and nothing to edit.
  await expect(title(page, "Algo salió mal")).toHaveCount(0);
  await expect(main).toContainText("Familia Ruiz");
  await expect(main).toContainText("$60.00 · Efectivo");
  await expect(main.getByRole("textbox")).toHaveCount(0);
  await expect(main.getByRole("button")).toHaveText(["Volver a intentar"]);
  expect(await payments(query)).toHaveLength(0);
  await page.unroute(HANDOVER, dropped);

  // The server fails: unknown too, and the screen is not replaced by an error page.
  const broken = (route: Route) => route.fulfill({ status: 500, body: "Internal Server Error" });
  await page.route(HANDOVER, broken);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await expect(title(page, "Algo salió mal")).toHaveCount(0);
  await page.unroute(HANDOVER, broken);

  // The server records it; its answer never reaches the phone.
  const bodies: Array<string | null> = [];
  const lost = async (route: Route) => {
    bodies.push(route.request().postData());
    await route.fetch();
    await route.abort("connectionreset");
  };
  await page.route(HANDOVER, lost);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect.poll(async () => (await payments(query)).length).toBe(2);
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await expect(main).not.toContainText(/falló|no se registró/i);
  await page.unroute(HANDOVER, lost);
  // Nothing was read meanwhile: no figure on screen moved.
  const recorded = await payments(query);

  // The very same form, its key, its Bills and its content: answered as the first, recorded once.
  const retried = page.waitForRequest(HANDOVER);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  expect((await retried).postData()).toBe(bodies[0]);
  expect(bodies[0]).toMatch(/submissionKey=[0-9a-f-]{36}/);
  expect(bodies[0]).toContain("bill=sin-respuesta-a%3A0&bill=sin-respuesta-b%3A0");

  await expect(title(page, "Abono registrado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("$60.00 en efectivo, en 2 cuentas. Familia Ruiz todavía debe $20.00.");
  // The change it was sent with is still there to hand over.
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$40.00");
  expect(await payments(query)).toEqual(recorded);
  expect(await query("SELECT id, paid, state FROM bills ORDER BY opened_at")).toEqual([
    { id: "sin-respuesta-a", paid: 5000, state: "paid" },
    { id: "sin-respuesta-b", paid: 1000, state: "partial" },
  ]);
});

test("an Abonar confirmed after its step was left still shows its result and its change, until the User goes on", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const ruiz = await addCustomer("Familia Ruiz", { by: ana });
  await billsOf(query, ruiz.id, ana.id, [["tardia", 5000]]);
  await page.goto(`/clientes/${ruiz.id}`);
  await openAbonar(page);
  await typePayment(page, { handed: "100" });

  // On its way, and the User goes back to the Customer anyway: the read that
  // navigation starts is held too, so it lands after the answer does.
  const held = await holdSubmissions(page, { loads: true });
  await page.getByRole("button", { name: "Registrar abono de $50.00" }).click();
  await held.waitFor(1);
  await page.goBack();
  await dialog(page).getByRole("button", { name: "Salir", exact: true }).click();
  await held.waitFor(2);

  await held.release();
  await expect(title(page, "Abono registrado")).toBeVisible();
  // The Customer, read before or after: the result is what the screen is about.
  await held.releaseAll();
  await expect(page).toHaveURL(new RegExp(`/clientes/${ruiz.id}$`));
  await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
  await held.stop();
  await expect(title(page, "Abono registrado")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("$50.00 en efectivo, en 1 cuenta. Familia Ruiz ya no debe nada.");
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$50.00");
  expect(await payments(query)).toMatchObject([{ bill_id: "tardia", amount: 5000 }]);

  await seeCustomer(page, "Familia Ruiz");
  await expect(owed(page)).toContainText("No debe nada.");
  await expect(handovers(page)).toHaveCount(1);
});

test("a session that ended is said as that: nothing recorded on a first attempt, only what is known on a retry", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const ruiz = await addCustomer("Familia Ruiz", { by: beto });
  await billsOf(query, ruiz.id, beto.id, [["sesion", 5000]]);
  await page.goto(`/clientes/${ruiz.id}`);
  await openAbonar(page);

  // Recorded, and the answer lost.
  const lost = async (route: Route) => {
    await route.fetch();
    await route.abort("connectionreset");
  };
  await page.route(HANDOVER, lost);
  await page.getByRole("button", { name: "Registrar abono de $50.00" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await page.unroute(HANDOVER, lost);

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
  await expect(dialog(page)).toContainText("Salir no cancela el registro. Antes de repetir el abono, revisa Mi día.");
  await dialog(page).getByRole("button", { name: "Quedarme aquí" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  expect(await payments(query)).toMatchObject([{ bill_id: "sesion", amount: 5000 }]);
});

test("a first attempt with no session records nothing and keeps what was chosen", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const ruiz = await addCustomer("Familia Ruiz", { by: beto });
  await billsOf(query, ruiz.id, beto.id, [["sin-sesion", 5000]]);
  await page.goto(`/clientes/${ruiz.id}`);
  await openAbonar(page);
  await typePayment(page, { method: "Transferencia" });

  await query("DELETE FROM sessions");
  await page.getByRole("button", { name: "Registrar abono de $50.00" }).click();

  // Entrar answered before any action ran, and what was chosen is still chosen.
  await expect(page.getByRole("alert")).toHaveText(
    "Tu sesión terminó y no se registró nada. Entra de nuevo y vuelve a intentar.",
  );
  await expect(title(page, "Abonar")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Transferencia" })).toBeChecked();
  expect(await payments(query)).toHaveLength(0);
});

test("a stale Abonar changes nothing, says the Bills changed, and is typed again against what is owed now", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const paz = await addCustomer("Familia Paz", { by: beto });
  await billsOf(query, paz.id, beto.id, [
    ["paz-a", 5000],
    ["paz-b", 3000],
  ]);
  await page.goto(`/clientes/${paz.id}`);
  await openAbonar(page);
  await typePayment(page, { method: "Transferencia" });

  // Another phone pays the older Bill in full before this one is sent.
  await paidElsewhere(query, "paz-a", 5000);
  await page.getByRole("button", { name: "Registrar abono de $80.00" }).click();

  // Refused whole, on the step it was sent from, with what was chosen still chosen...
  await expect(page.getByRole("alert")).toHaveText(
    "Las cuentas del cliente cambiaron mientras registrabas el abono. Revisa el monto y vuelve a intentar.",
  );
  await expect(title(page, "Abonar")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Transferencia" })).toBeChecked();
  expect(await payments(query)).toHaveLength(0);
  expect(await query("SELECT paid, state FROM bills WHERE id = 'paz-b'")).toEqual([{ paid: 0, state: "open" }]);
  // ...and the Bills read again: the handover is now for what they owe today.
  await expect(page.getByRole("region", { name: "Cliente" })).toContainText("Debe $30.00");
  const record = page.getByRole("button", { name: "Registrar abono de $30.00" });
  await expect(record).toBeVisible();

  await record.click();
  await expect(title(page, "Abono registrado")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("$30.00 por transferencia, en 1 cuenta. Familia Paz ya no debe nada.");
  expect(await payments(query)).toMatchObject([{ bill_id: "paz-b", amount: 3000, method: "transfer" }]);
});

test("an Abonar for a Customer another phone collected in full is told on their page, with nothing left to collect", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const paz = await addCustomer("Familia Paz", { by: beto });
  await billsOf(query, paz.id, beto.id, [["ya-cobrada", 5000]]);
  await page.goto("/clientes");
  await page.getByRole("list", { name: "Clientes" }).getByRole("link", { name: /Familia Paz/ }).click();
  await openAbonar(page);

  await paidElsewhere(query, "ya-cobrada", 5000);
  await page.getByRole("button", { name: "Registrar abono de $50.00" }).click();

  await expect(title(page, "Familia Paz")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/clientes/${paz.id}$`));
  await expect(page.getByRole("alert")).toContainText("Las cuentas del cliente cambiaron");
  await expect(owed(page)).toContainText("No debe nada.");
  await expect(page.getByRole("link", { name: "Abonar", exact: true })).toHaveCount(0);
  expect(await payments(query)).toHaveLength(0);

  // The step left no second entry of the Customer behind: the way back is the list.
  await page.getByRole("main").getByRole("link", { name: "Clientes" }).click();
  await expect(page).toHaveURL(/\/clientes$/);
});

test("a double tap on Registrar abono sends one handover, and the next one is recorded too", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const ruiz = await addCustomer("Familia Ruiz", { by: ana });
  await billsOf(query, ruiz.id, ana.id, [["doble", 5000]]);
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") sent.push(new URL(request.url()).pathname);
  });

  await page.goto(`/clientes/${ruiz.id}`);
  await openAbonar(page);
  await typePayment(page, { amount: "20.00" });
  // Twice in the same instant, before the screen can take the button away.
  await page.getByRole("button", { name: "Registrar abono de $20.00" }).evaluate((button: HTMLElement) => {
    button.click();
    button.click();
  });

  await expect(title(page, "Abono registrado")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(sent).toEqual([`/clientes/${ruiz.id}/abonar`]);
  expect(await query("SELECT amount FROM payments")).toEqual([{ amount: 2000 }]);

  // The same amount again is another handover, with the Bill's new revision and its own key.
  await seeCustomer(page, "Familia Ruiz");
  await abonar(page, { amount: "20.00" });
  await expect(page.getByRole("status")).toHaveText("$20.00 en efectivo, en 1 cuenta. Familia Ruiz todavía debe $10.00.");
  expect(await query("SELECT amount FROM payments")).toEqual([{ amount: 2000 }, { amount: 2000 }]);
});

test("a retired Customer cannot be chosen for a new Bill, and what they owe is still collected", async ({
  page,
  signInAs,
  addItem,
  addCustomer,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  await addItem({ name: "Agua mineral", price: 1850, stock: { units: 5, by: ana } });
  const leo = await addCustomer("Leonardo Paz", { by: ana });
  await billsOf(query, leo.id, ana.id, [["de-leo", 5000]]);

  // An Admin retires them, told what that does.
  await page.goto(`/clientes/${leo.id}`);
  const manage = page.getByRole("region", { name: "Administrar cliente" });
  await expect(manage).toContainText("Al retirarlo deja de ofrecerse al vender y su nombre queda libre para otro cliente.");
  await expect(manage).toContainText("Lo que debe se sigue cobrando aquí, y se puede restaurar después.");
  await manage.getByRole("button", { name: "Retirar cliente" }).click();
  await expect(page.getByRole("status")).toHaveText("Cliente retirado.");
  expect(await query("SELECT retired_at IS NOT NULL AS retired FROM customers")).toEqual([{ retired: 1 }]);

  // A Worker finds them marked, is offered nothing an Admin does, and still collects.
  const beto = await signInAs("worker", "Beto");
  await page.goto("/clientes?q=leo");
  const row = page.getByRole("list", { name: "Clientes" }).getByRole("link", { name: /Leonardo Paz/ });
  await expect(row).toContainText("Retirado");
  await row.click();
  await expect(page.getByText("Ya no se puede elegir para cuentas nuevas.")).toBeVisible();
  await expect(page.getByText("Sus cuentas abiertas se cobran igual.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Administrar cliente" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Restaurar|Retirar|Guardar/ })).toHaveCount(0);
  // What the page does not offer the server refuses too.
  const forms: Array<Record<string, string>> = [{ intent: "restore" }, { intent: "retire" }, { intent: "edit", name: "Otro nombre" }];
  for (const form of forms) {
    const refused = await page.request.post(`/clientes/${leo.id}`, {
      form,
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(refused.status(), form.intent).toBe(403);
  }
  expect(await query("SELECT name, retired_at IS NOT NULL AS retired FROM customers")).toEqual([
    { name: "Leonardo Paz", retired: 1 },
  ]);

  await abonar(page, { amount: "20.00" });
  await expect(page.getByRole("status")).toHaveText("$20.00 en efectivo, en 1 cuenta. Leonardo Paz todavía debe $30.00.");
  expect(await payments(query)).toMatchObject([{ bill_id: "de-leo", amount: 2000, received_by: beto.id }]);

  // Selling does not offer them, and the selection is still there.
  await goTo(page, "Vender");
  await select(page, ["Agua mineral"]);
  await review(page);
  await page.getByLabel("Cliente", { exact: true }).pressSequentially("leo");
  const matches = page.getByRole("list", { name: "Coincidencias" });
  await expect(matches.getByRole("button", { name: "Agregar «leo»" })).toBeVisible();
  await expect(matches.getByRole("button", { name: /Leonardo Paz/ })).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText("Agua mineral");
});

test("on a 320px phone long names and large amounts stay whole, and an Abonar is taken with the keyboard alone", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const ana = await signInAs("admin", "María Guadalupe Hernández de la Torre");
  const family = await addCustomer("Familia Hernández de la Torre y Villaseñor Echeverría", {
    by: ana,
    note: "Paga a fin de mes, sin falta, con transferencia",
  });
  await billsOf(query, family.id, ana.id, [
    ["larga-a", 12345678],
    ["larga-b", 5000, 1000],
  ]);

  await page.goto("/clientes");
  const row = page.getByRole("list", { name: "Clientes" }).getByRole("listitem").first();
  await expect(row).toContainText("Familia Hernández de la Torre y Villaseñor Echeverría");
  expect(await nothingSideways(page)).toBe(true);
  expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  // With the keyboard: the row, then Abonar, the method, and the action.
  await row.getByRole("link").focus();
  await page.keyboard.press("Enter");
  await expect(title(page, "Familia Hernández de la Torre y Villaseñor Echeverría")).toBeVisible();
  await expect(owed(page)).toContainText("Debe $123,496.78");
  expect(await nothingSideways(page)).toBe(true);
  for (const control of await page.getByRole("main").getByRole("link").or(page.getByRole("main").getByRole("button")).all()) {
    // A row is a card that is a link; every other control is a 48px target.
    if (await control.locator("[data-slot=card]").count()) continue;
    expect((await control.boundingBox())!.height, await control.innerText()).toBeGreaterThanOrEqual(48);
  }

  await page.getByRole("link", { name: "Abonar", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(title(page, "Abonar")).toBeFocused();
  expect(await nothingSideways(page)).toBe(true);
  await page.getByRole("radio", { name: "Efectivo" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "Transferencia" })).toBeChecked();
  const record = page.getByRole("button", { name: "Registrar abono de $123,496.78" });
  await record.focus();
  // The bar at the bottom leaves the action in sight.
  const bar = (await destinations(page).boundingBox())!;
  const box = (await record.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  await page.keyboard.press("Enter");

  await expect(title(page, "Abono registrado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText(
    "$123,496.78 por transferencia, en 2 cuentas. Familia Hernández de la Torre y Villaseñor Echeverría ya no debe nada.",
  );
  expect(await nothingSideways(page)).toBe(true);
  await page.getByRole("button", { name: "Ver cliente" }).focus();
  await page.keyboard.press("Enter");
  await expect(title(page, "Familia Hernández de la Torre y Villaseñor Echeverría")).toBeFocused();
  await expect(handovers(page).first()).toContainText("María Guadalupe Hernández de la Torre");
  expect(await nothingSideways(page)).toBe(true);
});

test("with text twice as large Clientes, the Customer, the Abonar and its result keep every word and nothing scrolls sideways", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const family = await addCustomer("Familia Hernández de la Torre", { by: beto, note: "Papás de Leonardo" });
  await billsOf(query, family.id, beto.id, [
    ["grande-a", 100000],
    ["grande-b", 23450],
  ]);
  const enlarge = () => page.addStyleTag({ content: "html { font-size: 200% }" });

  await page.goto("/clientes");
  await enlarge();
  expect(await nothingSideways(page)).toBe(true);
  await expect(page.getByLabel("Buscar o agregar")).toBeVisible();
  await page.getByRole("list", { name: "Clientes" }).getByRole("link").first().click();

  await expect(title(page, "Familia Hernández de la Torre")).toBeVisible();
  expect(await nothingSideways(page)).toBe(true);
  await expect(owed(page)).toContainText("Debe $1,234.50");
  await expect(openBills(page).first()).toContainText("Debe $1,000.00");

  await openAbonar(page);
  expect(await nothingSideways(page)).toBe(true);
  await typePayment(page, { amount: "1100", handed: "1500" });
  await expect(page.getByText("Cambio: $400.00")).toBeVisible();
  expect(await nothingSideways(page)).toBe(true);
  const record = page.getByRole("button", { name: "Registrar abono de $1,100.00" });
  await record.focus();
  const bar = (await destinations(page).boundingBox())!;
  const box = (await record.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  await record.click();

  await expect(title(page, "Abono registrado")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("todavía debe $134.50.");
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$400.00");
  expect(await nothingSideways(page)).toBe(true);
});
