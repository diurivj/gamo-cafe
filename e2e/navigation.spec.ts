import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { holdSubmissions } from "./support/held";
import { destinations, goTo } from "./support/navigate";
import { itemButton, leaveOpen, review, select, totalBar } from "./support/sell";

// UI redesign §4 and §7–§8: each role's four destinations, Más, the links
// that open a screen directly, and the pages shown in place of a screen.
// tests/navigation.test.ts reads the same pages as the Worker serves them.

const labels = (page: Page) => destinations(page).getByRole("link");
const current = (page: Page) => destinations(page).locator("[aria-current]");
const heading = (page: Page, name: string) => page.getByRole("heading", { name, level: 1, exact: true });
const nothingSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Whether the bar at the bottom leaves this control in sight. */
async function clearOfTheBar(page: Page, control: Locator): Promise<boolean> {
  const bar = (await destinations(page).boundingBox())!;
  const box = (await control.boundingBox())!;
  return box.y + box.height <= bar.y;
}

test("an Admin signs in on Inicio, walks its cards, the four destinations and every screen Más holds", async ({
  page,
  addUser,
  issueCode,
}) => {
  const code = await issueCode(await addUser("admin", "Ana"));
  await page.goto("/");
  await page.getByLabel("Código de acceso").fill(code);
  await page.getByRole("button", { name: "Entrar" }).click();

  // Inicio: where a User lands.
  await expect(page).toHaveURL(/\/inicio$/);
  await expect(heading(page, "Hola, Ana")).toBeVisible();
  await expect(labels(page)).toHaveText(["Inicio", "Vender", "Día", "Más"]);
  await expect(current(page)).toHaveText("Inicio");
  await expect(current(page)).toHaveAttribute("aria-current", "page");

  // Each card leads to the screen it is about.
  const cards = page.getByRole("main").getByRole("link");
  await expect(cards).toHaveCount(6);
  for (const [card, name] of [
    [/Nueva venta/, "Vender"],
    [/Cobrado hoy/, "Día"],
    [/Cuentas abiertas/, "Cuentas abiertas"],
    [/Inventario/, "Inventario"],
    [/Clientes/, "Clientes"],
    [/Mi día/, "Mi día"],
  ] as const) {
    await goTo(page, "Inicio");
    await page.getByRole("main").getByRole("link", { name: card }).click();
    await expect(heading(page, name)).toBeVisible();
  }

  for (const name of ["Vender", "Día", "Más"]) {
    await goTo(page, name);
    await expect(heading(page, name)).toBeVisible();
    await expect(current(page)).toHaveText(name);
  }

  const more = page.getByRole("main");
  await expect(more.getByRole("heading", { level: 2 })).toHaveText([
    "Cuentas y clientes",
    "Inventario",
    "Revisar",
    "Catálogo y accesos",
    "Tu sesión",
  ]);
  await expect(more.getByRole("link")).toHaveText([
    "Cuentas abiertas",
    "Cuentas",
    "Por cobrar",
    "Clientes",
    "Inventario",
    "Diferencias",
    "Mi día",
    "Historial",
    "Productos",
    "Usuarios",
  ]);
  await expect(more).toContainText("Ana");
  await expect(more).toContainText("Administrador");

  for (const name of await more.getByRole("link").allTextContents()) {
    await goTo(page, name);
    await expect(heading(page, name)).toBeVisible();
    // A screen reached through Más is under Más.
    await expect(current(page)).toHaveText("Más");
    await expect(current(page)).toHaveAttribute("aria-current", "true");
  }
});

test("a Worker walks Inicio, Vender, Cuentas and Más, and is offered nothing of an Admin's", async ({
  page,
  signInAs,
}) => {
  await signInAs("worker", "Beto");
  await page.goto("/inicio");

  await expect(heading(page, "Hola, Beto")).toBeVisible();
  await expect(labels(page)).toHaveText(["Inicio", "Vender", "Cuentas", "Más"]);
  // Their own Day, the Open Bills and Clientes; no Day of everyone, no Stock.
  await expect(page.getByRole("main").getByRole("link")).toHaveText([
    /Nueva venta/,
    /Cobraste hoy/,
    /Cuentas abiertas/,
    /Clientes/,
  ]);

  await goTo(page, "Vender");
  await expect(heading(page, "Vender")).toBeVisible();

  // Cuentas is Cuentas abiertas, never the Admin's list of every Bill.
  await goTo(page, "Cuentas");
  await expect(page).toHaveURL(/\/cuentas-abiertas$/);
  await expect(heading(page, "Cuentas abiertas")).toBeVisible();
  await expect(current(page)).toHaveText("Cuentas");

  await goTo(page, "Más");
  const more = page.getByRole("main");
  await expect(more.getByRole("link")).toHaveText(["Clientes", "Mi día"]);
  await expect(more).toContainText("Beto");
  await expect(more).toContainText("Empleado");
  await expect(more.getByRole("button", { name: "Salir" })).toBeVisible();
  for (const name of ["Día", "Inventario", "Historial", "Productos", "Usuarios", "Por cobrar", "Diferencias"]) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  }

  await goTo(page, "Mi día");
  await expect(heading(page, "Mi día")).toBeVisible();
  await expect(current(page)).toHaveText("Más");
});

test("a link that opens a screen directly still works, and says where the User is", async ({
  page,
  signInAs,
  addItem,
}) => {
  const beto = await signInAs("worker", "Beto");
  await addItem({ name: "Café de olla", price: 2500, stock: { units: 5, by: beto } });

  // A Bill, to have one to open by its address.
  await page.goto("/");
  const billId = await leaveOpen(page, { items: ["Café de olla"] });

  await page.goto(`/cuentas/${billId}`);
  await expect(page.getByRole("main")).toContainText("Café de olla");
  await expect(current(page)).toHaveText("Cuentas");
  await expect(current(page)).toHaveAttribute("aria-current", "true");

  for (const [path, name, under] of [
    ["/mi-dia", "Mi día", "Más"],
    ["/clientes", "Clientes", "Más"],
    ["/inicio", "Hola, Beto", "Inicio"],
    ["/cuentas-abiertas", "Cuentas abiertas", "Cuentas"],
    ["/mas", "Más", "Más"],
  ] as const) {
    await page.goto(path);
    await expect(heading(page, name)).toBeVisible();
    await expect(current(page)).toHaveText(under);
  }
});

test("an Admin's deep links open inside the Admin's navigation", async ({ page, signInAs }) => {
  await signInAs("admin", "Ana");

  for (const [path, name, under] of [
    ["/inventario/conteo", "Conteo", "Más"],
    ["/dia", "Día", "Día"],
    ["/cuentas", "Cuentas", "Más"],
    ["/usuarios", "Usuarios", "Más"],
  ] as const) {
    await page.goto(path);
    await expect(heading(page, name)).toBeVisible();
    await expect(current(page)).toHaveText(under);
  }
});

test("a tapped destination says it is loading, and the new screen takes the keyboard", async ({ page, signInAs }) => {
  await signInAs("admin", "Ana");
  await page.goto("/");
  const held = await holdSubmissions(page, { loads: true });

  await destinations(page).getByRole("link", { name: "Día" }).click();
  await held.waitFor(1);
  await expect(page.getByText("Cargando…")).toHaveCSS("opacity", "1");
  await expect(heading(page, "Vender")).toBeVisible();

  await held.releaseAll();
  await expect(heading(page, "Día")).toBeVisible();
  await expect(page.getByText("Cargando…")).toHaveCount(0);
  await expect(page.getByRole("main")).toBeFocused();
});

test("the first stop of the keyboard skips to the content", async ({ page, signInAs, browserName }) => {
  await signInAs("worker", "Beto");
  await page.goto("/mas");

  // Safari stops at links with Option+Tab unless its setting says otherwise.
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  const skip = page.getByRole("link", { name: "Ir al contenido" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#contenido$/);
});

test("a path the app does not have, a record that is not there and a refused screen each say what to do", async ({
  page,
  signInAs,
}) => {
  await signInAs("worker", "Beto");

  // No such path: the page stands alone, and leads back to Vender.
  expect((await page.goto("/esta-pagina-no-existe"))?.status()).toBe(404);
  await expect(heading(page, "No encontramos esta página")).toBeVisible();
  await page.getByRole("link", { name: "Ir a Vender" }).click();
  await expect(heading(page, "Vender")).toBeVisible();

  // No such Bill: said inside the navigation.
  expect((await page.goto("/cuentas/no-existe"))?.status()).toBe(404);
  await expect(heading(page, "No encontramos esta página")).toBeVisible();
  await expect(labels(page)).toHaveText(["Inicio", "Vender", "Cuentas", "Más"]);

  // An Admin's screen: refused, with the Worker's own navigation around it.
  expect((await page.goto("/inventario"))?.status()).toBe(403);
  await expect(heading(page, "No tienes acceso a esta página")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("pídele acceso a un administrador");
  await expect(labels(page)).toHaveText(["Inicio", "Vender", "Cuentas", "Más"]);
  expect(await nothingSideways(page)).toBe(true);
  await page.getByRole("main").getByRole("link", { name: "Ir a Vender" }).click();
  await expect(heading(page, "Vender")).toBeVisible();
});

test("a screen that fails to load says so without calling anything lost, and can be tried again", async ({
  page,
  signInAs,
}) => {
  await signInAs("admin", "Ana");
  await page.goto("/");
  const fail = (route: { abort: () => Promise<void> }) => route.abort();
  await page.route("**/dia.data*", fail);

  await goTo(page, "Día");

  const main = page.getByRole("main");
  await expect(heading(page, "Algo salió mal")).toBeVisible();
  await expect(main).toContainText("Si estabas registrando algo, puede que sí se haya guardado");
  await expect(main).not.toContainText(/no se (guardó|registró)/i);
  // Still inside the navigation.
  await expect(labels(page)).toHaveText(["Inicio", "Vender", "Día", "Más"]);

  await page.unroute("**/dia.data*", fail);
  await main.getByRole("link", { name: "Volver a intentar" }).click();
  await expect(heading(page, "Día")).toBeVisible();
});

test("on a 320px phone nothing scrolls sideways, every target is large and the bar covers nothing", async ({
  page,
  signInAs,
  addItem,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/entrar");
  expect(await nothingSideways(page)).toBe(true);
  for (const control of [page.getByLabel("Código de acceso"), page.getByRole("button", { name: "Entrar" })]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  }

  await signInAs("admin", "María Guadalupe Hernández de la Torre");
  for (let n = 1; n <= 12; n++) await addItem({ name: `Producto de nombre largo ${n}` });

  for (const path of ["/", "/mas", "/usuarios", "/no-existe"]) {
    await page.goto(path);
    expect(await nothingSideways(page), path).toBe(true);
  }

  await page.goto("/mas");
  // The whole name is there, wrapped and not cut.
  await expect(page.getByText("María Guadalupe Hernández de la Torre · Administrador")).toBeVisible();
  for (const link of await labels(page).all()) {
    const box = (await link.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.width).toBeGreaterThanOrEqual(48);
    // The word is whole inside its target.
    expect(await link.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  for (const row of await page.getByRole("main").getByRole("listitem").all()) {
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  }

  // The last control of the page, by scroll and by keyboard focus.
  const salir = page.getByRole("button", { name: "Salir" });
  expect((await salir.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await clearOfTheBar(page, salir)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await salir.focus();
  await expect(salir).toBeFocused();
  expect(await clearOfTheBar(page, salir)).toBe(true);

  // Vender, under a long list of Items: its total sticks above the bar, and
  // an Item that takes the focus is clear of both.
  await page.goto("/");
  expect(await nothingSideways(page)).toBe(true);
  await select(page, ["Producto de nombre largo 12"]);
  const forward = totalBar(page).getByRole("button", { name: "Cobrar" });
  expect(await clearOfTheBar(page, forward)).toBe(true);
  expect((await forward.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  for (const step of [/^Quitar uno de/, /^Agregar uno de/]) {
    const box = (await page.getByRole("button", { name: step }).boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(48);
  }
  const lastItem = itemButton(page, "Producto de nombre largo 9");
  await page.evaluate(() => window.scrollTo(0, 0));
  await lastItem.focus();
  await expect(lastItem).toBeFocused();
  const total = (await totalBar(page).boundingBox())!;
  const focused = (await lastItem.boundingBox())!;
  expect(focused.y + focused.height).toBeLessThanOrEqual(total.y);
  expect(await nothingSideways(page)).toBe(true);

  // The review step, with its Payment and both actions.
  await review(page);
  expect(await nothingSideways(page)).toBe(true);
  const last = page.getByRole("button", { name: "Dejar abierta" });
  await last.focus();
  expect(await clearOfTheBar(page, last)).toBe(true);
  for (const control of await page.getByRole("main").getByRole("button").all()) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  }
});

test("with text twice as large the navigation keeps its words and nothing scrolls sideways", async ({
  page,
  signInAs,
}) => {
  await signInAs("admin", "Ana");
  await page.goto("/mas");
  await page.addStyleTag({ content: "html { font-size: 200% }" });

  expect(await nothingSideways(page)).toBe(true);
  await expect(labels(page)).toHaveText(["Inicio", "Vender", "Día", "Más"]);
  for (const link of await labels(page).all()) {
    await expect(link).toBeVisible();
    expect(await link.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  const salir = page.getByRole("button", { name: "Salir" });
  await salir.focus();
  expect(await clearOfTheBar(page, salir)).toBe(true);
});

test("with text twice as large Vender's two steps keep every word and action, and nothing scrolls sideways", async ({
  page,
  signInAs,
  addItem,
}) => {
  await signInAs("worker", "Beto");
  const jugo = await addItem({ name: "Jugo de naranja natural grande", price: 123450 });
  await addItem({ name: "Agua mineral", price: 1850, category: jugo.category });
  await page.goto("/");
  await page.addStyleTag({ content: "html { font-size: 200% }" });

  await select(page, [["Jugo de naranja natural grande", 2], "Agua mineral"]);
  expect(await nothingSideways(page)).toBe(true);
  await expect(page.getByLabel("2 de Jugo de naranja natural grande")).toBeVisible();
  await expect(totalBar(page)).toContainText("$2,487.50");
  // Text this large makes the total and the bar too tall to share the screen
  // with the Items: the total stops sticking and rests after the list, a
  // scroll away, and the bar never covers it (`StickyBar`).
  const forward = totalBar(page).getByRole("button", { name: "Cobrar" });
  await forward.focus();
  await expect(forward).toBeInViewport({ ratio: 1 });
  expect(await clearOfTheBar(page, forward)).toBe(true);

  await review(page);
  expect(await nothingSideways(page)).toBe(true);
  await page.getByLabel("Efectivo que te entregan (opcional)").fill("3000");
  await expect(page.getByText("Cambio: $512.50")).toBeVisible();
  const record = page.getByRole("button", { name: "Registrar pago de $2,487.50" });
  await record.focus();
  expect(await clearOfTheBar(page, record)).toBe(true);
  await record.click();
  await expect(heading(page, "Pago registrado")).toBeVisible();
  expect(await nothingSideways(page)).toBe(true);
});

test("on a laptop the same destinations stand at the side", async ({ page, signInAs }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAs("admin", "Ana");
  await page.goto("/mas");

  await expect(labels(page)).toHaveText(["Inicio", "Vender", "Día", "Más"]);
  await expect(page.getByText("Ana · Administrador")).toBeVisible();
  const bar = (await destinations(page).boundingBox())!;
  const main = (await page.getByRole("main").boundingBox())!;
  expect(bar.x + bar.width).toBeLessThanOrEqual(main.x);
  // Text does not stretch across the whole screen.
  expect(main.width).toBeLessThanOrEqual(800);
  expect(await nothingSideways(page)).toBe(true);

  await goTo(page, "Día");
  await expect(heading(page, "Día")).toBeVisible();
  await expect(current(page)).toHaveText("Día");
});
