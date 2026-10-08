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

const SAVED = "Se guardaron los cambios de la cuenta.";

/** An Open Bill with no Payment: any User may change its note (spec §4.1). */
const openBill = (query: (sql: string, params?: Array<string | number | null>) => Promise<unknown>, id: string, by: string) =>
  query(
    `INSERT INTO bills (id, day, opened_by, opened_at, total, paid, state, revision)
     VALUES (?, '2026-09-29', ?, 1000, 5000, 0, 'open', 0)`,
    [id, by],
  );

// Cuenta's **Cliente y nota** stands for every form the router sends: a sale,
// a Payment, a correction and an Abonar are answered by their own routes
// (vender-recovery, cuenta-cobrar, corrections and abonar specs).
test("a recorded form's words reach the tab that sent it, and no other", async ({ page, context, signInAs, query }) => {
  const beto = await signInAs("worker", "Beto de dos pestañas");
  await openBill(query, "dos-pestanas", beto.id);

  await page.goto("/cuentas/dos-pestanas");
  // The form and the loads it answers with are held, so the words are on
  // their way while the other tab looks.
  const held = await holdSubmissions(page, { loads: true });
  await page.getByLabel("Nota (opcional)").fill("Mesa 4");
  await page.getByRole("button", { name: "Guardar" }).click();
  await held.waitFor(1);

  const other = await context.newPage();
  await other.goto("/cuentas/dos-pestanas");
  await expect(other.getByRole("heading", { name: "Cuenta", level: 1 })).toBeVisible();

  await held.release();
  // The answer is in flight, still held; the other tab asks for the page and
  // must find nothing of it.
  await held.waitFor(1);
  await other.reload();
  await expect(other.getByRole("status")).toHaveCount(0);

  await held.releaseAll();
  await expect(page.getByRole("status")).toHaveText(SAVED);
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(other.getByRole("status")).toHaveCount(0);
  expect(await query("SELECT note FROM bills")).toEqual([{ note: "Mesa 4" }]);
});

test("a refused form keeps what was typed and shows its message", async ({ page, signInAs, query }) => {
  const beto = await signInAs("worker", "Beto");
  await openBill(query, "rechazada", beto.id);

  await page.goto("/cuentas/rechazada");
  await page.getByLabel("Nota (opcional)").fill("Mesa 9");
  // Another phone changes the Bill before this form is sent.
  await query("UPDATE bills SET revision = revision + 1 WHERE id = 'rechazada'");
  await page.getByRole("button", { name: "Guardar" }).click();

  await expect(page.getByRole("alert")).toContainText("La cuenta cambió mientras la editabas y no se guardó nada.");
  await expect(page.getByLabel("Nota (opcional)")).toHaveValue("Mesa 9");
  expect(await query("SELECT note FROM bills")).toEqual([{ note: null }]);

  // Once it is recorded, the refusal is gone and the message takes its place.
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("status")).toHaveText(SAVED);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Nota (opcional)")).toHaveValue("Mesa 9");
});

test.describe("before JavaScript has loaded", () => {
  test.use({ javaScriptEnabled: false });

  test("a document POST is answered with a redirect, and a reload records nothing", async ({ page, signInAs, query }) => {
    const beto = await signInAs("worker", "Beto");
    await openBill(query, "sin-javascript", beto.id);

    await page.goto("/cuentas/sin-javascript");
    await page.getByLabel("Nota (opcional)").fill("Mesa 4");
    const [posted] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      page.getByRole("button", { name: "Guardar" }).click(),
    ]);

    expect(posted.status()).toBe(302);
    await expect(page.getByRole("status")).toHaveText(SAVED);
    await expect(page.getByRole("main")).toContainText("Mesa 4");
    expect(await query("SELECT note, revision FROM bills")).toEqual([{ note: "Mesa 4", revision: 1 }]);

    // The page was loaded with a GET: reloading it is not a submission.
    await page.reload();
    await expect(page.getByRole("main")).toContainText("Mesa 4");
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(await query("SELECT note, revision FROM bills")).toEqual([{ note: "Mesa 4", revision: 1 }]);
  });
});
