import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { destinations, goTo } from "./support/navigate";
import { itemButton, newSale, pay } from "./support/sell";

// Spec §3.4: what is not about money is reused in the browser. The Items on
// Vender and the shell's navigation are not fetched again after every sale or
// navigation; tests/reuse.test.ts counts what the requests seen here cost. A
// sale refused for an Item retired meanwhile is in e2e/vender-recovery.spec.ts.

/** The loaders each data request of the page asked for, from now on: `null` is all of them. */
function loadersAskedFor(page: Page): Array<string | null> {
  const asked: Array<string | null> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.endsWith(".data")) asked.push(url.searchParams.get("_routes"));
  });
  return asked;
}

/** Marks the document, so a test can tell a navigation inside it from a reload. */
const markDocument = (page: Page) => page.evaluate(() => void ((window as { marked?: boolean }).marked = true));
const documentIsMarked = (page: Page) => page.evaluate(() => (window as { marked?: boolean }).marked === true);

test("recording a sale, then another, reads nothing again: no shell, no Items, no page data", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  await signInAs("worker", "Beto");
  await addItem({ name: "Café de olla", price: 2500, stockTracked: false });
  await page.goto("/");
  const asked = loadersAskedFor(page);

  for (const sales of [1, 2]) {
    await pay(page, { items: ["Café de olla"] });

    await expect(page.getByRole("status")).toHaveText("$25.00 en efectivo. Cuenta pagada.");
    await expect.poll(() => query("SELECT COUNT(*) AS n FROM bills")).toEqual([{ n: sales }]);
    // Starting the next one, the Items are still offered.
    await newSale(page);
    await expect(itemButton(page, "Café de olla")).toBeVisible();
    await expect(page.getByText("Beto · Empleado")).toBeVisible();
  }
  // Neither the two steps, nor a sale's answer, nor Nueva venta asked for anything.
  expect(asked).toEqual([]);
});

test("an Item added, repriced or retired on Productos is right on Vender when it is opened again", async ({
  page,
  signInAs,
  addCategory,
  addItem,
}) => {
  await signInAs("admin", "Ana");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Agua mineral", price: 1850, category: bebidas });
  await addItem({ name: "Jugo verde", price: 3000, category: bebidas });
  await page.goto("/");
  await expect(itemButton(page, "Agua mineral")).toContainText("$18.50");
  await markDocument(page);

  // Added.
  await goTo(page, "Productos");
  await page.getByText("Nuevo producto").click();
  const form = page.locator("details", { hasText: "Nuevo producto" });
  await form.getByLabel("Nombre", { exact: true }).fill("Té helado");
  await form.getByLabel("Precio").fill("22");
  await form.getByRole("button", { name: "Agregar producto" }).click();
  await expect(page.getByRole("link", { name: /Té helado/ })).toBeVisible();

  // Repriced.
  await page.getByRole("link", { name: /Agua mineral/ }).click();
  await expect(page.getByRole("heading", { name: "Agua mineral" })).toBeVisible();
  await page.getByLabel("Precio").fill("19.5");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("link", { name: /Agua mineral/ })).toContainText("$19.50");

  // Retired.
  await page.getByRole("link", { name: /Jugo verde/ }).click();
  await page.getByRole("button", { name: "Retirar producto" }).click();
  await expect(page.getByText("Retirado: no aparece en Vender.")).toBeVisible();

  await goTo(page, "Vender");

  await expect(page.getByRole("heading", { name: "Vender", level: 1 })).toBeVisible();
  await expect(itemButton(page, "Té helado")).toContainText("$22.00");
  await expect(itemButton(page, "Agua mineral")).toContainText("$19.50");
  await expect(itemButton(page, "Jugo verde")).toHaveCount(0);
  // All of it without loading the document again.
  expect(await documentIsMarked(page)).toBe(true);
});

test("navigating between screens does not ask for the shell again", async ({ page, signInAs }) => {
  await signInAs("admin", "Ana");
  await page.goto("/");
  const asked = loadersAskedFor(page);

  await goTo(page, "Cuentas abiertas");
  await expect(page.getByRole("heading", { name: "Cuentas abiertas", level: 1 })).toBeVisible();
  await goTo(page, "Inventario");
  await expect(page.getByRole("heading", { name: "Inventario", level: 1 })).toBeVisible();

  // Both are on an Admin's Más.
  expect(asked).toEqual(["routes/mas", "routes/open-bills", "routes/mas", "routes/inventario"]);
  await expect(page.getByText("Ana · Administrador")).toBeVisible();
});

test("a User whose role an Admin changed sees the right navigation on their next navigation", async ({
  page,
  browser,
  baseURL,
  signInAs,
  addUser,
  issueCode,
}) => {
  await signInAs("admin", "Ana");
  const beto = await addUser("worker", "Beto");

  // Beto's phone, signed in with a code and showing Vender as a Worker.
  const phone = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const betos = await phone.newPage();
  await betos.goto("/");
  await betos.getByLabel("Código de acceso").fill(await issueCode(beto));
  await betos.getByRole("button", { name: "Entrar" }).click();
  await expect(betos.getByText("Beto · Empleado")).toBeVisible();
  await expect(destinations(betos).getByRole("link", { name: "Día", exact: true })).toHaveCount(0);

  await page.goto("/usuarios");
  const row = page.getByRole("listitem", { name: "Beto", exact: true });
  await row.getByRole("button", { name: "Hacer administrador" }).click();
  await expect(page.getByRole("status")).toHaveText("Ahora es Administrador.");

  await goTo(betos, "Mi día");

  await expect(betos.getByRole("heading", { name: "Mi día", level: 1 })).toBeVisible();
  await expect(betos.getByText("Beto · Administrador")).toBeVisible();
  await expect(destinations(betos).getByRole("link", { name: "Día", exact: true })).toBeVisible();

  // And back: what an Admin sees is gone on the navigation after the change.
  await row.getByRole("button", { name: "Hacer empleado" }).click();
  await expect(page.getByRole("status")).toHaveText("Ahora es Empleado.");
  await goTo(betos, "Clientes");

  await expect(betos.getByRole("heading", { name: "Clientes", level: 1 })).toBeVisible();
  await expect(betos.getByText("Beto · Empleado")).toBeVisible();
  await expect(destinations(betos).getByRole("link", { name: "Día", exact: true })).toHaveCount(0);
  await phone.close();
});

test("an Admin who makes themselves a Worker sees a Worker's navigation at once", async ({ page, signInAs, addUser }) => {
  await addUser("admin", "Carla");
  await signInAs("admin", "Ana");
  await page.goto("/usuarios");
  await markDocument(page);

  await page.getByRole("listitem", { name: "Ana", exact: true }).getByRole("button", { name: "Hacer empleado" }).click();

  await expect(page.getByRole("heading", { name: "Vender", level: 1 })).toBeVisible();
  await expect(page.getByText("Ana · Empleado")).toBeVisible();
  await expect(destinations(page).getByRole("link", { name: "Día", exact: true })).toHaveCount(0);
  expect(await documentIsMarked(page)).toBe(true);
});
