import type { Browser, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { goTo } from "./support/navigate";

/** Another phone: a browser with no session, which types a code on Entrar. */
async function anotherPhone(browser: Browser, baseURL: string | undefined, code: string): Promise<Page> {
  const phone = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const page = await phone.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await page.getByLabel("Código de acceso").fill(code);
  await page.getByRole("button", { name: "Entrar" }).click();
  return page;
}

const userOnList = (page: Page, name: string) => page.getByRole("listitem", { name, exact: true });

// Spec §8.8.
test("an Admin adds a User, and the code shown signs that User in on their phone", async ({
  page,
  browser,
  baseURL,
  signInAs,
}) => {
  await signInAs("admin", "Ana");
  await page.goto("/");

  await goTo(page, "Usuarios");
  await expect(page.getByRole("heading", { name: "Usuarios", level: 1 })).toBeVisible();
  await page.getByLabel("Nombre").fill("Beto");
  await page.getByLabel("Rol").selectOption({ label: "Empleado" });
  await page.getByRole("button", { name: "Agregar y dar código" }).click();

  // The code is shown as two groups of four, to be read out.
  await expect(page.getByText("Código de acceso para Beto")).toBeVisible();
  const code = await page.locator("output").innerText();
  expect(code).toMatch(/^[A-Z2-9]{4} [A-Z2-9]{4}$/);
  await expect(userOnList(page, "Beto")).toContainText("Empleado");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const betosPhone = await anotherPhone(browser, baseURL, code);
  await expect(betosPhone.getByRole("heading", { name: "Hola, Beto" })).toBeVisible();
  await expect(betosPhone.getByText("Beto · Empleado")).toBeVisible();
  await betosPhone.context().close();
});

test("an Admin signs a User out everywhere, then deactivates them", async ({
  page,
  browser,
  baseURL,
  signInAs,
  addUser,
  issueCode,
}) => {
  await signInAs("admin", "Ana");
  const beto = await addUser("worker", "Beto");
  const betosPhone = await anotherPhone(browser, baseURL, await issueCode(beto));
  await expect(betosPhone.getByText("Beto · Empleado")).toBeVisible();

  await page.goto("/usuarios");
  await userOnList(page, "Beto").getByRole("button", { name: "Cerrar sesión en todos los teléfonos" }).click();
  await expect(page.getByRole("status")).toHaveText("Se cerró su sesión en todos los teléfonos.");

  // Beto's next request finds no session.
  await betosPhone.reload();
  await expect(betosPhone.getByRole("heading", { name: "Entrar" })).toBeVisible();

  // He signs in again with a new code, and is then deactivated.
  await userOnList(page, "Beto").getByRole("button", { name: "Código nuevo" }).click();
  const code = await page.locator("output").innerText();
  await betosPhone.getByLabel("Código de acceso").fill(code);
  await betosPhone.getByRole("button", { name: "Entrar" }).click();
  await expect(betosPhone.getByText("Beto · Empleado")).toBeVisible();

  await userOnList(page, "Beto").getByRole("button", { name: "Desactivar" }).click();
  await expect(userOnList(page, "Beto")).toContainText("Desactivado");
  await expect(userOnList(page, "Beto").getByRole("button", { name: "Reactivar" })).toBeVisible();

  await betosPhone.reload();
  await expect(betosPhone.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await betosPhone.context().close();
});

test("the only Admin cannot deactivate themselves or become a Worker", async ({ page, signInAs }) => {
  await signInAs("admin", "Ana");
  await page.goto("/usuarios");

  await userOnList(page, "Ana").getByRole("button", { name: "Desactivar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Debe quedar al menos un administrador activo.");

  await userOnList(page, "Ana").getByRole("button", { name: "Hacer empleado" }).click();
  await expect(page.getByRole("alert")).toHaveText("Debe quedar al menos un administrador activo.");

  await page.reload();
  await expect(userOnList(page, "Ana")).toContainText("Administrador");
});

test("a Worker has no way to Usuarios", async ({ page, signInAs, addUser }) => {
  await addUser("admin", "Ana");
  await signInAs("worker", "Beto");

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Usuarios" })).toHaveCount(0);

  const response = await page.goto("/usuarios");
  expect(response?.status()).toBe(403);
  await expect(page.getByText("Ana")).toHaveCount(0);
});
