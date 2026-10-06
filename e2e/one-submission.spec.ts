import type { Locator } from "@playwright/test";

import { expect, test } from "./fixtures";

// A form that creates a Bill or a Payment carries a key made when it was
// rendered, and the server records one submission per key (spec §3.4, ticket
// 28): a double tap records once, and the form the page renders next carries
// a new key, so the same sale or Payment made again is recorded again.

/**
 * Sends a form twice in the same instant, the way a double tap does before
 * the button is disabled: both submissions carry what the form holds now.
 */
const submitTwice = (button: Locator) =>
  button.evaluate((element) => {
    const submit = element as HTMLButtonElement;
    submit.form!.requestSubmit(submit);
    submit.form!.requestSubmit(submit);
  });

test("a double tap on Cobrar records one sale, and the same Items sell again afterwards", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const agua = await addItem({ name: "Agua mineral", price: 1850, stock: { units: 6, by: beto } });
  const cobrar = page.getByRole("region", { name: "Cobrar" }).getByRole("button", { name: "Cobrar" });

  await page.goto("/");
  await page.getByRole("button", { name: /Agua mineral/ }).click();
  await expect(page.getByRole("region", { name: "Selección" })).toContainText("$18.50");
  await submitTwice(cobrar);

  await expect(page.getByRole("status")).toHaveText("Cuenta pagada: $18.50.");
  await expect(page.getByRole("region", { name: "Selección" })).toHaveCount(0);
  expect(await query("SELECT id FROM bills")).toHaveLength(1);
  expect(await query("SELECT id FROM lines")).toHaveLength(1);
  expect(await query("SELECT id FROM payments")).toHaveLength(1);
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 5 }]);

  // The next sale of the same Item, from the form the page rendered after it.
  await page.getByRole("button", { name: /Agua mineral/ }).click();
  await expect(page.getByRole("region", { name: "Selección" })).toContainText("$18.50");
  await cobrar.click();

  await expect.poll(() => query("SELECT id FROM bills")).toHaveLength(2);
  expect(await query("SELECT id FROM payments")).toHaveLength(2);
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [agua.id])).toEqual([{ units: 4 }]);
});

test("a double tap on a Bill's Cobrar records one Payment, and the next one is recorded too", async ({
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
  const cobrar = page.getByRole("region", { name: "Cobrar" });

  await page.goto("/cuentas/doble");
  await cobrar.getByLabel("Monto").fill("20.00");
  await cobrar.getByRole("radio", { name: "Efectivo" }).check();
  await submitTwice(cobrar.getByRole("button", { name: "Cobrar" }));

  // Answered as one Payment, not as a Bill that changed under the second tap.
  await expect(page.getByRole("status")).toHaveText("Abono de $20.00 registrado. Debe $30.00.");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await query("SELECT amount FROM payments")).toEqual([{ amount: 2000 }]);

  // The same amount again, from the form the page rendered after the first.
  await cobrar.getByLabel("Monto").fill("20.00");
  await cobrar.getByRole("radio", { name: "Efectivo" }).check();
  await cobrar.getByRole("button", { name: "Cobrar" }).click();

  await expect(page.getByRole("status")).toHaveText("Abono de $20.00 registrado. Debe $10.00.");
  expect(await query("SELECT amount FROM payments")).toEqual([{ amount: 2000 }, { amount: 2000 }]);
});
