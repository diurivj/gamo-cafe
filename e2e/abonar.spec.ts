import { expect, test } from "./fixtures";

// Abonar across a Customer's Open Bills (spec §5.5, §6.1 Clientes, §8.3,
// §10.3): one amount, oldest Bill first, one shared-reference Payment per
// Bill, the whole handover as one event. A Customer with several Open Bills
// is seeded directly: the routing rule of §5.3 keeps one Open Bill per
// Customer per Day, so only the records of earlier Days can leave more than
// one behind. Both projects run a phone viewport (playwright.config.ts).

const openBill = (id: string, day: string, openedAt: number, total: number, paid: number, state: string, revision: number) => ({
  id,
  day,
  openedAt,
  total,
  paid,
  state,
  revision,
});

test("a Worker pays part of what a Customer owes across their Open Bills", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const ruiz = await addCustomer("Familia Ruiz", { by: beto });
  // Two Open Bills, oldest first: $50.00 and $30.00, plus a Paid one that
  // must not move or show.
  const bills = [
    openBill("ruiz-vieja", "2026-09-29", 1000, 5000, 0, "open", 0),
    openBill("ruiz-nueva", "2026-09-30", 2000, 3000, 0, "open", 0),
    openBill("ruiz-pagada", "2026-09-28", 500, 1000, 1000, "paid", 4),
  ];
  for (const bill of bills) {
    await query(
      `INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bill.id, bill.day, beto.id, bill.openedAt, ruiz.id, bill.total, bill.paid, bill.state, bill.revision],
    );
  }

  await page.goto(`/clientes/${ruiz.id}`);
  await expect(page.getByRole("heading", { name: "Familia Ruiz" })).toBeVisible();
  await expect(page.getByText("Debe $80.00 en 2 cuentas.")).toBeVisible();
  // Only the Open Bills are listed.
  const openBills = page.getByRole("list", { name: "Cuentas abiertas" });
  await expect(openBills.getByRole("listitem")).toHaveCount(2);
  await expect(openBills).not.toContainText("ruiz-pagada");
  await expect(openBills.getByRole("listitem").first()).toContainText("$50.00");

  const abonar = page.getByRole("region", { name: "Abonar" });
  // The amount starts at everything owed (spec §5.5, flow §8.3).
  await expect(abonar.getByLabel("Monto")).toHaveValue("$80.00");

  // More than they owe is refused, and nothing is recorded.
  await abonar.getByLabel("Monto").fill("100.00");
  await abonar.getByRole("button", { name: "Abonar" }).click();
  await expect(page.getByRole("alert")).toHaveText("El abono no puede ser mayor que lo que debe el cliente.");
  expect(await query("SELECT id FROM payments")).toHaveLength(0);

  // $60.00 covers the oldest Bill and puts $10.00 on the next one.
  await abonar.getByLabel("Monto").fill("60.00");
  await abonar.getByRole("radio", { name: "Transferencia" }).check();
  await abonar.getByRole("button", { name: "Abonar" }).click();

  await expect(page.getByRole("status")).toHaveText("Abono de $60.00 registrado.");
  expect(
    await query("SELECT id, paid, state FROM bills WHERE id IN ('ruiz-vieja', 'ruiz-nueva') ORDER BY opened_at"),
  ).toMatchObject([
    { id: "ruiz-vieja", paid: 5000, state: "paid" },
    { id: "ruiz-nueva", paid: 1000, state: "partial" },
  ]);
  expect(await query("SELECT paid, state FROM bills WHERE id = 'ruiz-pagada'")).toMatchObject([
    { paid: 1000, state: "paid" },
  ]);

  // One Payment per Bill, same method, receiver and reference.
  const payments = (await query(
    "SELECT bill_id, amount, method, received_by, handover_reference FROM payments ORDER BY amount DESC",
  )) as Array<{ bill_id: string; amount: number; method: string; received_by: string; handover_reference: string }>;
  expect(payments).toMatchObject([
    { bill_id: "ruiz-vieja", amount: 5000, method: "transfer", received_by: beto.id },
    { bill_id: "ruiz-nueva", amount: 1000, method: "transfer", received_by: beto.id },
  ]);
  expect(new Set(payments.map((payment) => payment.handover_reference)).size).toBe(1);

  // The page shows the handover as one event, adds it up and counts the Bills;
  // the covered Bill left the Open Bills list.
  const events = page.getByRole("list", { name: "Abonos" });
  await expect(events.getByRole("listitem")).toHaveCount(1);
  await expect(events.getByRole("listitem")).toContainText("$60.00");
  await expect(events.getByRole("listitem")).toContainText("Transferencia");
  await expect(events.getByRole("listitem")).toContainText("Beto");
  await expect(events.getByRole("listitem")).toContainText("2 cuentas");
  await expect(page.getByText("Debe $20.00 en 1 cuenta.")).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a stale Abonar changes nothing and tells the User the Bills changed", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const ruiz = await addCustomer("Familia Paz", { by: beto });
  await query(
    `INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
     VALUES ('paz-a', '2026-09-29', ?, 1000, ?, 5000, 0, 'open', 0),
            ('paz-b', '2026-09-30', ?, 2000, ?, 3000, 0, 'open', 0)`,
    [beto.id, ruiz.id, beto.id, ruiz.id],
  );

  await page.goto(`/clientes/${ruiz.id}`);
  await expect(page.getByText("Debe $80.00 en 2 cuentas.")).toBeVisible();

  // Another phone pays the older Bill in full before this page is submitted.
  await query(
    `UPDATE bills SET paid = total, state = 'paid', revision = revision + 1 WHERE id = 'paz-a'`,
  );

  await page.getByRole("region", { name: "Abonar" }).getByRole("button", { name: "Abonar" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "Las cuentas del cliente cambiaron mientras registrabas el abono. Revisa el monto y vuelve a intentar.",
  );
  // Nothing was recorded against the Bill that is now open: the whole
  // submission was refused (spec §5.5, §10.3).
  expect(await query("SELECT amount FROM payments WHERE bill_id = 'paz-b'")).toHaveLength(0);
  expect(await query("SELECT paid, state FROM bills WHERE id = 'paz-b'")).toMatchObject([
    { paid: 0, state: "open" },
  ]);
});
