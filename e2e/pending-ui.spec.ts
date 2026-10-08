import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { holdSubmissions } from "./support/held";
import { openPay, seeBill, summary, typePayment } from "./support/bill";
import { goTo } from "./support/navigate";
import { pay } from "./support/sell";

// Every tap is acknowledged at once (spec §3.4, ticket 30). Each test holds
// the server's answer back and looks at the screen meanwhile:
//
// - the submit control that was tapped is pending by the next frame;
// - money (a Payment, an Abono, a correction) shows nothing as recorded until
//   the answer arrives;
// - a harmless, reversible change (retiring a Customer) shows its result at
//   once and goes back if it is refused.
//
// Vender's own pending state is in vender-recovery.spec.ts, an Adjustment's
// and its cancellation's in inventario.spec.ts, a Count's in conteo.spec.ts
// and Usuarios' in usuarios.spec.ts.

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
  const figures = summary(page);
  const payments = page.getByRole("list", { name: "Pagos" }).getByRole("listitem");

  // Cliente y nota.
  await page.getByLabel("Nota (opcional)").fill("Mesa 2");
  await tap(held, page.getByRole("button", { name: "Guardar" }));
  await expect(page.getByText("Sin cliente")).toBeVisible();
  await held.release();
  await expect(page.locator("p", { hasText: /^Mesa 2$/ })).toBeVisible();
  await settled(page);

  // A Payment: said to be on its way, and nothing more, until the answer
  // (e2e/cuenta-cobrar.spec.ts looks at that screen closely).
  await expect(figures).toContainText("Pagado $10.00");
  await expect(figures).toContainText("Debe $33.50");
  await expect(payments).toHaveCount(1);
  await openPay(page);
  await typePayment(page, { amount: "5.00" });
  await page.getByRole("button", { name: "Registrar pago de $5.00" }).click();
  await held.waitFor(1);
  await expect(page.getByRole("heading", { name: "Registrando pago de $5.00…", level: 1 })).toBeVisible();
  await expect(page.getByText(/Pago registrado|todavía debe/)).toHaveCount(0);
  await held.release();
  await expect(page.getByRole("status")).toHaveText("$5.00 en efectivo. La cuenta todavía debe $28.50.");
  await seeBill(page);
  await expect(payments).toHaveCount(2);
  await settled(page);

  // A correction: said to be on its way, and nothing more, until the answer
  // (e2e/corrections.spec.ts looks at those screens closely).
  const correct = async (link: string, action: string, reason: string) => {
    await page.getByRole("link", { name: link, exact: true }).click();
    await page.getByLabel("Motivo").fill(reason);
    await page.getByRole("button", { name: action, exact: true }).click();
    await held.waitFor(1);
  };

  // Removing a Payment.
  await correct("Quitar pago de $5.00", "Quitar pago de $5.00", "Se cobró de más");
  await expect(page.getByRole("heading", { name: "Quitando pago de $5.00 en efectivo…", level: 1 })).toBeVisible();
  await expect(page.getByText(/Pago quitado|Quitado por/)).toHaveCount(0);
  await held.release();
  await expect(page.getByRole("status")).toHaveText("$5.00 en efectivo. La cuenta debe $33.50.");
  await seeBill(page);
  await expect(page.getByText(/Quitado por Ana .* Se cobró de más/)).toBeVisible();
  await expect(figures).toContainText("Pagado $10.00");
  await settled(page);

  // Removing a Line.
  await correct("Quitar 1 × Agua mineral", "Quitar 1 × Agua mineral", "No se lo llevó");
  await expect(page.getByRole("heading", { name: "Quitando 1 × Agua mineral…", level: 1 })).toBeVisible();
  await expect(page.getByText(/Producto quitado|Quitado por Ana .* No se lo llevó/)).toHaveCount(0);
  await held.release();
  await expect(page.getByRole("status")).toHaveText("1 × Agua mineral. La cuenta suma $25.00 y debe $15.00.");
  await seeBill(page);
  await expect(figures).toContainText("Total $25.00");
  await settled(page);

  // Voiding the Bill.
  await correct("Cancelar esta cuenta", "Cancelar cuenta", "Se abrió por error");
  await expect(page.getByRole("heading", { name: "Cancelando cuenta…", level: 1 })).toBeVisible();
  await expect(page.getByText(/Cuenta cancelada|Cancelada por/)).toHaveCount(0);
  await held.release();
  await expect(page.getByRole("heading", { name: "Cuenta cancelada", level: 1 })).toBeVisible();
  await seeBill(page);
  await expect(page.getByText(/Cancelada por Ana/)).toBeVisible();
});

test("a Customer's page shows a rename only after the answer; retiring and restoring show at once", async ({
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

  // An Abonar is not a form of this page: its pending state is in abonar.spec.ts.

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

  await page.getByRole("link", { name: "Categorías", exact: true }).click();
  const newCategory = page.getByRole("region", { name: "Nueva categoría" });
  await newCategory.getByLabel("Nombre de la categoría").fill("Postres");
  await tapThrough(page, held, newCategory.getByRole("button", { name: "Agregar categoría" }));
  await expect(page.getByRole("listitem", { name: "Postres", exact: true })).toBeVisible();

  await tapThrough(page, held, page.getByRole("button", { name: "Bajar Bebidas" }));
  await tapThrough(page, held, page.getByRole("button", { name: "Subir Bebidas" }));
  await page.getByRole("listitem", { name: "Bebidas", exact: true }).getByRole("link").click();
  await tapThrough(page, held, page.getByRole("button", { name: "Guardar nombre" }));
  // Only a Category with no active Item can be retired.
  await page.goto("/productos?paso=categorias");
  await page.getByRole("listitem", { name: "Temporada", exact: true }).getByRole("link").click();
  await tapThrough(page, held, page.getByRole("button", { name: "Retirar categoría" }));
  await tapThrough(page, held, page.getByRole("button", { name: "Restaurar categoría" }));
  await expect(page.getByRole("status")).toHaveText("Categoría restaurada.");

  // An Item and its starting Stock: nothing says recorded before the answer.
  await page.goto("/productos?paso=nuevo");
  await page.getByLabel("Nombre", { exact: true }).fill("Flan");
  await page.getByLabel("Precio", { exact: true }).fill("30.00");
  await page.getByLabel("Existencias iniciales (opcional)").fill("12");
  const add = page.getByRole("button", { name: "Agregar producto" });
  await tap(held, add);
  await expect(page.locator("button[type=submit]", { hasText: "Agregando…" })).toBeVisible();
  await expect(page.getByText(/Se agregó|Se registró/)).toHaveCount(0);
  await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Flan");
  await held.release();
  await settled(page);
  await expect(page.getByRole("status")).toHaveText("Se agregó «Flan». Se registró una entrada de 12 en existencias.");

  await page.goto(`/productos/${agua.id}`);
  await tapThrough(page, held, page.getByRole("button", { name: "Retirar producto" }));
  await expect(page.getByRole("status")).toHaveText("Producto retirado. Ya no aparece en Vender.");
  await tapThrough(page, held, page.getByRole("button", { name: "Restaurar producto" }));
  await expect(page.getByRole("status")).toHaveText("Producto restaurado. Ya aparece en Vender.");
  await page.getByLabel("Mínimo (opcional)").fill("3");
  await tapThrough(page, held, page.getByRole("button", { name: "Guardar cambios" }));
  await expect(page.getByRole("status")).toHaveText("Cambios guardados.");
  await expect(page.getByLabel("Mínimo (opcional)")).toHaveValue("3");
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
