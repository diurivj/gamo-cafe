import { formatSignInCode } from "../app/shared/secret.ts";
import { expect, test } from "./fixtures";

test("a User with a code opens the app, types it and lands signed in", async ({ page, context, addUser, issueCode }) => {
  const beto = await addUser("worker", "Beto");
  const code = await issueCode(beto);

  await page.goto("/");

  // Signed out: the app shows Entrar and nothing else.
  await expect(page).toHaveURL(/\/entrar$/);
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();

  // Typed the way it was read out, in whatever case the keyboard gives.
  await page.getByLabel("Código de acceso").fill(formatSignInCode(code).toLowerCase());
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Vender" })).toBeVisible();
  await expect(page.getByText("Beto · Empleado")).toBeVisible();

  // Script cannot read the session, and it only travels over HTTPS.
  const [cookie] = await context.cookies();
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
  expect(await page.evaluate(() => document.cookie)).toBe("");

  // The phone stays signed in.
  await page.reload();
  await expect(page.getByText("Beto · Empleado")).toBeVisible();
});

test("a wrong code is answered in Spanish and signs nobody in", async ({ page }) => {
  await page.goto("/entrar");

  await page.getByLabel("Código de acceso").fill("WRNG WRNG");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByRole("alert")).toHaveText("Ese código no es válido o ya venció. Pide uno nuevo.");
  await expect(page).toHaveURL(/\/entrar$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/entrar$/);
});

test("a code signs in one phone only", async ({ page, browser, baseURL, addUser, issueCode }) => {
  const code = await issueCode(await addUser("worker"));

  await page.goto("/entrar");
  await page.getByLabel("Código de acceso").fill(code);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Vender" })).toBeVisible();

  const secondPhone = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const secondPage = await secondPhone.newPage();
  await secondPage.goto("/entrar");
  await secondPage.getByLabel("Código de acceso").fill(code);
  await secondPage.getByRole("button", { name: "Entrar" }).click();

  await expect(secondPage.getByRole("alert")).toContainText("Ese código no es válido");
  await secondPhone.close();
});

test("Salir signs this phone out", async ({ page, signInAs }) => {
  await signInAs("worker");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vender" })).toBeVisible();

  await page.getByRole("button", { name: "Salir" }).click();

  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/entrar$/);
});

test("a Worker sees the sections every User has, and no Admin section", async ({ page, signInAs }) => {
  await signInAs("worker");

  await page.goto("/");

  const sections = page.getByRole("navigation", { name: "Secciones" });
  for (const name of ["Vender", "Cuentas abiertas", "Clientes", "Mi día"]) {
    await expect(sections.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("navigation", { name: "Administración" })).toHaveCount(0);
  await expect(page.getByText("Inventario")).toHaveCount(0);
});

test("an Admin sees the Admin sections too, and nothing scrolls sideways", async ({ page, signInAs }) => {
  const ana = await signInAs("admin", "Ana María");

  await page.goto("/");

  await expect(page.getByText(`${ana.name} · Administrador`)).toBeVisible();
  const admin = page.getByRole("navigation", { name: "Administración" });
  for (const name of ["Día", "Cuentas", "Por cobrar", "Inventario", "Diferencias", "Historial", "Productos", "Usuarios"]) {
    await expect(admin.getByText(name, { exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
