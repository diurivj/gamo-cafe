import type { Locator, Page, Route } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  COUNT_RECORD,
  countField,
  expectLine,
  recordCount,
  recorded,
  reviewCount,
  reviewed,
  typeCount,
} from "./support/count";
import { holdSubmissions } from "./support/held";
import { cutOff } from "./support/layout";
import { destinations } from "./support/navigate";
import { adjust, expectStock } from "./support/stock";

// Conteo and Diferencias (spec §5.8, §6.2, §8.7; UI redesign §6, §7,
// §10.1.9): an Admin types what is on the shelf without seeing what Stock
// expects, reviews expected, found and difference, records the Count once,
// and reads it in Diferencias. Requests are held or failed on purpose; no
// test waits on the network's own timing. The operation's rules are in
// tests/counts.test.ts, the route's in tests/conteo.test.ts and the screen's
// state in tests/count.test.ts.

type Query = (sql: string, params?: Array<string | number | null>) => Promise<Array<Record<string, unknown>>>;

const title = (page: Page, name: string | RegExp) => page.getByRole("heading", { name, level: 1 });
const dialog = (page: Page) => page.getByRole("alertdialog");
const nothingSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const stockOf = async (query: Query, itemId: string) =>
  (await query("SELECT units FROM stock_levels WHERE item_id = ?", [itemId]))[0]?.units ?? 0;
/** Every line of every Count of an Item, oldest first. */
const countedOf = (query: Query, itemId: string) =>
  query("SELECT units_expected AS expected, units_found AS found FROM count_lines WHERE item_id = ? ORDER BY rowid", [
    itemId,
  ]);
const countsRecorded = async (query: Query) => (await query("SELECT COUNT(*) AS n FROM counts"))[0]!.n;

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

test("an Admin counts part of the shelf without expected numbers, reviews, records, and reads the Diferencias", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const category = await addCategory("Conteo de la tarde");
  const cafe = await addItem({ name: "Café de olla", price: 2500, category, stock: { units: 10, by: ana } });
  const pan = await addItem({ name: "Pan dulce", price: 1500, category, stock: { units: 4, by: ana } });
  const refresco = await addItem({ name: "Refresco", price: 1800, category, stock: { units: 7, by: ana } });
  const galletas = await addItem({ name: "Galletas", price: 900, category, stock: { units: 5, by: ana } });
  const jugo = await addItem({ name: "Jugo", price: 2000, category, stock: { units: 3, by: ana } });

  await page.goto("/inventario");
  await page.getByRole("link", { name: "Contar existencias" }).click();
  await expect(title(page, "Conteo")).toBeVisible();

  // The entry step shows the Item names and nothing about the expected
  // numbers: not in its words, its fields, or what a screen reader is told.
  const main = page.getByRole("main");
  await expect(countField(page, "Café de olla")).toHaveValue("");
  await expect(main).not.toContainText(/Esperado|Existencias|Faltante|Sobrante/);
  await expect(main).not.toContainText(/\b10\b/);
  for (const field of await main.getByRole("list", { name: "Unidades contadas" }).getByRole("textbox").all()) {
    expect(await field.getAttribute("aria-describedby")).toBeNull();
    expect(await field.getAttribute("placeholder")).toBeNull();
  }
  await expect(countField(page, "Café de olla")).toHaveAttribute("inputmode", "numeric");

  // Three Items counted, one of them at zero; two left out.
  await typeCount(page, { "Café de olla": "7", "Pan dulce": "6", Jugo: "0" }, "Conteo de prueba");
  await expect(page.getByRole("region", { name: "Conteo" })).toContainText("Contados: 3 de 5");
  await reviewCount(page);
  await expect(page).toHaveURL(/paso=revisar/);
  await expect(title(page, "Revisar conteo")).toBeFocused();

  await expect(main).toContainText("3 productos: 2 con faltante, 1 con sobrante.");
  await expectLine(reviewed(page, "Café de olla"), { expected: 10, found: 7, discrepancy: "Faltante: 3" });
  await expectLine(reviewed(page, "Pan dulce"), { expected: 4, found: 6, discrepancy: "Sobrante: 2" });
  await expectLine(reviewed(page, "Jugo"), { expected: 3, found: 0, discrepancy: "Faltante: 3" });
  await expect(reviewed(page, "Refresco")).toHaveCount(0);
  await expect(reviewed(page, "Galletas")).toHaveCount(0);
  await expect(main).toContainText("Nota: Conteo de prueba");
  // The review says what recording does, and that nothing has changed yet.
  await expect(main).toContainText("Al registrar, las existencias de estos 3 productos quedan en lo contado.");
  await expect(main).toContainText("Todavía no cambia nada.");
  expect(await countsRecorded(query)).toBe(0);
  expect(await stockOf(query, cafe.id)).toBe(10);

  // Back keeps everything typed, the blank fields still blank.
  await page.getByRole("button", { name: "Volver a contar" }).click();
  await expect(title(page, "Conteo")).toBeFocused();
  await expect(page).not.toHaveURL(/paso=/);
  await expect(countField(page, "Café de olla")).toHaveValue("7");
  await expect(countField(page, "Jugo")).toHaveValue("0");
  await expect(countField(page, "Refresco")).toHaveValue("");
  await expect(page.getByLabel("Nota (opcional)")).toHaveValue("Conteo de prueba");
  // The browser's own Back and Forward do the same.
  await page.goForward();
  await expect(title(page, "Revisar conteo")).toBeVisible();
  await page.goBack();
  await expect(title(page, "Conteo")).toBeVisible();
  await expect(countField(page, "Pan dulce")).toHaveValue("6");

  // One more Item, with no Discrepancy; the review is read again.
  await typeCount(page, { Refresco: "7" });
  await reviewCount(page);
  await expectLine(reviewed(page, "Refresco"), { expected: 7, found: 7, discrepancy: "Sin diferencia" });
  await expect(main).toContainText("4 productos: 2 con faltante, 1 con sobrante, 1 sin diferencia.");

  await recordCount(page);
  await expect(title(page, "Conteo registrado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText(
    "4 productos: 2 con faltante, 1 con sobrante, 1 sin diferencia. Al registrarlo, las existencias quedaron en lo contado.",
  );
  await expectLine(recorded(page, "Café de olla"), { expected: 10, found: 7, discrepancy: "Faltante: 3" });
  await expectLine(recorded(page, "Jugo"), { expected: 3, found: 0, discrepancy: "Faltante: 3" });
  await expectLine(recorded(page, "Refresco"), { expected: 7, found: 7, discrepancy: "Sin diferencia" });

  // The facts: one Count, a line per counted Item, and only their Stock moved.
  expect(await query("SELECT note, recorded_by AS by FROM counts")).toEqual([{ note: "Conteo de prueba", by: ana.id }]);
  expect(await countedOf(query, cafe.id)).toEqual([{ expected: 10, found: 7 }]);
  expect(await countedOf(query, refresco.id)).toEqual([{ expected: 7, found: 7 }]);
  expect(await countedOf(query, galletas.id)).toEqual([]);
  expect(await stockOf(query, pan.id)).toBe(6);
  expect(await stockOf(query, jugo.id)).toBe(0);
  expect(await stockOf(query, galletas.id)).toBe(5);

  // Diferencias keeps the Count: when, who, its note and every line.
  await page.getByRole("link", { name: "Ver diferencias" }).click();
  await expect(title(page, "Diferencias")).toBeVisible();
  const count = page.getByRole("list", { name: "Conteos" }).locator("> li");
  await expect(count).toHaveCount(1);
  await expect(count).toContainText("Registrado por Ana");
  await expect(count).toContainText("Nota: Conteo de prueba");
  await expect(count).toContainText("4 productos: 2 con faltante, 1 con sobrante, 1 sin diferencia.");
  await expectLine(count.getByRole("listitem", { name: "Café de olla" }), {
    expected: 10,
    found: 7,
    discrepancy: "Faltante: 3",
  });
  await expectLine(count.getByRole("listitem", { name: "Pan dulce" }), { expected: 4, found: 6, discrepancy: "Sobrante: 2" });
  await expectLine(count.getByRole("listitem", { name: "Refresco" }), {
    expected: 7,
    found: 7,
    discrepancy: "Sin diferencia",
  });
  expect(await nothingSideways(page)).toBe(true);

  // Stock takes the counted value; what was left out is as it was.
  await page.getByRole("link", { name: "Ver Inventario" }).click();
  await expectStock(page, "Café de olla", 7);
  await expectStock(page, "Pan dulce", 6);
  await expectStock(page, "Jugo", 0);
  await expectStock(page, "Galletas", 5);
});

test("records the Stock expected at the moment of recording, and says so when it moved since the review", async ({
  page,
  context,
  signInAs,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin");
  const agua = await addItem({ name: "Agua embotellada", price: 1200, stock: { units: 10, by: ana } });

  await page.goto("/inventario/conteo");
  await typeCount(page, { "Agua embotellada": "8" });
  await reviewCount(page);
  await expectLine(reviewed(page, "Agua embotellada"), { expected: 10, found: 8, discrepancy: "Faltante: 2" });
  await expect(page.getByRole("main")).toContainText(
    "Al registrar, las existencias de este producto quedan en lo contado.",
  );

  // An Entrada lands from another phone before recording.
  const other = await context.newPage();
  await other.goto("/inventario");
  await adjust(other, { item: "Agua embotellada", units: "5" });
  await other.close();

  await page.getByRole("button", { name: "Registrar conteo de 1 producto" }).click();

  await expect(title(page, "Conteo registrado")).toBeVisible();
  await expectLine(recorded(page, "Agua embotellada"), { expected: 15, found: 8, discrepancy: "Faltante: 7" });
  await expect(page.getByRole("main")).toContainText("Las existencias cambiaron entre la revisión y el registro.");
  expect(await countedOf(query, agua.id)).toEqual([{ expected: 15, found: 8 }]);
  expect(await stockOf(query, agua.id)).toBe(8);

  await page.getByRole("link", { name: "Volver a Inventario" }).click();
  await expectStock(page, "Agua embotellada", 8);
});

test("nothing is asked while a field cannot be read; the search hides fields without losing what they hold", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin");
  await addItem({ name: "Agua de la casa", stock: { units: 6, by: ana } });
  await addItem({ name: "Jugo de naranja", stock: { units: 2, by: ana } });
  await addItem({ name: "Pan dulce", stock: { units: 4, by: ana } });
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") sent.push(new URL(request.url()).pathname);
  });
  await page.goto("/inventario/conteo");
  const review = page.getByRole("button", { name: "Revisar conteo" });
  const bar = page.getByRole("region", { name: "Conteo" });

  // Nothing typed: there is nothing to review, and the first field takes the keyboard.
  await expect(bar).toContainText("Contados: 0 de 3");
  await review.click();
  await expect(bar.getByRole("alert")).toHaveText("Escribe lo que contaste de al menos un producto.");
  await expect(countField(page, "Agua de la casa")).toBeFocused();

  // A sign, a decimal and a word are not units; each field says so.
  await typeCount(page, { "Agua de la casa": "5", "Jugo de naranja": "-1", "Pan dulce": "2.5" });
  for (const item of ["Jugo de naranja", "Pan dulce"]) {
    await expect(countField(page, item)).toHaveAttribute("aria-invalid", "true");
    await expect(countField(page, item)).toHaveAccessibleDescription("Escribe un número entero, cero o más.");
  }
  await expect(countField(page, "Agua de la casa")).not.toHaveAttribute("aria-invalid", "true");

  // The search hides the others; what they hold stays, and a tap brings the first unreadable one back.
  await page.getByLabel("Buscar producto").fill("AGUA");
  await expect(page.getByText("1 de 3 productos.")).toBeVisible();
  await expect(countField(page, "Pan dulce")).toHaveCount(0);
  await review.click();
  await expect(bar.getByRole("alert")).toHaveText("2 cantidades no se pueden leer. Corrígelas para revisar.");
  await expect(page.getByLabel("Buscar producto")).toHaveValue("");
  await expect(countField(page, "Jugo de naranja")).toBeFocused();
  await expect(countField(page, "Pan dulce")).toHaveValue("2.5");

  await countField(page, "Jugo de naranja").fill("dos");
  await countField(page, "Pan dulce").fill("");
  await review.click();
  await expect(bar.getByRole("alert")).toHaveText("Una cantidad no se puede leer. Corrígela para revisar.");
  expect(sent).toEqual([]);
  expect(await countsRecorded(query)).toBe(0);

  // A search that finds nothing says so and offers every Item again.
  await page.getByLabel("Buscar producto").fill("horchata");
  await expect(page.getByText("Ningún producto con inventario contiene «horchata».")).toBeVisible();
  await page.getByRole("button", { name: "Ver todos" }).click();

  // Corrected, it is reviewed: Pan dulce, left blank, is not in it.
  await countField(page, "Jugo de naranja").fill("2");
  await reviewCount(page);
  await expect(reviewed(page, "Agua de la casa")).toBeVisible();
  await expect(reviewed(page, "Jugo de naranja")).toBeVisible();
  await expect(reviewed(page, "Pan dulce")).toHaveCount(0);
});

test("a Count on its way is said at once, keeps what was sent, moves no Stock and is not left by accident", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const agua = await addItem({ name: "Agua de la casa", stock: { units: 6, by: ana } });
  await page.goto("/inventario/conteo");
  await typeCount(page, { "Agua de la casa": "9" }, "De la tarde");
  const held = await holdSubmissions(page);
  const main = page.getByRole("main");

  // The review is said to be read from the tap, and shows no number meanwhile.
  expect(await tapAndSeeNextFrame(page.getByRole("button", { name: "Revisar conteo" }), "Leyendo las existencias…")).toBe(
    true,
  );
  await held.waitFor(1);
  await expect(title(page, "Revisar conteo")).toBeFocused();
  await expect(main).not.toContainText("Esperado");
  await expect(main.getByRole("button", { name: /^Registrar/ })).toHaveCount(0);
  await held.release();
  await expectLine(reviewed(page, "Agua de la casa"), { expected: 6, found: 9, discrepancy: "Sobrante: 3" });

  // The tap that records is answered by the next frame, before any answer can have come.
  expect(
    await tapAndSeeNextFrame(
      page.getByRole("button", { name: "Registrar conteo de 1 producto" }),
      "Registrando conteo de 1 producto…",
    ),
  ).toBe(true);
  await held.waitFor(1);

  // Frozen: what was sent is in sight, and there is nothing to type or send again.
  await expect(title(page, "Registrando conteo de 1 producto…")).toBeFocused();
  await expect(main).toContainText("Espera la confirmación.");
  await expect(main.getByRole("list", { name: "Conteo enviado" })).toContainText("Agua de la casa");
  await expect(main.getByRole("list", { name: "Conteo enviado" })).toContainText("Contado: 9");
  await expect(main).toContainText("De la tarde");
  await expect(main.getByRole("textbox")).toHaveCount(0);
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(page.getByText(/Conteo registrado|quedaron/)).toHaveCount(0);
  expect(await stockOf(query, agua.id)).toBe(6);

  // Leaving does not cancel it, and says so.
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(dialog(page)).toContainText("El conteo puede estarse registrando");
  await expect(dialog(page)).toContainText("Salir no cancela el registro.");
  await dialog(page).getByRole("button", { name: "Quedarme aquí" }).click();
  await expect(title(page, "Registrando conteo de 1 producto…")).toBeVisible();
  await held.waitFor(1);

  await held.release();
  await expect(title(page, "Conteo registrado")).toBeFocused();
  await expectLine(recorded(page, "Agua de la casa"), { expected: 6, found: 9, discrepancy: "Sobrante: 3" });
  expect(await stockOf(query, agua.id)).toBe(9);
  await held.stop();

  // A recorded Count is nothing to lose: the ways on ask nothing.
  await page.getByRole("link", { name: "Volver a Inventario" }).click();
  await expect(title(page, "Inventario")).toBeVisible();
  await expectStock(page, "Agua de la casa", 9);
});

test("a Count that got no answer is of unknown outcome, never failed, and is retried as the very same one", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const agua = await addItem({ name: "Agua de la casa", stock: { units: 6, by: ana } });
  await page.goto("/inventario/conteo");
  await typeCount(page, { "Agua de la casa": "4" });
  const main = page.getByRole("main");

  // The review that gets no answer says so, keeps what was typed and is read again.
  const dropped = (route: Route) => route.abort("connectionfailed");
  await page.route(COUNT_RECORD, dropped);
  await page.getByRole("button", { name: "Revisar conteo" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "No pudimos leer las existencias. Nada se registró y lo que escribiste sigue aquí.",
  );
  await expect(title(page, "Algo salió mal")).toHaveCount(0);
  await page.getByRole("button", { name: "Volver a contar" }).click();
  await expect(countField(page, "Agua de la casa")).toHaveValue("4");
  await page.unroute(COUNT_RECORD, dropped);
  await page.goForward();
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expectLine(reviewed(page, "Agua de la casa"), { expected: 6, found: 4, discrepancy: "Faltante: 2" });

  // The connection drops before the server gets the Count.
  await page.route(COUNT_RECORD, dropped);
  await page.getByRole("button", { name: "Registrar conteo de 1 producto" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeFocused();
  await expect(main).toContainText("El conteo pudo registrarse o no. Volver a intentar no lo registra dos veces.");
  await expect(main).not.toContainText(/falló|no se registró|Conteo registrado/i);
  await expect(title(page, "Algo salió mal")).toHaveCount(0);
  await expect(main.getByRole("list", { name: "Conteo enviado" })).toContainText("Contado: 4");
  await expect(main.getByRole("textbox")).toHaveCount(0);
  await expect(main.getByRole("button")).toHaveText(["Volver a intentar"]);
  await expect(main.getByRole("link", { name: "Revisar en Diferencias" })).toBeVisible();
  expect(await countsRecorded(query)).toBe(0);
  await page.unroute(COUNT_RECORD, dropped);

  // The server fails: unknown too, and the screen is not replaced by an error page.
  const broken = (route: Route) => route.fulfill({ status: 500, body: "Internal Server Error" });
  await page.route(COUNT_RECORD, broken);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await expect(title(page, "Algo salió mal")).toHaveCount(0);
  await page.unroute(COUNT_RECORD, broken);

  // The server records it; its answer never reaches the phone.
  const bodies: Array<string | null> = [];
  const lost = async (route: Route) => {
    bodies.push(route.request().postData());
    await route.fetch();
    await route.abort("connectionreset");
  };
  await page.route(COUNT_RECORD, lost);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect.poll(() => countsRecorded(query)).toBe(1);
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await expect(main).not.toContainText(/falló|no se registró/i);
  await page.unroute(COUNT_RECORD, lost);

  // Stock moves meanwhile: a second Count would expect 4 and hide the Discrepancy.
  await query("UPDATE stock_levels SET units = 5 WHERE item_id = ?", [agua.id]);

  // The very same form, its key and its content: answered as the first, recorded once.
  const retried = page.waitForRequest(COUNT_RECORD);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  expect((await retried).postData()).toBe(bodies[0]);
  expect(bodies[0]).toMatch(/submissionKey=[0-9a-f-]{36}/);

  await expect(title(page, "Conteo registrado")).toBeFocused();
  await expectLine(recorded(page, "Agua de la casa"), { expected: 6, found: 4, discrepancy: "Faltante: 2" });
  expect(await countedOf(query, agua.id)).toEqual([{ expected: 6, found: 4 }]);
  expect(await stockOf(query, agua.id)).toBe(5);
});

test("a refused Count goes back to its fields with the reason and what was typed", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin");
  const agua = await addItem({ name: "Agua de la casa", stock: { units: 6, by: ana } });
  const pan = await addItem({ name: "Pan dulce", stock: { units: 4, by: ana } });
  await page.goto("/inventario/conteo");
  await typeCount(page, { "Agua de la casa": "5", "Pan dulce": "3" }, "Antes de cerrar");

  // Another phone switches an Item's stock tracking off before the review.
  await query("UPDATE items SET stock_tracked = 0 WHERE id = ?", [agua.id]);
  await page.getByRole("button", { name: "Revisar conteo" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Un producto del conteo ya no lleva inventario. Revisa la lista y vuelve a intentar.",
  );
  await expect(title(page, "Conteo")).toBeVisible();
  await expect(page).not.toHaveURL(/paso=/);
  // The list was read again: the Item is no longer one to count, and the rest is as typed.
  await expect(countField(page, "Agua de la casa")).toHaveCount(0);
  await expect(countField(page, "Pan dulce")).toHaveValue("3");
  await expect(page.getByLabel("Nota (opcional)")).toHaveValue("Antes de cerrar");

  // The same happens to a Count that was reviewed and then sent.
  await reviewCount(page);
  await expect(reviewed(page, "Agua de la casa")).toHaveCount(0);
  await query("UPDATE items SET stock_tracked = 0 WHERE id = ?", [pan.id]);
  await page.getByRole("button", { name: "Registrar conteo de 1 producto" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Un producto del conteo ya no lleva inventario. Revisa la lista y vuelve a intentar.",
  );
  await expect(title(page, "Conteo")).toBeVisible();
  await expect(page.getByText("Todavía no hay productos con inventario.")).toBeVisible();
  expect(await countsRecorded(query)).toBe(0);
  expect(await stockOf(query, pan.id)).toBe(4);
});

test("a double tap on the action sends one Count", async ({ page, signInAs, addItem, query }) => {
  const ana = await signInAs("admin");
  const agua = await addItem({ name: "Agua de la casa", stock: { units: 6, by: ana } });
  await page.goto("/inventario/conteo");
  await typeCount(page, { "Agua de la casa": "4" });
  await reviewCount(page);
  const sent: Array<string | null> = [];
  page.on("request", (request) => {
    if (request.method() === "POST") sent.push(request.postData());
  });

  // Twice in the same instant, before the screen can take the button away.
  await page.getByRole("button", { name: "Registrar conteo de 1 producto" }).evaluate((button: HTMLElement) => {
    button.click();
    button.click();
  });

  await expect(title(page, "Conteo registrado")).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain("intent=registrar");
  expect(await countedOf(query, agua.id)).toEqual([{ expected: 6, found: 4 }]);
});

test("what was typed is not lost to a stray tap on the navigation", async ({ page, signInAs, addItem }) => {
  const ana = await signInAs("admin");
  await addItem({ name: "Agua de la casa", stock: { units: 6, by: ana } });
  await page.goto("/inventario/conteo");

  // Nothing typed, nothing to ask about.
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(title(page, /Hola|Inicio/)).toBeVisible();
  await page.goBack();

  await typeCount(page, { "Agua de la casa": "4" });
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(dialog(page)).toContainText("¿Salir sin registrar el conteo?");
  await expect(dialog(page)).toContainText("Lo que escribiste no se ha registrado y se perderá.");
  await dialog(page).getByRole("button", { name: "Seguir contando" }).click();
  await expect(countField(page, "Agua de la casa")).toHaveValue("4");

  // The two steps are one Count: moving between them asks nothing.
  await reviewCount(page);
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Volver a contar" }).click();
  await expect(dialog(page)).toHaveCount(0);

  await page.getByRole("link", { name: "Inventario", exact: true }).first().click();
  await dialog(page).getByRole("button", { name: "Salir y descartar" }).click();
  await expect(title(page, "Inventario")).toBeVisible();
  await expectStock(page, "Agua de la casa", 6);
});

test("Conteo and Diferencias with nothing in them say so and lead on", async ({ page, signInAs, addItem }) => {
  await signInAs("admin");
  await addItem({ name: "Se prepara al momento", stockTracked: false });

  await page.goto("/inventario/conteo");
  await expect(page.getByText("Todavía no hay productos con inventario.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Revisar conteo" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Inventario", exact: true }).first()).toBeVisible();

  // A review nobody read has nothing to show: its address is the fields'.
  await page.goto("/inventario/conteo?paso=revisar");
  await expect(title(page, "Conteo")).toBeVisible();
  await expect(page).not.toHaveURL(/paso=/);

  await page.goto("/diferencias");
  await expect(page.getByText("Todavía no hay conteos.")).toBeVisible();
  await page.getByRole("link", { name: "Contar existencias" }).click();
  await expect(title(page, "Conteo")).toBeVisible();
});

test("a Worker who opens Conteo or Diferencias gets nothing, and their phone reads no review", async ({
  page,
  signInAs,
  addUser,
  addItem,
  query,
}) => {
  const ana = await addUser("admin");
  const item = await addItem({ name: "Producto reservado", stock: { units: 9, by: ana } });
  await signInAs("worker");

  for (const path of ["/inventario/conteo", "/inventario/conteo?paso=revisar"]) {
    const conteo = await page.goto(path);
    expect(conteo?.status(), path).toBe(403);
    await expect(page.getByText("Producto reservado")).toHaveCount(0);
    await expect(page.getByText("Esperado")).toHaveCount(0);
  }

  const diferencias = await page.goto("/diferencias");
  expect(diferencias?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "Diferencias" })).toHaveCount(0);

  const statuses = await page.evaluate(async (itemId) => {
    const send = async (intent: string) => {
      const body = new URLSearchParams({ intent, [`units.${itemId}`]: "1" });
      return (await fetch("/inventario/conteo/registrar", { method: "POST", body })).status;
    };
    return [await send("revisar"), await send("registrar")];
  }, item.id);
  expect(statuses).toEqual([403, 403]);
  expect(await stockOf(query, item.id)).toBe(9);
});

test("on a 320px phone with text twice as large long names and large numbers stay whole, and a Count is recorded with the keyboard alone", async ({
  page,
  signInAs,
  addItem,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const ana = await signInAs("admin", "María Guadalupe Hernández de la Torre");
  const long = "Concentrado de horchata tradicional con canela y vainilla, presentación familiar";
  const word = "Supercalifragilisticoespialidosoconchocolate";
  await addItem({ name: long, stock: { units: 98765, by: ana } });
  await addItem({ name: word, stock: { units: 3, by: ana } });
  for (let n = 1; n <= 12; n++) await addItem({ name: `Producto de relleno ${n}`, stock: { units: n, by: ana } });
  const enlarge = () => page.addStyleTag({ content: "html { font-size: 200% }" });
  const main = page.getByRole("main");
  const bar = destinations(page);
  /** The control is whole and above the bar at the bottom. */
  const inSight = async (control: Locator) => {
    const box = (await control.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual((await bar.boundingBox())!.y);
  };

  await page.goto("/inventario/conteo");
  expect(await nothingSideways(page)).toBe(true);
  expect(await cutOff(main)).toEqual([]);
  for (const control of await main.getByRole("link").or(main.getByRole("button")).or(main.getByRole("textbox")).all()) {
    expect((await control.boundingBox())!.height, await control.innerText()).toBeGreaterThanOrEqual(48);
  }
  await enlarge();
  expect(await nothingSideways(page)).toBe(true);
  expect(await cutOff(main)).toEqual([]);

  // With the keyboard: a field far down the list stays clear of what sticks to the bottom.
  await countField(page, long).focus();
  await page.keyboard.type("98000");
  await countField(page, "Producto de relleno 12").focus();
  await inSight(countField(page, "Producto de relleno 12"));
  await countField(page, word).focus();
  await page.keyboard.type("0");
  await inSight(countField(page, word));
  const review = page.getByRole("button", { name: "Revisar conteo" });
  await review.focus();
  await inSight(review);
  await page.keyboard.press("Enter");

  await expect(title(page, "Revisar conteo")).toBeFocused();
  await enlarge();
  await expectLine(reviewed(page, long), { expected: 98765, found: 98000, discrepancy: "Faltante: 765" });
  await expectLine(reviewed(page, word), { expected: 3, found: 0, discrepancy: "Faltante: 3" });
  expect(await nothingSideways(page)).toBe(true);
  expect(await cutOff(main)).toEqual([]);
  const record = page.getByRole("button", { name: "Registrar conteo de 2 productos" });
  await record.focus();
  await inSight(record);
  await page.keyboard.press("Enter");

  await expect(title(page, "Conteo registrado")).toBeFocused();
  await enlarge();
  expect(await nothingSideways(page)).toBe(true);
  expect(await cutOff(main)).toEqual([]);
  await page.getByRole("link", { name: "Ver diferencias" }).focus();
  await page.keyboard.press("Enter");

  await expect(title(page, "Diferencias")).toBeVisible();
  await enlarge();
  await expect(main).toContainText("Registrado por María Guadalupe Hernández de la Torre");
  await expect(main.getByRole("listitem", { name: long })).toContainText("Faltante: 765");
  expect(await nothingSideways(page)).toBe(true);
  expect(await cutOff(main)).toEqual([]);
});
