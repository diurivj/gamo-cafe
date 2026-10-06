import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

// Spec §3.4: what is not about money is reused in the browser. The Items on
// Vender and the shell's navigation are not fetched again after every sale or
// navigation; tests/reuse.test.ts counts what the requests seen here cost.

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

test("recording a sale, then another, asks only for Vender's own loader", async ({ page, signInAs, addItem, query }) => {
  await signInAs("worker", "Beto");
  await addItem({ name: "Café de olla", price: 2500, stockTracked: false });
  await page.goto("/");
  const asked = loadersAskedFor(page);

  for (const sales of [1, 2]) {
    await page.getByRole("button", { name: /Café de olla/ }).click();
    await page.getByRole("radio", { name: "Efectivo" }).check();
    await page.getByRole("button", { name: "Cobrar" }).click();

    await expect(page.getByRole("status")).toHaveText("Cuenta pagada: $25.00.");
    // The selection is empty again and the Items are still offered.
    await expect(page.getByRole("region", { name: "Selección" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Café de olla/ })).toBeVisible();
    await expect(page.getByText("Beto · Empleado")).toBeVisible();
    await expect.poll(() => query("SELECT COUNT(*) AS n FROM bills")).toEqual([{ n: sales }]);
    // One request after each sale: no shell, no Items.
    expect(asked).toEqual(Array.from({ length: sales }, () => "routes/home"));
  }
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
  const menu = page.getByRole("region", { name: "Bebidas" });
  await expect(menu.getByRole("button", { name: /Agua mineral/ })).toContainText("$18.50");
  await markDocument(page);
  const productos = page.getByRole("navigation", { name: "Administración" }).getByRole("link", { name: "Productos" });

  // Added.
  await productos.click();
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

  await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Vender" }).click();

  await expect(page.getByRole("heading", { name: "Vender", level: 1 })).toBeVisible();
  await expect(menu.getByRole("button", { name: /Té helado/ })).toContainText("$22.00");
  await expect(menu.getByRole("button", { name: /Agua mineral/ })).toContainText("$19.50");
  await expect(menu.getByRole("button", { name: /Jugo verde/ })).toHaveCount(0);
  // All of it without loading the document again.
  expect(await documentIsMarked(page)).toBe(true);
});

test("a sale refused for an Item retired meanwhile stops offering that Item", async ({ page, signInAs, addItem, query }) => {
  await signInAs("worker");
  const pan = await addItem({ name: "Pan dulce" });
  await addItem({ name: "Galleta", category: pan.category });
  await page.goto("/");

  await page.getByRole("button", { name: /Pan dulce/ }).click();
  await query("UPDATE items SET retired_at = ? WHERE id = ?", [Date.now(), pan.id]);
  await page.getByRole("button", { name: "Dejar abierta" }).click();

  await expect(page.getByRole("alert")).toContainText("ya no está disponible");
  await expect(page.getByRole("region", { name: pan.category.name }).getByRole("button", { name: /Pan dulce/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Galleta/ })).toBeVisible();
});

test("navigating between screens does not ask for the shell again", async ({ page, signInAs }) => {
  await signInAs("admin", "Ana");
  await page.goto("/");
  const asked = loadersAskedFor(page);

  await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Cuentas abiertas" }).click();
  await expect(page.getByRole("heading", { name: "Cuentas abiertas", level: 1 })).toBeVisible();
  await page.getByRole("navigation", { name: "Administración" }).getByRole("link", { name: "Inventario" }).click();
  await expect(page.getByRole("heading", { name: "Inventario", level: 1 })).toBeVisible();

  expect(asked).toEqual(["routes/open-bills", "routes/inventario"]);
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
  await expect(betos.getByRole("navigation", { name: "Administración" })).toHaveCount(0);

  await page.goto("/usuarios");
  const row = page.getByRole("listitem", { name: "Beto", exact: true });
  await row.getByRole("button", { name: "Hacer administrador" }).click();
  await expect(page.getByRole("status")).toHaveText("Ahora es Administrador.");

  await betos.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Mi día" }).click();

  await expect(betos.getByRole("heading", { name: "Mi día", level: 1 })).toBeVisible();
  await expect(betos.getByText("Beto · Administrador")).toBeVisible();
  await expect(betos.getByRole("navigation", { name: "Administración" }).getByRole("link", { name: "Usuarios" })).toBeVisible();

  // And back: what an Admin sees is gone on the navigation after the change.
  await row.getByRole("button", { name: "Hacer empleado" }).click();
  await expect(page.getByRole("status")).toHaveText("Ahora es Empleado.");
  await betos.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Clientes" }).click();

  await expect(betos.getByRole("heading", { name: "Clientes", level: 1 })).toBeVisible();
  await expect(betos.getByText("Beto · Empleado")).toBeVisible();
  await expect(betos.getByRole("navigation", { name: "Administración" })).toHaveCount(0);
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
  await expect(page.getByRole("navigation", { name: "Administración" })).toHaveCount(0);
  expect(await documentIsMarked(page)).toBe(true);
});
