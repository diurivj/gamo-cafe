import type { Locator, Page, Route } from "@playwright/test";

import { expect, test } from "./fixtures";
import { holdSubmissions } from "./support/held";
import { destinations } from "./support/navigate";
import { chooseCustomer, itemButton, leaveOpen, review, select, selection, totalBar } from "./support/sell";

// Vender sends one sale at a time and says only what it knows (UI redesign
// §6): being recorded, confirmed, refused, or of unknown outcome. A sale on
// its way is frozen, an unknown one is retried as the very same sale, and
// unfinished work is never left by accident. Requests are held or failed on
// purpose here; no test waits on the network's own timing.

const SALE = "**/vender/registrar";
const dialog = (page: Page) => page.getByRole("alertdialog");
const title = (page: Page, name: string) => page.getByRole("heading", { name, level: 1 });

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

test("a Payment on its way is said at once, keeps what was sent, and offers no second sale until it is confirmed", async ({
  page,
  signInAs,
  addItem,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  await addItem({ name: "Agua mineral", price: 1850, stock: { units: 6, by: beto } });
  await addCustomer("Familia Ruiz", { by: beto });
  await page.goto("/");
  await select(page, [["Agua mineral", 2]]);
  await review(page);
  await chooseCustomer(page, "Familia Ruiz");
  await page.getByLabel("Nota (opcional)").fill("Mesa 2");
  await page.getByLabel("Efectivo que te entregan (opcional)").fill("50");

  const held = await holdSubmissions(page);
  const pay = page.getByRole("button", { name: "Registrar pago de $37.00" });
  // Acknowledged by the next painted frame, with the request not even sent.
  expect(await tapAndSeeNextFrame(pay, "Registrando pago de $37.00…")).toBe(true);
  await held.waitFor(1);

  await expect(title(page, "Registrando pago de $37.00…")).toBeFocused();
  // What was sent stays in sight, and nothing about it can be changed or sent again.
  await expect(selection(page)).toContainText("2 × Agua mineral");
  await expect(page.getByRole("main")).toContainText("Familia Ruiz");
  await expect(page.getByRole("main")).toContainText("Mesa 2");
  await expect(page.getByRole("main")).toContainText("$37.00 · Efectivo");
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
  // Nothing says it is recorded: the server has not received it.
  await expect(page.getByText(/Pago registrado|Cuenta pagada/)).toHaveCount(0);
  expect(await query("SELECT id FROM bills")).toHaveLength(0);

  // Back in the browser does not bring the form back under a sale on its way.
  await page.goBack();
  await expect(title(page, "Registrando pago de $37.00…")).toBeVisible();
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  await held.waitFor(1);

  await held.release();
  await expect(title(page, "Pago registrado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("$37.00 en efectivo. Cuenta pagada.");
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$13.00");
  expect(await query("SELECT total, paid, state, note FROM bills")).toEqual([
    { total: 3700, paid: 3700, state: "paid", note: "Mesa 2" },
  ]);
});

test("leaving a Bill Open and adding to a Bill are said as what they are while on their way", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  await addItem({ name: "Agua mineral", price: 1850, stock: { units: 6, by: beto } });
  await page.goto("/");
  await select(page, ["Agua mineral"]);
  await review(page);

  const held = await holdSubmissions(page);
  expect(await tapAndSeeNextFrame(page.getByRole("button", { name: "Dejar abierta" }), "Dejando la cuenta abierta…")).toBe(true);
  await held.waitFor(1);
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  await expect(page.getByText(/Cuenta abierta|Pago registrado/)).toHaveCount(0);
  await held.release();
  await expect(title(page, "Cuenta abierta")).toBeVisible();
  const [bill] = await query("SELECT id FROM bills");

  await page.getByRole("link", { name: "Ver cuenta" }).click();
  await page.getByRole("link", { name: "Agregar productos" }).click();
  await select(page, ["Agua mineral"]);
  await review(page);
  expect(await tapAndSeeNextFrame(page.getByRole("button", { name: "Agregar a la cuenta" }), "Agregando a la cuenta…")).toBe(true);
  await held.waitFor(1);
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  // The Bill it is for stays named while it is on its way.
  await expect(page.getByRole("main")).toContainText("Cuenta");
  await expect(page.getByRole("main")).toContainText("Sin cliente");
  expect(await query("SELECT total FROM bills")).toEqual([{ total: 1850 }]);
  await held.release();
  await expect(title(page, "Productos agregados")).toBeVisible();
  expect(await query("SELECT id, total FROM bills")).toEqual([{ id: bill!.id, total: 3700 }]);
});

test("a double tap records one sale, and the same Items sell again afterwards", async ({ page, signInAs, addItem, query }) => {
  const beto = await signInAs("worker", "Beto");
  const agua = await addItem({ name: "Agua mineral", price: 1850, stock: { units: 6, by: beto } });
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") sent.push(new URL(request.url()).pathname);
  });

  await page.goto("/");
  await select(page, ["Agua mineral"]);
  await review(page);
  // Twice in the same instant, before the screen can take the button away.
  await page.getByRole("button", { name: "Registrar pago de $18.50" }).evaluate((button: HTMLElement) => {
    button.click();
    button.click();
  });

  await expect(title(page, "Pago registrado")).toBeVisible();
  expect(sent).toEqual(["/vender/registrar"]);
  expect(await query("SELECT id FROM bills")).toHaveLength(1);
  expect(await query("SELECT id FROM lines")).toHaveLength(1);
  expect(await query("SELECT id FROM payments")).toHaveLength(1);
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 5 }]);

  // The next sale has a key of its own.
  await page.getByRole("button", { name: "Nueva venta" }).click();
  await select(page, ["Agua mineral"]);
  await review(page);
  await page.getByRole("button", { name: "Registrar pago de $18.50" }).click();
  await expect(title(page, "Pago registrado")).toBeVisible();
  expect(await query("SELECT id FROM bills")).toHaveLength(2);
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 4 }]);
});

test("a refused sale comes back with what it held, says why, and can be corrected and recorded", async ({
  page,
  signInAs,
  addItem,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const pan = await addItem({ name: "Pan dulce", price: 1200 });
  await addItem({ name: "Galleta", price: 800, category: pan.category });
  await addCustomer("Familia Ruiz", { by: beto });
  await page.goto("/");
  await select(page, ["Pan dulce", ["Galleta", 2]]);
  await review(page);
  await chooseCustomer(page, "Familia Ruiz");
  await page.getByLabel("Nota (opcional)").fill("Paga los viernes");
  await page.getByRole("radio", { name: "Transferencia" }).check();

  // Retired on another phone since Vender was opened.
  await query("UPDATE items SET retired_at = ? WHERE id = ?", [Date.now(), pan.id]);
  await page.getByRole("button", { name: "Registrar pago de $28.00" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "Un producto ya no está disponible y se quitó de la selección. Revísala y vuelve a registrar.",
  );
  expect(await query("SELECT id FROM bills")).toHaveLength(0);
  // Still on the review step, with the rest of the selection and everything typed.
  await expect(title(page, "Cobrar")).toBeVisible();
  await expect(selection(page)).not.toContainText("Pan dulce");
  await expect(selection(page)).toContainText("2 × Galleta");
  await expect(page.getByRole("group", { name: "Cliente" })).toContainText("Familia Ruiz");
  await expect(page.getByLabel("Nota (opcional)")).toHaveValue("Paga los viernes");
  await expect(page.getByRole("radio", { name: "Transferencia" })).toBeChecked();

  // Step 1 stops offering it.
  await page.getByRole("button", { name: "Cambiar productos" }).click();
  await expect(itemButton(page, "Pan dulce")).toHaveCount(0);
  await expect(itemButton(page, "Galleta")).toBeVisible();
  await review(page);

  await page.getByRole("button", { name: "Registrar pago de $16.00" }).click();
  await expect(page.getByRole("status")).toHaveText("$16.00 por transferencia. Cuenta pagada.");
  expect(await query("SELECT total, paid, state FROM bills")).toEqual([{ total: 1600, paid: 1600, state: "paid" }]);
});

test("a sale whose request never arrived is of unknown outcome, never failed, and the retry records it once", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const agua = await addItem({ name: "Agua mineral", price: 1850, stock: { units: 6, by: beto } });
  await page.goto("/");
  await select(page, [["Agua mineral", 2]]);
  await review(page);
  await page.getByLabel("Efectivo que te entregan (opcional)").fill("50");

  // The connection drops before the server gets anything.
  const dropped = (route: Route) => route.abort("connectionfailed");
  await page.route(SALE, dropped);
  await page.getByRole("button", { name: "Registrar pago de $37.00" }).click();

  await expect(title(page, "No sabemos si se registró")).toBeFocused();
  const main = page.getByRole("main");
  await expect(main).toContainText("La venta pudo registrarse o no.");
  await expect(main).not.toContainText(/falló|no se registró|registrado|pagada/i);
  // The screen is still Vender's own, with what was sent, and nothing to edit.
  await expect(selection(page)).toContainText("2 × Agua mineral");
  await expect(main.getByRole("textbox")).toHaveCount(0);
  await expect(main.getByRole("button")).toHaveText(["Volver a intentar"]);
  expect(await query("SELECT id FROM bills")).toHaveLength(0);

  // Still no connection: still unknown.
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeVisible();

  await page.unroute(SALE, dropped);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(title(page, "Pago registrado")).toBeVisible();
  // The change it was sent with is still there to hand over.
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$13.00");
  expect(await query("SELECT total, paid, state FROM bills")).toEqual([{ total: 3700, paid: 3700, state: "paid" }]);
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 4 }]);
});

test("a sale that was recorded but whose answer was lost is retried as the same sale: nothing is recorded twice", async ({
  page,
  signInAs,
  addItem,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const agua = await addItem({ name: "Agua mineral", price: 1850, stock: { units: 6, by: beto } });
  await addCustomer("Familia Ruiz", { by: beto });
  await page.goto("/");
  await select(page, [["Agua mineral", 2]]);
  await review(page);
  await chooseCustomer(page, "Familia Ruiz");

  // The server records the sale; its answer never reaches the phone.
  const bodies: Array<string | null> = [];
  const lost = async (route: Route) => {
    bodies.push(route.request().postData());
    await route.fetch();
    await route.abort("connectionreset");
  };
  await page.route(SALE, lost);
  await page.getByRole("button", { name: "Registrar pago de $37.00" }).click();

  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(/falló|no se registró/i);
  expect(await query("SELECT id FROM bills")).toHaveLength(1);

  await page.unroute(SALE, lost);
  const retried = page.waitForRequest(SALE);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  // The very same form: its key and its content.
  expect((await retried).postData()).toBe(bodies[0]);
  expect(bodies[0]).toMatch(/submissionKey=[0-9a-f-]{36}/);

  await expect(title(page, "Pago registrado")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("$37.00 en efectivo. Cuenta pagada.");
  expect(await query("SELECT total, paid, state FROM bills")).toEqual([{ total: 3700, paid: 3700, state: "paid" }]);
  expect(await query("SELECT quantity FROM lines")).toEqual([{ quantity: 2 }]);
  expect(await query("SELECT amount FROM payments")).toEqual([{ amount: 3700 }]);
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 4 }]);
});

test("a failure of the server is unknown too, and the screen is not replaced by an error page", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  await signInAs("worker", "Beto");
  await addItem({ name: "Agua mineral", price: 1850 });
  await page.goto("/");
  await select(page, ["Agua mineral"]);
  await review(page);

  const broken = (route: Route) => route.fulfill({ status: 500, body: "Internal Server Error" });
  await page.route(SALE, broken);
  await page.getByRole("button", { name: "Dejar abierta" }).click();

  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await expect(title(page, "Algo salió mal")).toHaveCount(0);
  await expect(selection(page)).toContainText("1 × Agua mineral");

  await page.unroute(SALE, broken);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(title(page, "Cuenta abierta")).toBeVisible();
  expect(await query("SELECT total, state FROM bills")).toEqual([{ total: 1850, state: "open" }]);
});

test("a confirmed sale needs no read after it: with every read failing it stays confirmed and the next sale starts", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  await signInAs("admin", "Ana");
  await addItem({ name: "Agua mineral", price: 1850 });
  await page.goto("/");
  await select(page, ["Agua mineral"]);
  await review(page);
  await page.getByLabel("Efectivo que te entregan (opcional)").fill("20");

  // From here on no page data can be read.
  const reads: string[] = [];
  const unreadable = (route: Route) => {
    reads.push(route.request().url());
    return route.abort("connectionfailed");
  };
  await page.route("**/*.data*", unreadable);
  await page.getByRole("button", { name: "Registrar pago de $18.50" }).click();

  await expect(title(page, "Pago registrado")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("$18.50 en efectivo. Cuenta pagada.");
  await expect(page.getByRole("region", { name: "Cambio" })).toContainText("$1.50");
  // The answer carried the Bill as the sale left it: there is no read after
  // a sale that could fail, and so none to offer again.
  expect(reads).toEqual([]);

  // Nor does the next sale need one: it starts, is reviewed and is recorded.
  await page.getByRole("button", { name: "Nueva venta" }).click();
  await select(page, [["Agua mineral", 2]]);
  await review(page);
  await page.getByRole("button", { name: "Registrar pago de $37.00" }).click();
  await expect(title(page, "Pago registrado")).toBeVisible();
  expect(reads).toEqual([]);
  expect(await query("SELECT total, paid FROM bills ORDER BY total")).toEqual([
    { total: 1850, paid: 1850 },
    { total: 3700, paid: 3700 },
  ]);
});

test("a retry that finds the session ended does not say nothing was recorded, and cannot become another sale", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  await signInAs("worker", "Beto");
  await addItem({ name: "Agua mineral", price: 1850 });
  await page.goto("/");
  await select(page, ["Agua mineral"]);
  await review(page);

  // Recorded, the answer lost, and then the session ends.
  const lost = async (route: Route) => {
    await route.fetch();
    await route.abort("connectionreset");
  };
  await page.route(SALE, lost);
  await page.getByRole("button", { name: "Registrar pago de $18.50" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await page.unroute(SALE, lost);
  await query("DELETE FROM sessions");
  await page.getByRole("button", { name: "Volver a intentar" }).click();

  // Still unknown: this attempt recorded nothing, the first one did.
  await expect(page.getByRole("status")).toHaveText(
    "Tu sesión terminó antes de saberlo. Entra de nuevo y revisa Mi día antes de repetir la venta.",
  );
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).not.toContainText(/no se registró nada/i);
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(main.getByRole("textbox")).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Entrar de nuevo" })).toHaveAttribute("href", "/entrar");
  expect(await query("SELECT id FROM bills")).toHaveLength(1);
});

test("a price that changed since Vender was opened is read again, and the sale is recorded at today's price", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  await signInAs("worker", "Beto");
  const agua = await addItem({ name: "Agua mineral", price: 1850 });
  await page.goto("/");
  await select(page, [["Agua mineral", 2]]);
  await review(page);
  await page.getByLabel("Nota (opcional)").fill("Mesa 2");

  // Cheaper since: the total on screen would pay more than the selection is worth.
  await query("UPDATE items SET price = 1500 WHERE id = ?", [agua.id]);
  await page.getByRole("button", { name: "Registrar pago de $37.00" }).click();

  await expect(page.getByRole("alert")).toHaveText("El pago no puede ser mayor que el total de la selección.");
  // The screen read the Items again: the same selection, at today's price.
  await expect(selection(page)).toContainText("$30.00");
  await expect(page.getByLabel("Nota (opcional)")).toHaveValue("Mesa 2");
  expect(await query("SELECT id FROM bills")).toHaveLength(0);

  await page.getByRole("button", { name: "Registrar pago de $30.00" }).click();
  await expect(page.getByRole("status")).toHaveText("$30.00 en efectivo. Cuenta pagada.");
  expect(await query("SELECT total, paid, state FROM bills")).toEqual([{ total: 3000, paid: 3000, state: "paid" }]);
});

test("a Customer search that gets no answer says so in its place and leaves the sale as it was", async ({
  page,
  signInAs,
  addItem,
  addCustomer,
}) => {
  const beto = await signInAs("worker", "Beto");
  await addItem({ name: "Agua mineral", price: 1850 });
  await addCustomer("Familia Ruiz", { by: beto });
  await page.goto("/");
  await select(page, [["Agua mineral", 2]]);
  await review(page);
  await page.getByLabel("Nota (opcional)").fill("Mesa 2");

  const dropped = (route: Route) => route.abort("connectionfailed");
  await page.route("**/clientes/selector*", dropped);
  await page.getByLabel("Cliente", { exact: true }).pressSequentially("Fam");

  await expect(page.getByRole("alert")).toHaveText("No se pudo buscar. Revisa la conexión.");
  await expect(title(page, "Algo salió mal")).toHaveCount(0);
  await expect(selection(page)).toContainText("2 × Agua mineral");
  await expect(page.getByLabel("Nota (opcional)")).toHaveValue("Mesa 2");

  await page.unroute("**/clientes/selector*", dropped);
  await page.getByRole("button", { name: "Buscar de nuevo" }).click();
  await page.getByRole("list", { name: "Coincidencias" }).getByRole("button", { name: "Familia Ruiz" }).click();
  await expect(page.getByRole("group", { name: "Cliente" })).toContainText("Familia Ruiz");
});

test("a session that ended is told as that: nothing was recorded", async ({ page, signInAs, addItem, query }) => {
  await signInAs("worker", "Beto");
  await addItem({ name: "Agua mineral", price: 1850 });
  await page.goto("/");
  await select(page, ["Agua mineral"]);
  await review(page);

  await query("DELETE FROM sessions");
  await page.getByRole("button", { name: "Dejar abierta" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "Tu sesión terminó y no se registró nada. Entra de nuevo y vuelve a intentar.",
  );
  await expect(selection(page)).toContainText("1 × Agua mineral");
  expect(await query("SELECT id FROM bills")).toHaveLength(0);
});

test("an unfinished selection is not emptied or left without an explicit decision", async ({
  page,
  signInAs,
  addItem,
}) => {
  await signInAs("worker", "Beto");
  await addItem({ name: "Agua mineral", price: 1850 });
  await addItem({ name: "Café de olla", price: 2500 });
  await page.goto("/inicio");
  await page.getByRole("link", { name: /Nueva venta/ }).click();
  await expect(title(page, "Vender")).toBeVisible();
  await select(page, [["Agua mineral", 2], "Café de olla"]);

  // Vaciar asks first, and Escape or Conservar change nothing.
  const vaciar = page.getByRole("button", { name: "Vaciar" });
  await vaciar.click();
  await expect(dialog(page)).toContainText("¿Vaciar la selección?");
  await expect(dialog(page)).toContainText("Se quitarán 3 productos");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(vaciar).toBeFocused();
  await expect(totalBar(page)).toContainText("$62.00");
  await vaciar.click();
  await dialog(page).getByRole("button", { name: "Conservar" }).click();
  await expect(totalBar(page)).toContainText("$62.00");

  // Leaving by the navigation asks too; staying keeps the selection.
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(dialog(page)).toContainText("¿Salir sin registrar la venta?");
  await expect(dialog(page)).toContainText("La selección no se ha registrado y se perderá.");
  await dialog(page).getByRole("button", { name: "Seguir con la venta" }).click();
  await expect(title(page, "Vender")).toBeVisible();
  await expect(totalBar(page)).toContainText("$62.00");

  // So does the browser's Back, from either step; between the steps nothing asks.
  await review(page);
  await expect(dialog(page)).toHaveCount(0);
  await page.goBack();
  await expect(dialog(page)).toHaveCount(0);
  await expect(title(page, "Vender")).toBeVisible();
  await page.goBack();
  await expect(dialog(page)).toContainText("¿Salir sin registrar la venta?");
  await dialog(page).getByRole("button", { name: "Seguir con la venta" }).click();
  await expect(totalBar(page)).toContainText("$62.00");

  // Vaciar empties it, and then there is nothing to ask about.
  await vaciar.click();
  await dialog(page).getByRole("button", { name: "Vaciar" }).click();
  await expect(totalBar(page)).toHaveCount(0);
  await select(page, ["Café de olla"]);
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Salir y descartar" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  await destinations(page).getByRole("link", { name: "Vender", exact: true }).click();
  await expect(totalBar(page)).toHaveCount(0);
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(page).toHaveURL(/\/inicio$/);
});

test("leaving a sale on its way or of unknown outcome warns that leaving does not cancel it", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  await signInAs("worker", "Beto");
  await addItem({ name: "Agua mineral", price: 1850 });
  await page.goto("/");
  await select(page, ["Agua mineral"]);
  await review(page);

  const held = await holdSubmissions(page);
  await page.getByRole("button", { name: "Registrar pago de $18.50" }).click();
  await held.waitFor(1);
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(dialog(page)).toContainText("La venta puede estarse registrando");
  await expect(dialog(page)).toContainText("Salir no cancela el registro.");
  await expect(dialog(page)).not.toContainText(/descartar|se perderá/);
  await dialog(page).getByRole("button", { name: "Quedarme aquí" }).click();
  await expect(title(page, "Registrando pago de $18.50…")).toBeVisible();
  await held.release();
  await expect(title(page, "Pago registrado")).toBeVisible();

  // A confirmed sale has nothing to lose: leaving it asks nothing.
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(page).toHaveURL(/\/inicio$/);

  // Unknown: the way to check what was recorded warns the same, and leaving records nothing more.
  await destinations(page).getByRole("link", { name: "Vender", exact: true }).click();
  await select(page, ["Agua mineral"]);
  await review(page);
  await page.route(SALE, (route) => route.abort("connectionfailed"));
  await page.getByRole("button", { name: "Registrar pago de $18.50" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await page.getByRole("link", { name: "Revisar en Mi día" }).click();
  await expect(dialog(page)).toContainText("Salir no cancela el registro. Antes de repetir la venta, revisa Mi día.");
  await dialog(page).getByRole("button", { name: "Salir", exact: true }).click();
  await expect(title(page, "Mi día")).toBeVisible();
  expect(await query("SELECT id FROM bills")).toHaveLength(1);
});

test("the browser is asked to warn before closing an unfinished sale, and not otherwise", async ({ page, signInAs, addItem }) => {
  await signInAs("worker", "Beto");
  await addItem({ name: "Agua mineral", price: 1850 });
  await page.goto("/");
  // Whether the page asks: the browser decides whether to show it.
  const asks = () =>
    page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });

  expect(await asks()).toBe(false);
  await select(page, ["Agua mineral"]);
  expect(await asks()).toBe(true);
  await leaveOpen(page, { items: [] });
  expect(await asks()).toBe(false);
});

test("a phone that was restarted mid-sale resubmits nothing and points to where the sale would be", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  await signInAs("worker", "Beto");
  await addItem({ name: "Agua mineral", price: 1850 });
  await page.goto("/");
  await select(page, ["Agua mineral"]);
  await review(page);
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });

  // The page comes back at the review step's address with nothing in memory.
  page.once("dialog", (asked) => void asked.accept());
  await page.reload();

  await expect(title(page, "Vender")).toBeVisible();
  await expect(page).not.toHaveURL(/paso=/);
  await expect(totalBar(page)).toHaveCount(0);
  await expect(page.getByText(/registrad|pagada|falló/i)).toHaveCount(0);
  expect(posts).toEqual([]);
  expect(await query("SELECT id FROM bills")).toHaveLength(0);
  await page.getByRole("link", { name: "Revísala en Mi día" }).click();
  await expect(title(page, "Mi día")).toBeVisible();
});
