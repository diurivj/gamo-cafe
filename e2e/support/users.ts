import type { Browser, Page } from "@playwright/test";

import { expect } from "../fixtures";

/**
 * Usuarios as an Admin drives it (UI redesign §7): the list, the step that
 * adds a User and the step of one of them; and Entrar on the phone of
 * whoever was given a code.
 *
 *     await page.goto("/usuarios");
 *     await openUser(page, "Beto");
 *     await page.getByRole("button", { name: "Dar código nuevo" }).click();
 *     const phone = await anotherPhone(browser, baseURL);
 *     await enterCode(phone, await shownCode(page, "Beto"));
 */

export const title = (page: Page, name: string | RegExp) => page.getByRole("heading", { name, level: 1 });

/** A User's row of the list. */
export const userOnList = (page: Page, name: string) => page.getByRole("listitem", { name, exact: true });

/** What the last recorded form said. The code beside it is an `<output>`, a status of its own. */
export const said = (page: Page) => page.getByRole("main").locator('[role="status"]');

/** From the list to the step that adds a User. */
export async function openNewUser(page: Page) {
  await page.getByRole("link", { name: "Agregar usuario", exact: true }).click();
  await expect(title(page, "Agregar usuario")).toBeVisible();
}

/** From the list to the step of one User. */
export async function openUser(page: Page, name: string) {
  await userOnList(page, name).getByRole("link").click();
  await expect(title(page, name)).toBeVisible();
}

/** The way back from a step to the list. */
export async function backToUsers(page: Page) {
  await page.getByRole("main").getByRole("link", { name: "Usuarios", exact: true }).click();
  await expect(title(page, "Usuarios")).toBeVisible();
}

/** The one-time code the screen shows for this User, as it is read out: two groups of four. */
export async function shownCode(page: Page, name: string): Promise<string> {
  await expect(page.getByText(`Código de acceso para ${name}`, { exact: true })).toBeVisible();
  const code = await page.locator("output").innerText();
  expect(code).toMatch(/^[A-Z2-9]{4} [A-Z2-9]{4}$/);
  return code;
}

/** Another phone: a browser with no session, on Entrar. */
export async function anotherPhone(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const phone = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const page = await phone.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  return page;
}

/** Types a code on Entrar and sends it. */
export async function enterCode(phone: Page, code: string) {
  await phone.getByLabel("Código de acceso").fill(code);
  await phone.getByRole("button", { name: "Entrar" }).click();
}
