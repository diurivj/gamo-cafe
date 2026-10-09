import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { holdSubmissions } from "./support/held";
import { cutOff, inSight } from "./support/layout";
import { destinations, goTo } from "./support/navigate";
import {
  anotherPhone,
  backToUsers,
  enterCode,
  openNewUser,
  openUser,
  said,
  shownCode,
  title,
  userOnList,
} from "./support/users";

// Usuarios (spec §3.5, §8.8; UI redesign §7, ticket 11): who works with the
// app, each with a step of their own, and the code an Admin reads out to
// them. What a form recorded is said by the server's answer; what it changed
// is then looked for where it matters: on the phone of the User it was about.

const REFUSED_CODE = "Ese código no es válido o ya venció. Pide uno nuevo.";
const LAST_ADMIN = "Debe quedar al menos un administrador activo. Haz administrador a alguien más primero.";

test("an Admin adds a User, and the code shown signs that User in on their phone, once", async ({
  page,
  browser,
  baseURL,
  signInAs,
  query,
}) => {
  await signInAs("admin", "Ana");
  await page.goto("/");

  await goTo(page, "Usuarios");
  await expect(title(page, "Usuarios")).toBeVisible();
  // Staff, not Customers: the list says so, and where a Customer is added.
  await expect(page.getByRole("main")).toContainText("Los clientes se anotan en Clientes.");
  await expect(userOnList(page, "Ana")).toContainText("Administrador · Eres tú");
  await expect(page.getByText("Solo tú puedes entrar.")).toBeVisible();
  // No form is on the list.
  await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);

  await openNewUser(page);
  await expect(title(page, "Agregar usuario")).toBeFocused();
  // What each role may do is said where the role is chosen.
  await expect(page.getByLabel("Rol")).toHaveAccessibleDescription(/Empleado: Vende, cobra y ve su propio día\./);
  await page.getByLabel("Nombre").fill("Beto");
  await page.getByLabel("Rol").selectOption({ label: "Empleado" });
  await page.getByRole("button", { name: "Agregar y dar código" }).click();

  // The code is shown as two groups of four, to be read out, with what it is good for.
  const code = await shownCode(page, "Beto");
  await expect(page.locator("#recorded")).toBeFocused();
  await expect(page.locator("#recorded")).toContainText("lo escribe en Entrar, en su teléfono");
  await expect(page.locator("#recorded")).toContainText("Sirve una sola vez y dura 10 minutos.");
  // A screen reader spells it.
  expect(await page.locator("output").getAttribute("aria-label")).toBe(code.replace(" ", ",").split("").join(" "));
  // The step is ready for the next User.
  await expect(page.getByLabel("Nombre")).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Only its hash is stored.
  expect(JSON.stringify(await query("SELECT * FROM sign_in_codes"))).not.toContain(code.replace(" ", ""));

  await backToUsers(page);
  await expect(userOnList(page, "Beto")).toContainText("Empleado");
  // The code was shown once: the list has none.
  await expect(page.locator("output")).toHaveCount(0);

  // Beto types it as he heard it, on Entrar, and is in.
  const betosPhone = await anotherPhone(browser, baseURL);
  await expect(betosPhone.getByLabel("Código de acceso")).toHaveAccessibleDescription(/Pídeselo a un administrador/);
  await enterCode(betosPhone, code.toLowerCase());
  await expect(betosPhone.getByRole("heading", { name: "Hola, Beto" })).toBeVisible();
  await expect(betosPhone.getByText("Beto · Empleado")).toBeVisible();

  // The same code opens no second phone.
  const second = await anotherPhone(browser, baseURL);
  await enterCode(second, code);
  await expect(second.getByRole("alert")).toHaveText(REFUSED_CODE);

  // A new code for that phone, from Beto's own step; one that was not used in time is refused too.
  await openUser(page, "Beto");
  await page.getByRole("button", { name: "Dar código nuevo" }).click();
  const late = await shownCode(page, "Beto");
  await query("UPDATE sign_in_codes SET expires_at = ? WHERE used_at IS NULL", [Date.now() - 1]);
  await enterCode(second, late);
  await expect(second.getByRole("alert")).toHaveText(REFUSED_CODE);
  await expect(second.getByLabel("Código de acceso")).toHaveValue(late);

  await page.getByRole("button", { name: "Dar código nuevo" }).click();
  await expect(page.locator("output")).not.toHaveText(late);
  await enterCode(second, await shownCode(page, "Beto"));
  await expect(second.getByRole("heading", { name: "Hola, Beto" })).toBeVisible();
  // The first phone kept its session.
  await betosPhone.reload();
  await expect(betosPhone.getByRole("heading", { name: "Hola, Beto" })).toBeVisible();

  await betosPhone.context().close();
  await second.context().close();
});

test("a name that is missing or taken is said on the field, which keeps what was typed", async ({ page, signInAs }) => {
  await signInAs("admin", "Ana");
  await page.goto("/usuarios?paso=nuevo");
  const name = page.getByLabel("Nombre");

  await name.fill("ana");
  await page.getByLabel("Rol").selectOption({ label: "Administrador" });
  await page.getByRole("button", { name: "Agregar y dar código" }).click();

  await expect(page.getByRole("alert")).toHaveText("Ya hay un usuario con ese nombre. Si está desactivado, reactívalo.");
  await expect(name).toHaveValue("ana");
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription(/Ya hay un usuario con ese nombre/);
  await expect(page.getByLabel("Rol")).toHaveValue("admin");
  await expect(page.locator("output")).toHaveCount(0);
});

test("an Admin signs a User out everywhere, then deactivates and reactivates them", async ({
  page,
  browser,
  baseURL,
  signInAs,
  addUser,
  issueCode,
}) => {
  await signInAs("admin", "Ana");
  const beto = await addUser("worker", "Beto");
  const betosPhone = await anotherPhone(browser, baseURL);
  await enterCode(betosPhone, await issueCode(beto));
  await expect(betosPhone.getByText("Beto · Empleado")).toBeVisible();

  await page.goto("/usuarios");
  await openUser(page, "Beto");
  await expect(title(page, "Beto")).toBeFocused();
  const main = page.getByRole("main");
  // What each action does is said before it is tapped.
  await expect(main).toContainText("Saldrá de todos sus teléfonos en su siguiente toque. Para volver a entrar necesitará un código. Sigue activo.");
  await expect(main).toContainText("Ya no podrá entrar: se cierra su sesión en todos los teléfonos y sus códigos dejan de servir.");

  await page.getByRole("button", { name: "Cerrar sesión en todos los teléfonos" }).click();
  await expect(said(page)).toHaveText("Se cerró su sesión en todos los teléfonos. Para volver a entrar necesita un código.");
  await expect(page.locator("#recorded")).toBeFocused();
  // Still active: only the sessions ended.
  await expect(main.getByText("Activo", { exact: true })).toBeVisible();

  // Beto's next request finds no session, and Entrar says so.
  await goTo(betosPhone, "Cuentas");
  await expect(betosPhone.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await expect(betosPhone.getByRole("status")).toHaveText("Tu sesión terminó. Entra con un código nuevo.");

  // He signs in again with a new code, and is then deactivated.
  await page.getByRole("button", { name: "Dar código nuevo" }).click();
  await enterCode(betosPhone, await shownCode(page, "Beto"));
  await expect(betosPhone.getByText("Beto · Empleado")).toBeVisible();
  // A code he has not used yet, which deactivating ends.
  await page.getByRole("button", { name: "Dar código nuevo" }).click();
  const unused = await shownCode(page, "Beto");

  await page.getByRole("button", { name: "Desactivar usuario" }).click();
  await expect(said(page)).toHaveText("Usuario desactivado. Ya no puede entrar.");
  await expect(main.getByText("Desactivado", { exact: true })).toBeVisible();
  // The code that no longer works is off the screen, and none can be asked for.
  await expect(page.locator("output")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dar código nuevo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cerrar sesión en todos los teléfonos" })).toHaveCount(0);

  await betosPhone.reload();
  await expect(betosPhone.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await enterCode(betosPhone, unused);
  await expect(betosPhone.getByRole("alert")).toHaveText(REFUSED_CODE);

  // The list keeps him, apart and marked in words.
  await backToUsers(page);
  const deactivated = page.getByRole("region", { name: "Usuarios desactivados" });
  await expect(deactivated.getByRole("listitem", { name: "Beto", exact: true })).toContainText("Desactivado");

  // Reactivated, the old code stays dead and a new one lets him in.
  await openUser(page, "Beto");
  await page.getByRole("button", { name: "Reactivar usuario" }).click();
  await expect(said(page)).toHaveText("Usuario reactivado. Dale un código nuevo para que entre.");
  await enterCode(betosPhone, unused);
  await expect(betosPhone.getByRole("alert")).toHaveText(REFUSED_CODE);
  await page.getByRole("button", { name: "Dar código nuevo" }).click();
  await enterCode(betosPhone, await shownCode(page, "Beto"));
  await expect(betosPhone.getByText("Beto · Empleado")).toBeVisible();
  await betosPhone.context().close();
});

test("a change of role says what it gives and takes, and the User's phone follows on its next tap", async ({
  page,
  browser,
  baseURL,
  signInAs,
  addUser,
  issueCode,
}) => {
  await signInAs("admin", "Ana");
  const beto = await addUser("worker", "Beto");
  const betosPhone = await anotherPhone(browser, baseURL);
  await enterCode(betosPhone, await issueCode(beto));
  await expect(betosPhone.getByText("Beto · Empleado")).toBeVisible();

  await page.goto("/usuarios");
  await openUser(page, "Beto");
  const role = page.getByRole("region", { name: "Rol" });
  await expect(role).toContainText("Empleado: Vende, cobra y ve su propio día.");
  await expect(role).toContainText("Como Administrador: Podrá ver el día de todos");
  await expect(role).toContainText("su sesión sigue abierta");

  await role.getByRole("button", { name: "Hacer administrador" }).click();
  await expect(said(page)).toHaveText("Ahora es Administrador.");
  await expect(role).toContainText("Como Empleado: Dejará de ver el día de todos");

  // Beto was not signed out, and his next tap brings an Admin's navigation.
  await goTo(betosPhone, "Mi día");
  await expect(betosPhone.getByRole("heading", { name: "Mi día", level: 1 })).toBeVisible();
  await expect(betosPhone.getByText("Beto · Administrador")).toBeVisible();
  await goTo(betosPhone, "Usuarios");
  await expect(title(betosPhone, "Usuarios")).toBeVisible();

  // Made a Worker again while Usuarios is on his screen: his next tap is refused, inside a Worker's navigation.
  await role.getByRole("button", { name: "Hacer empleado" }).click();
  await expect(said(page)).toHaveText("Ahora es Empleado.");
  await betosPhone.getByRole("link", { name: "Agregar usuario", exact: true }).click();
  await expect(betosPhone.getByText("No tienes acceso a esta página")).toBeVisible();
  await expect(betosPhone.getByText("Beto · Empleado")).toBeVisible();
  await expect(destinations(betosPhone).getByRole("link", { name: "Día", exact: true })).toHaveCount(0);
  await expect(betosPhone.getByRole("textbox")).toHaveCount(0);
  await betosPhone.context().close();
});

test("the only Admin is offered no way to stop being one, and a stale page is refused and put right", async ({
  page,
  signInAs,
  addUser,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const carla = await addUser("admin", "Carla");
  await page.goto(`/usuarios?paso=usuario&id=${ana.id}`);
  const main = page.getByRole("main");
  // With another Admin, both are offered.
  await expect(page.getByRole("button", { name: "Hacer empleado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Desactivar usuario" })).toBeVisible();

  // From another phone Carla stops being an Admin; this page does not know yet.
  await query("UPDATE users SET role = 'worker' WHERE id = ?", [carla.id]);
  await page.getByRole("button", { name: "Desactivar usuario" }).click();

  // Refused, with what to do; the page is back to what the server has, and the refusal is in sight.
  await expect(page.getByRole("alert")).toHaveText(LAST_ADMIN);
  await expect(page.locator("#refused")).toBeFocused();
  await expect(main).toContainText("Eres el único administrador activo");
  await expect(page.getByRole("button", { name: "Desactivar usuario" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Hacer empleado" })).toHaveCount(0);
  await expect(main.getByText("Activo", { exact: true })).toBeVisible();
  // Signing out of every phone would leave nobody to give a code, and says so.
  await expect(main).toContainText("Nadie más puede darte un código: eres el único administrador.");

  // The same for the role, from a page that still offered it.
  await query("UPDATE users SET role = 'admin' WHERE id = ?", [carla.id]);
  await page.reload();
  await query("UPDATE users SET active = 0 WHERE id = ?", [carla.id]);
  await page.getByRole("button", { name: "Hacer empleado" }).click();
  await expect(page.getByRole("region", { name: "Rol" }).getByRole("alert")).toHaveText(LAST_ADMIN);
  // The button that was tapped is gone with what it offered: the refusal has the keyboard.
  await expect(page.locator("#refused")).toBeFocused();
  await expect(page.getByRole("button", { name: "Hacer empleado" })).toHaveCount(0);

  expect(await query("SELECT role, active FROM users WHERE id = ?", [ana.id])).toEqual([{ role: "admin", active: 1 }]);
  await page.reload();
  await expect(title(page, "Ana")).toBeVisible();
});

test("an Admin who signs themselves out everywhere is told what it costs, and lands on Entrar", async ({
  page,
  signInAs,
  addUser,
}) => {
  const ana = await signInAs("admin", "Ana");
  await addUser("admin", "Carla");
  await page.goto(`/usuarios?paso=usuario&id=${ana.id}`);
  const sessions = page.getByRole("region", { name: "Sesiones" });
  await expect(sessions).toContainText("Saldrás de todos tus teléfonos, este también");
  await expect(sessions).toContainText("date uno antes, arriba, anótalo y úsalo en 10 minutos");

  // Her own code is for her to type, not to tell someone.
  await page.getByRole("button", { name: "Dar código nuevo" }).click();
  const code = await shownCode(page, "Ana");
  await expect(page.locator("#recorded")).toContainText("Escríbelo en Entrar, en tu otro teléfono");

  await sessions.getByRole("button", { name: "Cerrar sesión en todos los teléfonos" }).click();
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Tu sesión terminó. Entra con un código nuevo.");
  // The code she gave herself first lets her back in.
  await enterCode(page, code);
  await expect(page.getByRole("heading", { name: "Hola, Ana" })).toBeVisible();
});

test("every form says it is on its way at once, and shows nothing as recorded before the answer", async ({
  page,
  signInAs,
  addUser,
}) => {
  await signInAs("admin", "Ana");
  await addUser("worker", "Beto");
  await page.goto("/usuarios");
  await openUser(page, "Beto");
  const held = await holdSubmissions(page);
  const main = page.getByRole("main");
  const steps: ReadonlyArray<readonly [button: string, pending: string, after: () => Promise<void>]> = [
    ["Dar código nuevo", "Creando código…", async () => void (await shownCode(page, "Beto"))],
    ["Hacer administrador", "Guardando…", () => expect(said(page)).toHaveText("Ahora es Administrador.")],
    ["Cerrar sesión en todos los teléfonos", "Cerrando…", () => expect(said(page)).toContainText("Se cerró su sesión")],
    ["Desactivar usuario", "Desactivando…", () => expect(said(page)).toHaveText("Usuario desactivado. Ya no puede entrar.")],
    ["Reactivar usuario", "Reactivando…", () => expect(said(page)).toContainText("Usuario reactivado.")],
  ];

  for (const [button, pending, after] of steps) {
    const before = await main.innerText();
    await page.getByRole("button", { name: button }).click();
    await held.waitFor(1);
    const busy = page.getByRole("button", { name: pending });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    // Nothing but the button's own words changed: no role, no state, no code ahead of the server.
    expect((await main.innerText()).replace(pending, button), button).toBe(before);
    await held.release();
    await after();
    await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
  }
  // The code that was issued first stayed through the forms after it, until deactivating ended it.
  await expect(page.locator("output")).toHaveCount(0);
});

test("a Worker has no way to Usuarios", async ({ page, signInAs, addUser }) => {
  const ana = await addUser("admin", "Ana");
  await signInAs("worker", "Beto");

  await page.goto("/");
  await goTo(page, "Más");
  await expect(page.getByRole("heading", { name: "Más", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Usuarios" })).toHaveCount(0);

  for (const path of ["/usuarios", "/usuarios?paso=nuevo", `/usuarios?paso=usuario&id=${ana.id}`]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(403);
    await expect(page.getByText("Ana")).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  }
  // A form sent by hand is refused before it is read.
  const sent = await page.request.post("/usuarios", {
    form: { intent: "add", name: "Carla", role: "admin" },
    headers: { Origin: new URL(page.url()).origin },
    maxRedirects: 0,
  });
  expect(sent.status()).toBe(403);
  expect(await sent.text()).not.toMatch(/[A-Z2-9]{4} [A-Z2-9]{4}/);
});

test("on a 320px phone with text twice as large long names and the code stay whole, and a User is added with the keyboard alone", async ({
  page,
  signInAs,
  addUser,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const long = "María Guadalupe Hernández de la Torre y Fernández";
  const word = "Supercalifragilisticoespialidosa";
  const me = await signInAs("admin", long);
  const other = await addUser("worker", word);
  const enlarge = () => page.addStyleTag({ content: "html { font-size: 200% }" });
  const main = page.getByRole("main");
  /** Nothing is cut or sticks out, and every control that is not a row is a 48px target. */
  const fits = async (what: string) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), what).toBe(true);
    // A field scrolls what it holds, as every text field does.
    expect((await cutOff(main)).filter((cut) => !/^(input|select) /.test(cut)), what).toEqual([]);
    const controls = main.getByRole("link").or(main.getByRole("button")).or(main.getByRole("textbox")).or(main.getByRole("combobox"));
    for (const control of await controls.all()) {
      // A row is a card that is a link, and the link inside a sentence is text.
      if (await control.locator("[data-slot=card]").count()) continue;
      if ((await control.getAttribute("href")) === "/clientes") continue;
      expect((await control.boundingBox())!.height, `${what}: ${await control.innerText()}`).toBeGreaterThanOrEqual(48);
    }
  };

  for (const path of ["/usuarios", `/usuarios?paso=usuario&id=${me.id}`, `/usuarios?paso=usuario&id=${other.id}`, "/usuarios?paso=nuevo"]) {
    await page.goto(path);
    await fits(path);
    await enlarge();
    await fits(`${path}, enlarged`);
  }
  // Names are whole on the list, and each row is named after its User.
  await page.goto("/usuarios");
  await expect(userOnList(page, long)).toContainText(long);
  await expect(userOnList(page, word).getByRole("link")).toHaveAccessibleName(new RegExp(word));

  // The step that adds, with the keyboard alone and the text enlarged.
  await page.goto("/usuarios?paso=nuevo");
  await enlarge();
  await page.getByLabel("Nombre").focus();
  await page.keyboard.type(word.toUpperCase());
  await page.keyboard.press("Enter");
  // Refused: the name takes the keyboard back, in sight, with its reason.
  await expect(page.getByRole("alert")).toContainText("Ya hay un usuario con ese nombre.");
  await expect(page.getByLabel("Nombre")).toBeFocused();
  await inSight(page.getByLabel("Nombre"));
  await fits("a refused User");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Jesús Ángel Villaseñor Echeverría");
  await page.keyboard.press("Enter");
  // The code is whole at this size, and has the keyboard.
  await shownCode(page, "Jesús Ángel Villaseñor Echeverría");
  await expect(page.locator("#recorded")).toBeFocused();
  // At this size the card is taller than the screen: the code is a scroll away, clear of the bar.
  await page.locator("output").evaluate((code) => code.scrollIntoView({ block: "center" }));
  await inSight(page.locator("output"));
  await fits("an issued code");
});
