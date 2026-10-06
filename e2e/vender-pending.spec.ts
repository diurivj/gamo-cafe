import { expect, test } from "./fixtures";
import { holdSubmissions } from "./support/held";

// Vender acknowledges a sale at once (spec §3.4, ticket 30): the selection
// empties when Dejar abierta or Cobrar is tapped, the screen says the sale is
// being recorded, and the next one can start. It says "pagada" or "registrado"
// only once the server has answered, and a refused sale comes back.

const REFUSED = "El pago no puede ser mayor que el total de la selección.";

test("a second sale is started while the first is still being recorded, and both are recorded", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  await addItem({ name: "Agua mineral", price: 1850, stock: { units: 6, by: beto } });
  await page.goto("/");
  const held = await holdSubmissions(page);
  const recording = page.getByRole("list", { name: "Ventas que se están registrando" });
  const agua = page.getByRole("button", { name: /^Agua mineral/ });

  await agua.click();
  // Tapped, and looked at when the browser is about to paint the next frame.
  const cobrar = page.getByRole("region", { name: "Cobrar" }).getByRole("button", { name: "Cobrar" });
  await cobrar.evaluate((button: HTMLElement) =>
    button.addEventListener(
      "click",
      () =>
        requestAnimationFrame(() => {
          (window as unknown as { acknowledged?: boolean }).acknowledged =
            document.body.innerText.includes("Registrando venta de $18.50…") &&
            document.querySelector('[aria-labelledby="seleccion"]') === null;
        }),
      { once: true },
    ),
  );
  await cobrar.click();
  const acknowledged = await page.waitForFunction(
    () => (window as unknown as { acknowledged?: boolean }).acknowledged !== undefined,
  );
  await acknowledged.dispose();
  expect(await page.evaluate(() => (window as unknown as { acknowledged?: boolean }).acknowledged)).toBe(true);

  // At once: the selection is empty and the sale is said to be on its way.
  await expect(page.getByRole("region", { name: "Selección" })).toHaveCount(0);
  await expect(recording.getByRole("listitem")).toHaveText(["Registrando venta de $18.50…"]);
  // With nothing selected there is nothing to send: the second tap of a
  // double tap finds the button disabled.
  await expect(cobrar).toBeDisabled();
  // Nothing says it is paid: the server has not even received it.
  await held.waitFor(1);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByText(/pagada|registrado/i)).toHaveCount(0);
  expect(await query("SELECT id FROM bills")).toHaveLength(0);

  // The next sale starts, and is sent, while the first is still on its way.
  await agua.click();
  await agua.click();
  await expect(page.getByRole("region", { name: "Selección" })).toContainText("$37.00");
  await page.getByRole("button", { name: "Dejar abierta" }).click();
  await expect(page.getByRole("region", { name: "Selección" })).toHaveCount(0);
  await expect(recording.getByRole("listitem")).toHaveText([
    "Registrando venta de $18.50…",
    "Registrando venta de $37.00…",
  ]);
  await held.waitFor(2);
  await expect(page.getByRole("status")).toHaveCount(0);

  // A third selection, begun before either answer, is left alone by them.
  await agua.click();

  await held.release();
  await expect(page.getByRole("status")).toHaveText("Cuenta pagada: $18.50.");
  await expect(recording.getByRole("listitem")).toHaveText(["Registrando venta de $37.00…"]);
  await held.release();
  await expect(page.getByRole("status")).toHaveText("Se dejó abierta una cuenta por $37.00.");
  await expect(recording).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Selección" })).toContainText("$18.50");

  expect(await query("SELECT total, paid, state FROM bills ORDER BY total")).toEqual([
    { total: 1850, paid: 1850, state: "paid" },
    { total: 3700, paid: 0, state: "open" },
  ]);
});

test("a sale's words reach the Vender tab that recorded it, and no other", async ({
  page,
  context,
  signInAs,
  addItem,
  query,
}) => {
  const beto = await signInAs("worker", "Beto de dos pestañas");
  await addItem({ name: "Agua de dos pestañas", price: 1850, stock: { units: 6, by: beto } });
  await page.goto("/");
  // The sale and the loads it answers with are held, so the words are on
  // their way while the other tab looks.
  const held = await holdSubmissions(page, { loads: true });
  await page.getByRole("button", { name: /^Agua de dos pestañas/ }).click();
  await page.getByRole("region", { name: "Cobrar" }).getByRole("button", { name: "Cobrar" }).click();
  await held.waitFor(1);

  const other = await context.newPage();
  await other.goto("/");
  await expect(other.getByRole("button", { name: /^Agua de dos pestañas/ })).toBeVisible();

  await held.release();
  // The answer of the sale is in flight, still held; the other tab asks for
  // the page and must find nothing of it.
  await held.waitFor(1);
  await other.reload();
  await expect(other.getByRole("status")).toHaveCount(0);

  await held.releaseAll();
  await expect(page.getByRole("status")).toHaveText("Cuenta pagada: $18.50.");
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(other.getByRole("status")).toHaveCount(0);
  expect(await query("SELECT id FROM bills")).toHaveLength(1);
});

test("a refused sale brings back the selection it emptied, with its Customer, note and Payment", async ({
  page,
  signInAs,
  addItem,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  await addItem({ name: "Agua mineral", price: 1850, stock: { units: 6, by: beto } });
  await addCustomer("Familia Ruiz", { by: beto });
  await page.goto("/");

  await page.getByRole("button", { name: /^Agua mineral/ }).click();
  await page.getByRole("button", { name: /^Agua mineral/ }).click();
  await page.getByLabel("Cliente", { exact: true }).pressSequentially("Fam");
  await page.getByRole("list", { name: "Coincidencias" }).getByRole("button", { name: "Familia Ruiz" }).click();
  await page.getByLabel("Nota (opcional)").fill("Paga los viernes");
  const cobrar = page.getByRole("region", { name: "Cobrar" });
  await cobrar.getByRole("radio", { name: "Transferencia" }).check();
  // More than the selection's total, which the server refuses.
  await cobrar.getByLabel("Monto").fill("100.00");

  const held = await holdSubmissions(page);
  await cobrar.getByRole("button", { name: "Cobrar" }).click();
  await expect(page.getByRole("region", { name: "Selección" })).toHaveCount(0);
  await expect(page.getByLabel("Nota (opcional)")).toHaveValue("");
  await held.waitFor(1);
  await held.release();

  await expect(page.getByRole("alert")).toHaveText(REFUSED);
  await expect(page.getByRole("region", { name: "Selección" })).toContainText("$37.00");
  await expect(page.getByRole("group", { name: "Cliente" })).toContainText("Familia Ruiz");
  await expect(page.getByLabel("Nota (opcional)")).toHaveValue("Paga los viernes");
  await expect(cobrar.getByRole("radio", { name: "Transferencia" })).toBeChecked();
  await expect(cobrar.getByLabel("Monto")).toHaveValue("100.00");
  await expect(page.getByRole("list", { name: "Ventas que se están registrando" })).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(await query("SELECT id FROM bills")).toHaveLength(0);
});

test("a refused sale joins the selection that was started meanwhile", async ({ page, signInAs, addItem, query }) => {
  const beto = await signInAs("worker", "Beto");
  const agua = await addItem({ name: "Agua mineral", price: 1850, stock: { units: 6, by: beto } });
  const cafe = await addItem({ name: "Café de olla", price: 2500, category: agua.category });
  await page.goto("/");

  await page.getByRole("button", { name: /^Agua mineral/ }).click();
  const cobrar = page.getByRole("region", { name: "Cobrar" });
  await cobrar.getByLabel("Monto").fill("100.00");
  const held = await holdSubmissions(page);
  await cobrar.getByRole("button", { name: "Cobrar" }).click();
  await held.waitFor(1);

  await page.getByRole("button", { name: new RegExp(`^${cafe.name}`) }).click();
  await expect(page.getByRole("region", { name: "Selección" })).toContainText("$25.00");
  await held.release();

  await expect(page.getByRole("alert")).toHaveText(REFUSED);
  const selection = page.getByRole("region", { name: "Selección" });
  await expect(selection).toContainText("Agua mineral");
  await expect(selection).toContainText("Café de olla");
  await expect(selection).toContainText("$43.50");
  // The form of the selection that was started is left as it was.
  await expect(cobrar.getByLabel("Monto")).toHaveValue("");
  expect(await query("SELECT id FROM bills")).toHaveLength(0);
});
