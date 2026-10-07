import { expect, test } from "./fixtures";
import { goTo } from "./support/navigate";
import { holdSubmissions } from "./support/held";
import { pay } from "./support/sell";

// A recorded form answers the request that sent it with a notice, and the
// screen that sent it shows the words once (spec §3.4, tickets 27, 33 and
// 34): a reload or the back button neither repeats the message nor records
// anything again, and another tab cannot take the words. Both projects run a
// phone viewport (playwright.config.ts).

test("a confirmed sale is not recorded again by a reload or by going back and forward", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  await addItem({ name: "Agua mineral", price: 1850, stock: { units: 6, by: beto } });

  // Arrive at Vender from another screen, so there is somewhere to go back to.
  await page.goto("/cuentas-abiertas");
  await goTo(page, "Vender");
  await pay(page, { items: ["Agua mineral"] });
  await expect(page.getByRole("status")).toHaveText("$18.50 en efectivo. Cuenta pagada.");
  expect(await query("SELECT id FROM bills")).toHaveLength(1);

  // The result is this screen's own: a reload starts from nothing and says nothing.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Vender", level: 1 })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page).not.toHaveURL(/paso=/);

  await page.goBack();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Vender", level: 1 })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);

  expect(await query("SELECT id FROM bills")).toHaveLength(1);
  expect(await query("SELECT id FROM payments")).toHaveLength(1);
});

test("a recorded form's words reach the tab that sent it, and no other", async ({
  page,
  context,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto de dos pestañas");
  const ruiz = await addCustomer("Familia de dos pestañas", { by: beto });
  await query(
    `INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
     VALUES ('dos-pestanas', '2026-09-29', ?, 1000, ?, 5000, 0, 'open', 0)`,
    [beto.id, ruiz.id],
  );

  await page.goto(`/clientes/${ruiz.id}`);
  // The Abonar and the loads it answers with are held, so the words are on
  // their way while the other tab looks.
  const held = await holdSubmissions(page, { loads: true });
  await page.getByRole("region", { name: "Abonar" }).getByLabel("Monto").fill("20.00");
  await page.getByRole("region", { name: "Abonar" }).getByRole("button", { name: "Abonar" }).click();
  await held.waitFor(1);

  const other = await context.newPage();
  await other.goto(`/clientes/${ruiz.id}`);
  await expect(other.getByText("Debe $50.00 en 1 cuenta.")).toBeVisible();

  await held.release();
  // The answer is in flight, still held; the other tab asks for the page and
  // must find nothing of it.
  await held.waitFor(1);
  await other.reload();
  await expect(other.getByRole("status")).toHaveCount(0);

  await held.releaseAll();
  await expect(page.getByRole("status")).toHaveText("Abono de $20.00 registrado.");
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(other.getByRole("status")).toHaveCount(0);
  expect(await query("SELECT amount FROM payments")).toEqual([{ amount: 2000 }]);
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
