import { expect, test } from "./fixtures";
import { openPay, payBill, seeBill, typePayment } from "./support/bill";

// A form that creates a Payment, an Adjustment or a Count carries a key, and
// the server records one submission per key and content (spec §3.4, tickets
// 28 and 32): a double tap records once, and the next form carries a new key.
// Vender's sale, Cuenta's Payment and Inventario's Adjustment make their key
// at the tap; a sale's double tap and retry are in e2e/vender-recovery.spec.ts,
// a Payment's retry in e2e/cuenta-cobrar.spec.ts, an Adjustment's double tap
// and retry in e2e/inventario.spec.ts. A changed form sent with a used key is
// never answered as the repeat of what that key first recorded; no screen
// sends one any more, so tests/submissions-routes.test.ts holds it through
// the Worker.

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
