import { expect, test } from "./fixtures";

// A form that records something answers with a redirect, and what the screen
// says afterwards travels with it (spec §3.4, ticket 27): the message shows
// once, and a reload or the back button neither repeats it nor records
// anything again. Both projects run a phone viewport (playwright.config.ts).

test("a recorded sale shows its message once: not on a reload, nor going back and forward", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  await addItem({ name: "Agua mineral", price: 1850, stock: { units: 6, by: beto } });

  // Arrive at Vender from another screen, so there is somewhere to go back to.
  await page.goto("/cuentas-abiertas");
  await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Vender" }).click();
  await expect(page.getByRole("heading", { name: "Vender", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: /Agua mineral/ }).click();
  await expect(page.getByRole("region", { name: "Selección" })).toContainText("$18.50");
  await page.getByRole("region", { name: "Cobrar" }).getByRole("button", { name: "Cobrar" }).click();

  // The message, and a new form: the selection is empty.
  await expect(page.getByRole("status")).toHaveText("Cuenta pagada: $18.50.");
  await expect(page.getByRole("region", { name: "Selección" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  expect(await query("SELECT id FROM bills")).toHaveLength(1);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Vender", level: 1 })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Cuentas abiertas", level: 1 })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Vender", level: 1 })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);

  expect(await query("SELECT id FROM bills")).toHaveLength(1);
  expect(await query("SELECT id FROM payments")).toHaveLength(1);
});

test("a refused form keeps what was typed and shows its message", async ({ page, signInAs, addCustomer, query }) => {
  const beto = await signInAs("worker", "Beto");
  const ruiz = await addCustomer("Familia Ruiz", { by: beto });
  await query(
    `INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
     VALUES ('ruiz-a', '2026-09-29', ?, 1000, ?, 5000, 0, 'open', 0)`,
    [beto.id, ruiz.id],
  );

  await page.goto(`/clientes/${ruiz.id}`);
  const abonar = page.getByRole("region", { name: "Abonar" });
  await abonar.getByLabel("Monto").fill("100.00");
  await abonar.getByRole("radio", { name: "Transferencia" }).check();
  await abonar.getByRole("button", { name: "Abonar" }).click();

  await expect(page.getByRole("alert")).toHaveText("El abono no puede ser mayor que lo que debe el cliente.");
  await expect(abonar.getByLabel("Monto")).toHaveValue("100.00");
  await expect(abonar.getByRole("radio", { name: "Transferencia" })).toBeChecked();
  expect(await query("SELECT id FROM payments")).toHaveLength(0);

  // Once it is recorded, the refusal is gone and the message takes its place.
  await abonar.getByLabel("Monto").fill("20.00");
  await abonar.getByRole("button", { name: "Abonar" }).click();
  await expect(page.getByRole("status")).toHaveText("Abono de $20.00 registrado.");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(abonar.getByLabel("Monto")).toHaveValue("$30.00");
});

test.describe("before JavaScript has loaded", () => {
  test.use({ javaScriptEnabled: false });

  test("a document POST is answered with a redirect, and a reload records nothing", async ({
    page,
    signInAs,
    addCustomer,
    query,
  }) => {
    const beto = await signInAs("worker", "Beto");
    const ruiz = await addCustomer("Familia Ruiz", { by: beto });
    await query(
      `INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
       VALUES ('ruiz-a', '2026-09-29', ?, 1000, ?, 5000, 0, 'open', 0)`,
      [beto.id, ruiz.id],
    );

    await page.goto(`/clientes/${ruiz.id}`);
    await page.getByRole("region", { name: "Abonar" }).getByLabel("Monto").fill("20.00");
    const [posted] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      page.getByRole("region", { name: "Abonar" }).getByRole("button", { name: "Abonar" }).click(),
    ]);

    expect(posted.status()).toBe(302);
    await expect(page.getByRole("status")).toHaveText("Abono de $20.00 registrado.");
    await expect(page.getByText("Debe $30.00 en 1 cuenta.")).toBeVisible();
    expect(await query("SELECT id FROM payments")).toHaveLength(1);

    // The page was loaded with a GET: reloading it is not a submission.
    await page.reload();
    await expect(page.getByText("Debe $30.00 en 1 cuenta.")).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(await query("SELECT id FROM payments")).toHaveLength(1);
  });
});
