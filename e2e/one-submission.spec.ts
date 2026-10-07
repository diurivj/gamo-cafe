import { expect, test } from "./fixtures";
import { openPay, payBill, seeBill, typePayment } from "./support/bill";

// A form that creates a Payment, an Adjustment or a Count carries a key made
// when it was rendered, and the server records one submission per key and
// content (spec §3.4, tickets 28 and 32): a double tap records once, the form
// the page renders next carries a new key, and a changed form sent with a
// used key — from a document the browser restored, say — is never answered as
// the repeat of what that key first recorded. Vender's sale and Cuenta's
// Payment make their key at the tap; a sale's double tap and retry are in
// e2e/vender-recovery.spec.ts, a Payment's retry in e2e/cuenta-cobrar.spec.ts.

test("a double tap on Cuenta's Registrar pago records one Payment, and the next one is recorded too", async ({
  page,
  signInAs,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  await query(
    `INSERT INTO bills (id, day, opened_by, opened_at, total, paid, state, revision)
     VALUES ('doble', '2026-09-29', ?, 1000, 5000, 0, 'open', 0)`,
    [ana.id],
  );
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") sent.push(new URL(request.url()).pathname);
  });

  await page.goto("/cuentas/doble");
  await openPay(page);
  await typePayment(page, { amount: "20.00" });
  // Twice in the same instant, before the screen can take the button away.
  await page.getByRole("button", { name: "Registrar pago de $20.00" }).evaluate((button: HTMLElement) => {
    button.click();
    button.click();
  });

  // One Payment, sent once: the second tap found it already on its way.
  await expect(page.getByRole("heading", { name: "Pago registrado", level: 1 })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("$20.00 en efectivo. La cuenta todavía debe $30.00.");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(sent).toEqual(["/cuentas/doble/cobrar"]);
  expect(await query("SELECT amount FROM payments")).toEqual([{ amount: 2000 }]);

  // The same amount again is another Payment, with the Bill's new revision and its own key.
  await seeBill(page);
  await payBill(page, { amount: "20.00" });

  await expect(page.getByRole("status")).toHaveText("$20.00 en efectivo. La cuenta todavía debe $10.00.");
  expect(await query("SELECT amount FROM payments")).toEqual([{ amount: 2000 }, { amount: 2000 }]);
});

// A document the browser restored still carries the submission key it was
// rendered with, and what it sends from there may be a changed form (spec
// §3.4, ticket 32). Playwright's Chromium refetches the app's `no-store`
// pages on Back instead of holding them in its bfcache, so the test serves
// the recorded document — byte for byte — for that one navigation; the shape
// is the real one: a used key in the document, and a form that now carries
// something else.
test.describe("a restored document, before JavaScript has loaded", () => {
  test.use({ javaScriptEnabled: false });

  test("records a changed Adjustment sent with a used key, not as its repeat", async ({
    page,
    signInAs,
    addItem,
    query,
  }) => {
    const ana = await signInAs("admin", "Ana");
    const cafe = await addItem({ name: "Café molido", price: 1000, stock: { units: 1, by: ana } });

    await page.goto("/inventario");
    const form = page.getByRole("region", { name: "Registrar ajuste" });
    const usedKey = await form.locator('input[name="submissionKey"]').inputValue();
    const recorded = await page.content();
    await form.getByLabel("Producto").selectOption({ label: "Café molido" });
    await form.getByLabel("Motivo").selectOption("restock");
    await form.getByLabel("Unidades").fill("12");
    await form.getByRole("button", { name: "Registrar ajuste" }).click();
    await expect(page.getByText("Existencias: 13")).toBeVisible();

    let restore = true;
    await page.route("**/inventario", (route) => {
      if (restore && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "text/html", body: recorded });
      }
      return route.continue();
    });
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Inventario", level: 1 })).toBeVisible();
    restore = false;

    // The restored document carries the key that recorded the first Adjustment.
    expect(await form.locator('input[name="submissionKey"]').inputValue()).toBe(usedKey);

    await form.getByLabel("Producto").selectOption({ label: "Café molido" });
    await form.getByLabel("Motivo").selectOption("restock");
    await form.getByLabel("Unidades").fill("5");
    await form.getByRole("button", { name: "Registrar ajuste" }).click();

    await expect(page.getByText("Existencias: 18")).toBeVisible();
    expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [cafe.id])).toEqual([{ units: 18 }]);
    expect(await query("SELECT units FROM adjustments WHERE item_id = ? ORDER BY rowid", [cafe.id])).toEqual([
      { units: 1 },
      { units: 12 },
      { units: 5 },
    ]);
  });
});
