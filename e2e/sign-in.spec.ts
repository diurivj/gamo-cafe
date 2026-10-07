import { formatSignInCode } from "../app/shared/secret.ts";
import { expect, test } from "./fixtures";
import { goTo } from "./support/navigate";

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

test("Salir, on Más, signs this phone out", async ({ page, signInAs }) => {
  await signInAs("worker");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vender" })).toBeVisible();
  // Not beside the task: Vender has no way out of its own.
  await expect(page.getByRole("button", { name: "Salir" })).toHaveCount(0);

  await goTo(page, "Más");
  await page.getByRole("button", { name: "Salir" }).click();

  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  // They left by themselves: nothing says their session ended.
  await expect(page.getByText("Tu sesión terminó")).toHaveCount(0);
  await page.goto("/");
  await expect(page).toHaveURL(/\/entrar$/);
});

test("a code can be pasted, and a refused one stays to be corrected", async ({ page, addUser, issueCode }) => {
  const code = await issueCode(await addUser("worker", "Beto"));
  await page.goto("/entrar");
  const field = page.getByLabel("Código de acceso");
  await expect(field).toBeFocused();
  await expect(field).toHaveAccessibleDescription(/Pídeselo a un administrador/);

  const paste = (text: string) =>
    field.evaluate((input, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      const pasted = input.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
      // Nothing cancelled the paste, so the browser would insert the text.
      if (pasted) (input as HTMLInputElement).setRangeText(text);
      return pasted;
    }, text);

  expect(await paste("mala 2345")).toBe(true);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Ese código no es válido o ya venció. Pide uno nuevo.");
  await expect(field).toHaveValue("mala 2345");
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(/Ese código no es válido/);

  await field.fill("");
  expect(await paste(formatSignInCode(code))).toBe(true);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Vender" })).toBeVisible();
});

test("too many wrong codes are answered with how long to wait", async ({ page, query }) => {
  // The limit is ten refused codes in ten minutes, across the whole app.
  for (let n = 0; n < 10; n++) {
    await query("INSERT INTO sign_in_failures (id, at) VALUES (?, ?)", [crypto.randomUUID(), Date.now()]);
  }
  await page.goto("/entrar");

  await page.getByLabel("Código de acceso").fill("WRNG WRNG");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByRole("alert")).toHaveText("Demasiados intentos. Espera 10 minutos y pide un código nuevo.");
});

test("a phone whose session ended is told so on Entrar", async ({ page, signInAs, query }) => {
  const beto = await signInAs("worker", "Beto");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vender" })).toBeVisible();

  // An Admin signs Beto out of every phone.
  await query("DELETE FROM sessions WHERE user_id = ?", [beto.id]);
  await goTo(page, "Mi día");

  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Tu sesión terminó. Entra con un código nuevo.");
  await expect(page.getByLabel("Código de acceso")).toBeVisible();
});
