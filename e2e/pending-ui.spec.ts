import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { holdSubmissions } from "./support/held";
import { goTo } from "./support/navigate";
import { pay } from "./support/sell";

// Every tap is acknowledged at once (spec §3.4, ticket 30). Each test holds
// the server's answer back and looks at the screen meanwhile:
//
// - the submit control that was tapped is pending by the next frame;
// - money and Stock (a Payment, an Abono, a correction, an Adjustment, a
//   Count) show nothing as recorded until the answer arrives;
// - a harmless, reversible change (retiring a Customer, a User's role and
//   active state) shows its result at once and goes back if it is refused.
//
// Vender's own pending state is in vender-recovery.spec.ts.

type Held = Awaited<ReturnType<typeof holdSubmissions>>;

/**
 * Taps a submit control as a finger does and says whether it was pending when
 * the browser was about to paint the next frame.
 */
async function pendingAFrameAfterTapping(button: Locator): Promise<boolean> {
  const page = button.page();
  await button.evaluate((element: HTMLButtonElement) => {
    const seen = window as unknown as { pendingAFrameLater?: boolean };
    delete seen.pendingAFrameLater;
    element.addEventListener(
      "click",
      () =>
        requestAnimationFrame(() => {
          seen.pendingAFrameLater = element.getAttribute("aria-busy") === "true" && element.disabled;
        }),
      { once: true },
    );
  });
  await button.click();
  const seen = await page.waitForFunction(
    () => (window as unknown as { pendingAFrameLater?: boolean }).pendingAFrameLater !== undefined,
  );
  await seen.dispose();
  return page.evaluate(() => (window as unknown as { pendingAFrameLater?: boolean }).pendingAFrameLater === true);
}

/** Taps a submit control whose form is then held, and checks it is pending. */
async function tap(held: Held, button: Locator) {
  expect(await pendingAFrameAfterTapping(button)).toBe(true);
  await held.waitFor(1);
}

/** The answer of a `<Form>` has arrived and the page has loaded it. */
async function settled(page: Page) {
  await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
  await expect(page.getByText("Cargando…")).toHaveCount(0);
}

/** Taps, checks the control is pending, lets the form through and waits for the page. */
async function tapThrough(page: Page, held: Held, button: Locator) {
  await tap(held, button);
  await held.release();
  await settled(page);
}

test("Entrar and Salir are pending from the tap", async ({ page, addUser, issueCode }) => {
  const beto = await addUser("worker", "Beto");
  await page.goto("/entrar");
  const held = await holdSubmissions(page);

  await page.getByLabel("Código de acceso").fill(await issueCode(beto));
  const entrar = page.locator("button[type=submit]");
  await tap(held, entrar);
  await expect(entrar).toHaveText("Entrando…");
  await held.release();
  await expect(page.getByRole("heading", { name: "Hola, Beto", level: 1 })).toBeVisible();

  await goTo(page, "Más");
  await expect(page.getByRole("button", { name: "Salir" })).toBeVisible();
  const salir = page.getByRole("main").locator("button[type=submit]");
  await tap(held, salir);
  await expect(salir).toHaveText("Saliendo…");
  await expect(page.getByRole("heading", { name: "Más", level: 1 })).toBeVisible();
  await held.release();
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
});

test("Cuenta shows no Payment and no correction as recorded before the server answers", async ({
  page,
  signInAs,
  addItem,
}) => {
  const ana = await signInAs("admin", "Ana");
  const agua = await addItem({ name: "Agua mineral", price: 1850, stock: { units: 6, by: ana } });
  await addItem({ name: "Café de olla", price: 2500, category: agua.category });

  await page.goto("/");
  await page.goto(`/cuentas/${await pay(page, { items: ["Agua mineral", "Café de olla"], amount: "10.00" })}`);

  const held = await holdSubmissions(page);
  const [total, paid, owed] = [0, 1, 2].map((index) => page.locator("dl dd").nth(index));
  const payments = page.getByRole("list", { name: "Pagos" }).getByRole("listitem");
  const formOf = (button: Locator) => page.locator("form", { has: button });

  // Cliente y nota.
  await page.getByLabel("Nota (opcional)").fill("Mesa 2");
  await tap(held, page.getByRole("button", { name: "Guardar" }));
  await expect(page.getByText("Sin cliente")).toBeVisible();
  await held.release();
  await expect(page.locator("p", { hasText: /^Mesa 2$/ })).toBeVisible();
  await settled(page);

  // A Payment.
  const cobrar = page.getByRole("region", { name: "Cobrar" });
  await cobrar.getByLabel("Monto").fill("5.00");
  await tap(held, cobrar.getByRole("button", { name: "Cobrar" }));
  await expect(paid).toHaveText("$10.00");
  await expect(owed).toHaveText("$33.50");
  await expect(payments).toHaveCount(1);
  await expect(page.getByRole("status")).not.toHaveText(/Abono/);
  await held.release();
  await expect(page.getByRole("status")).toHaveText("Abono de $5.00 registrado. Debe $28.50.");
  await expect(payments).toHaveCount(2);
  await settled(page);

  // Removing a Payment.
  const removePayment = page.getByRole("button", { name: "Quitar pago de $5.00" });
  await formOf(removePayment).getByLabel("Motivo").fill("Se cobró de más");
  await tap(held, removePayment);
  await expect(page.getByText(/Quitado por/)).toHaveCount(0);
  await expect(paid).toHaveText("$15.00");
  await held.release();
  await expect(page.getByText(/Quitado por Ana .* Se cobró de más/)).toBeVisible();
  await expect(paid).toHaveText("$10.00");
  await settled(page);

  // Removing a Line.
  const removeLine = page.getByRole("button", { name: "Quitar 1 × Agua mineral" });
  await formOf(removeLine).getByLabel("Motivo").fill("No se lo llevó");
  await tap(held, removeLine);
  await expect(total).toHaveText("$43.50");
  await expect(page.getByText(/Quitado por Ana .* No se lo llevó/)).toHaveCount(0);
  await held.release();
  await expect(total).toHaveText("$25.00");
  await settled(page);

  // Voiding the Bill.
  const cancelar = page.getByRole("button", { name: "Cancelar cuenta" });
  await formOf(cancelar).getByLabel("Motivo").fill("Se abrió por error");
  await tap(held, cancelar);
  await expect(page.getByText(/Cancelada/)).toHaveCount(0);
  await held.release();
  await expect(page.getByText(/Cancelada por Ana/)).toBeVisible();
});

test("a Customer's page shows no Abono before the answer; retiring and restoring show at once", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const ruiz = await addCustomer("Familia Ruiz", { by: ana });
  await query(
    `INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
     VALUES ('ruiz-a', '2026-09-29', ?, 1000, ?, 5000, 0, 'open', 0)`,
    [ana.id, ruiz.id],
  );
  await page.goto(`/clientes/${ruiz.id}`);
  const held = await holdSubmissions(page);

  // Abonar: money, so nothing before the answer.
  const abonar = page.getByRole("region", { name: "Abonar" });
  await abonar.getByLabel("Monto").fill("20.00");
  await tap(held, abonar.getByRole("button", { name: "Abonar" }));
  await expect(page.getByText("Debe $50.00 en 1 cuenta.")).toBeVisible();
  await expect(page.getByText("Todavía no hay abonos.")).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await held.release();
  await expect(page.getByRole("status")).toHaveText("Abono de $20.00 registrado.");
  await expect(page.getByText("Debe $30.00 en 1 cuenta.")).toBeVisible();
  await settled(page);

  // The name and the note.
  const manage = page.getByRole("region", { name: "Administrar cliente" });
  await manage.getByLabel("Nota (opcional)").fill("Paga los viernes");
  await tapThrough(page, held, manage.getByRole("button", { name: "Guardar" }));
  await expect(page.locator("p", { hasText: /^Paga los viernes$/ })).toBeVisible();

  // Retiring is harmless and reversible: it shows at once.
  const retiredBadge = page.getByText("Retirado", { exact: true });
  await tap(held, manage.getByRole("button", { name: "Retirar cliente" }));
  await expect(retiredBadge).toBeVisible();
  await expect(page.getByText("Ya no se puede elegir para cuentas nuevas.")).toBeVisible();
  expect(await query("SELECT retired_at FROM customers")).toEqual([{ retired_at: null }]);
  await held.release();
  await expect(manage.getByRole("button", { name: "Restaurar cliente" })).toBeEnabled();
  await expect(retiredBadge).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Cliente retirado.");

  await tap(held, manage.getByRole("button", { name: "Restaurar cliente" }));
  await expect(retiredBadge).toHaveCount(0);
  await held.release();
  await expect(manage.getByRole("button", { name: "Retirar cliente" })).toBeEnabled();
  await expect(retiredBadge).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Cliente restaurado.");
  expect(await query("SELECT retired_at FROM customers")).toEqual([{ retired_at: null }]);

  // Going back from the page leaves it: none of these added a history entry.
  await page.goto("/clientes");
  await page.getByLabel("Buscar o agregar").fill("Leo");
  const agregar = page.locator("main form[method=post] button[type=submit]");
  await expect(agregar).toHaveText("Agregar «Leo»");
  await tap(held, agregar);
  await expect(agregar).toHaveText("Agregando…");
  await held.release();
  await expect(page.getByRole("heading", { name: "Leo", level: 1 })).toBeVisible();
});

test("a refused restore puts the Customer back as retired, with the message", async ({
  page,
  signInAs,
  addCustomer,
}) => {
  const ana = await signInAs("admin", "Ana");
  const retired = await addCustomer("Leo", { by: ana, retired: true });
  await addCustomer("Leo", { by: ana });
  await page.goto(`/clientes/${retired.id}`);
  const held = await holdSubmissions(page);
  const retiredBadge = page.getByText("Retirado", { exact: true });
  await expect(retiredBadge).toBeVisible();

  await tap(held, page.getByRole("button", { name: "Restaurar cliente" }));
  await expect(retiredBadge).toHaveCount(0);
  await held.release();

  await expect(page.getByRole("alert")).toHaveText(
    "Otro cliente activo ya usa este nombre. Cambia uno de los dos nombres antes de restaurar.",
  );
  await expect(retiredBadge).toBeVisible();
  await expect(page.getByRole("button", { name: "Restaurar cliente" })).toBeEnabled();
});

const userOnList = (page: Page, name: string) => page.getByRole("listitem", { name, exact: true });

test("Usuarios shows a role and the active state at once, and what it recorded only after the answer", async ({
  page,
  signInAs,
  addUser,
}) => {
  await signInAs("admin", "Ana");
  await addUser("worker", "Beto");
  await page.goto("/usuarios");
  const held = await holdSubmissions(page);
  const beto = userOnList(page, "Beto");

  await page.getByLabel("Nombre").fill("Carla");
  await tap(held, page.getByRole("button", { name: "Agregar y dar código" }));
  await expect(userOnList(page, "Carla")).toHaveCount(0);
  await held.release();
  await expect(page.getByText("Código de acceso para Carla")).toBeVisible();
  await settled(page);

  await tap(held, beto.getByRole("button", { name: "Código nuevo" }));
  await expect(page.getByText("Código de acceso para Beto")).toHaveCount(0);
  await held.release();
  await expect(page.getByText("Código de acceso para Beto")).toBeVisible();
  await settled(page);

  await tap(held, beto.getByRole("button", { name: "Cerrar sesión en todos los teléfonos" }));
  await expect(page.getByText("Se cerró su sesión en todos los teléfonos.")).toHaveCount(0);
  await held.release();
  await expect(page.getByRole("status")).toHaveText("Se cerró su sesión en todos los teléfonos.");
  await settled(page);

  // The role: shown at once, said to be recorded only after the answer.
  await tap(held, beto.getByRole("button", { name: "Hacer administrador" }));
  await expect(beto).toContainText("Administrador");
  await expect(page.getByRole("status")).not.toHaveText("Ahora es Administrador.");
  await held.release();
  await expect(page.getByRole("status")).toHaveText("Ahora es Administrador.");
  await expect(beto.getByRole("button", { name: "Hacer empleado" })).toBeEnabled();

  // The active state, both ways.
  await tap(held, beto.getByRole("button", { name: "Desactivar" }));
  await expect(beto).toContainText("Desactivado");
  await expect(page.getByRole("status")).not.toHaveText("Usuario desactivado.");
  await held.release();
  await expect(page.getByRole("status")).toHaveText("Usuario desactivado.");
  await expect(beto.getByRole("button", { name: "Reactivar" })).toBeEnabled();

  await tap(held, beto.getByRole("button", { name: "Reactivar" }));
  await expect(beto).not.toContainText("Desactivado");
  await held.release();
  await expect(page.getByRole("status")).toHaveText("Usuario reactivado. Dale un código nuevo para que entre.");
  await expect(beto.getByRole("button", { name: "Desactivar" })).toBeEnabled();
});

test("a refused change of role goes back to what the User was", async ({ page, signInAs }) => {
  await signInAs("admin", "Ana");
  await page.goto("/usuarios");
  const held = await holdSubmissions(page);
  const ana = userOnList(page, "Ana");

  await tap(held, ana.getByRole("button", { name: "Hacer empleado" }));
  await expect(ana).toContainText("Empleado");
  await expect(ana).not.toContainText("Administrador");
  await held.release();

  await expect(page.getByRole("alert")).toHaveText("Debe quedar al menos un administrador activo.");
  await expect(ana).toContainText("Administrador");
  await expect(ana.getByRole("button", { name: "Hacer empleado" })).toBeEnabled();

  await tap(held, ana.getByRole("button", { name: "Desactivar" }));
  await expect(ana).toContainText("Desactivado");
  await held.release();
  await expect(page.getByRole("alert")).toHaveText("Debe quedar al menos un administrador activo.");
  await expect(ana).not.toContainText("Desactivado");
});

test("Inventario and Conteo show no Stock change before the server answers", async ({ page, signInAs, addItem }) => {
  const ana = await signInAs("admin", "Ana");
  await addItem({ name: "Agua de la casa", price: 1200, stock: { units: 6, by: ana } });
  await page.goto("/inventario");
  const held = await holdSubmissions(page);
  const row = page.getByRole("listitem", { name: "Agua de la casa", exact: true });
  const adjustments = page.getByRole("region", { name: "Ajustes recientes" }).getByRole("listitem");

  // An Adjustment. The starting Stock is one already.
  await expect(adjustments).toHaveCount(1);
  await page.getByRole("combobox", { name: "Producto" }).selectOption({ label: "Agua de la casa" });
  await page.getByLabel("Unidades").fill("4");
  await tap(held, page.getByRole("button", { name: "Registrar ajuste" }));
  await expect(row).toContainText("Existencias: 6");
  await expect(adjustments).toHaveCount(1);
  await held.release();
  await expect(row).toContainText("Existencias: 10");
  await expect(adjustments).toHaveCount(2);
  await settled(page);

  // Its cancellation.
  const entrada = page.getByRole("listitem", { name: "Entrada de 4 de Agua de la casa", exact: true });
  await entrada.getByLabel("Motivo de la cancelación").fill("Se contó dos veces");
  await tap(held, entrada.getByRole("button", { name: "Cancelar ajuste" }));
  await expect(row).toContainText("Existencias: 10");
  await expect(page.getByText(/Cancelado:/)).toHaveCount(0);
  await held.release();
  await expect(entrada).toContainText("Cancelado: Se contó dos veces");
  await expect(row).toContainText("Existencias: 6");
  await settled(page);

  // A Count: the review, then the confirmation.
  await page.getByRole("link", { name: "Iniciar conteo" }).click();
  await expect(page.getByRole("heading", { name: "Conteo", level: 1 })).toBeVisible();
  await page.getByLabel("Agua de la casa", { exact: true }).fill("9");
  await tap(held, page.getByRole("button", { name: "Revisar conteo" }));
  await expect(page.getByRole("heading", { name: "Revisión del conteo" })).toHaveCount(0);
  await held.release();
  await expect(page.getByRole("listitem", { name: "Agua de la casa" })).toContainText("Esperado: 6 · Contado: 9");
  await settled(page);

  await tap(held, page.getByRole("button", { name: "Confirmar conteo" }));
  await expect(page).toHaveURL(/\/inventario\/conteo$/);
  await expect(page.getByRole("heading", { name: "Revisión del conteo" })).toBeVisible();
  await held.release();
  await expect(page).toHaveURL(/\/diferencias$/);
  await page.goto("/inventario");
  await expect(row).toContainText("Existencias: 9");
});

test("every form of Productos and of a Producto is pending from the tap", async ({
  page,
  signInAs,
  addCategory,
  addItem,
}) => {
  await signInAs("admin", "Ana");
  const bebidas = await addCategory("Bebidas");
  const agua = await addItem({ name: "Agua mineral", price: 1850, category: bebidas });
  await addCategory("Temporada");
  await page.goto("/productos");
  const held = await holdSubmissions(page);

  const newCategory = page.getByRole("region", { name: "Nueva categoría" });
  await newCategory.getByLabel("Nombre de la categoría").fill("Postres");
  await tapThrough(page, held, newCategory.getByRole("button", { name: "Agregar categoría" }));
  await expect(page.getByRole("heading", { name: "Postres", level: 2 })).toBeVisible();

  await page.getByText("Nuevo producto").click();
  const newItem = page.locator("details", { hasText: "Nuevo producto" });
  await newItem.getByLabel("Nombre", { exact: true }).fill("Flan");
  await newItem.getByLabel("Precio").fill("30.00");
  await tapThrough(page, held, newItem.getByRole("button", { name: "Agregar producto" }));
  await expect(page.getByText("Flan")).toBeVisible();

  const section = page.getByRole("region", { name: "Bebidas", exact: true });
  await section.getByText("Cambiar categoría").click();
  await tapThrough(page, held, section.getByRole("button", { name: "Bajar Bebidas" }));
  await tapThrough(page, held, section.getByRole("button", { name: "Subir Bebidas" }));
  await tapThrough(page, held, section.getByRole("button", { name: "Guardar nombre" }));
  // Only a Category with no active Item can be retired.
  const empty = page.getByRole("region", { name: "Temporada", exact: true });
  await empty.getByText("Cambiar categoría").click();
  await tapThrough(page, held, empty.getByRole("button", { name: "Retirar Temporada" }));
  await tapThrough(page, held, page.getByRole("button", { name: "Restaurar Temporada" }));
  await expect(empty).toBeVisible();

  await page.goto(`/productos/${agua.id}`);
  await tapThrough(page, held, page.getByRole("button", { name: "Retirar producto" }));
  await expect(page.getByText("Retirado: no aparece en Vender.")).toBeVisible();
  await tapThrough(page, held, page.getByRole("button", { name: "Restaurar producto" }));
  await expect(page.getByText("Retirado: no aparece en Vender.")).toHaveCount(0);
  await page.getByLabel("Mínimo").fill("3");
  await tapThrough(page, held, page.getByRole("button", { name: "Guardar" }));
  await expect(page).toHaveURL(/\/productos$/);
  await expect(page.getByText("Mínimo 3")).toBeVisible();
});

test("the filters of Cuentas and Día are pending while their page loads", async ({ page, signInAs }) => {
  await signInAs("admin", "Ana");
  await page.goto("/cuentas");
  const held = await holdSubmissions(page, { loads: true });

  const filtrar = page.locator("main form button[type=submit]");
  await page.getByLabel("Estado").selectOption({ label: "Pagada" });
  await tap(held, filtrar);
  await expect(filtrar).toHaveText("Filtrando…");
  await held.release();
  await expect(page).toHaveURL(/estado=paid/);
  await expect(filtrar).toHaveText("Filtrar");
  await settled(page);

  // Día is reached with a held load of its own.
  await held.stop();
  await page.goto("/dia");
  const heldAgain = await holdSubmissions(page, { loads: true });
  const ver = page.locator("main form button[type=submit]");
  await tap(heldAgain, ver);
  await expect(ver).toHaveText("Viendo…");
  await heldAgain.release();
  await expect(ver).toHaveText("Ver");
});
