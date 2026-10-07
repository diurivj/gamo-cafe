import type { Page } from "@playwright/test";

import { expect } from "../fixtures";

/**
 * Cuenta as a User drives it (UI redesign §5.3): the Bill, the step that takes
 * a Payment, and the confirmed result, which stays until the User goes on.
 *
 *     await page.goto(`/cuentas/${billId}`);
 *     await payBill(page, { amount: "10.00" });   // ends on "Pago registrado"
 *     await seeBill(page);                         // back on the Bill, read again
 */

const title = (page: Page, name: string) => page.getByRole("heading", { name, level: 1 });

/** The Bill's figures, as Cuenta leads with them: Debe, Total and Pagado. */
export const summary = (page: Page) => page.getByRole("region", { name: "Resumen" });

/** From the Bill to the step that takes a Payment. */
export async function openPay(page: Page) {
  await page.getByRole("link", { name: "Cobrar", exact: true }).click();
  await expect(title(page, "Cobrar")).toBeVisible();
}

export interface BillPayment {
  readonly method?: "Efectivo" | "Transferencia";
  /** Pays only a part. */
  readonly amount?: string;
  /** The cash handed over. */
  readonly handed?: string;
}

/** Fills the Payment on the Cobrar step, without sending it. */
export async function typePayment(page: Page, payment: BillPayment) {
  if (payment.method) await page.getByRole("radio", { name: payment.method }).check();
  if (payment.amount) {
    await page.getByRole("button", { name: "Cobrar solo una parte" }).click();
    await page.getByLabel("Monto a cobrar").fill(payment.amount);
  }
  if (payment.handed) await page.getByLabel("Efectivo que te entregan (opcional)").fill(payment.handed);
}

/** A whole Payment from the Bill on screen: everything it owes in cash unless told otherwise. */
export async function payBill(page: Page, payment: BillPayment = {}) {
  await openPay(page);
  await typePayment(page, payment);
  await page.getByRole("button", { name: /^Registrar pago de / }).click();
  await expect(title(page, "Pago registrado")).toBeVisible();
}

/** From a confirmed Payment back to its Bill, read again. */
export async function seeBill(page: Page) {
  await page.getByRole("button", { name: "Ver cuenta" }).click();
  await expect(title(page, "Cuenta")).toBeVisible();
}
