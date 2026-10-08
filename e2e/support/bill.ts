import type { Page } from "@playwright/test";

import { expect } from "../fixtures";

/**
 * Cuenta as a User drives it (UI redesign §5.3): the Bill, the step that takes
 * a Payment, and the confirmed result, which stays until the User goes on.
 *
 *     await page.goto(`/cuentas/${billId}`);
 *     await payBill(page, { amount: "10.00" });   // ends on "Pago registrado"
 *     await seeBill(page);                         // back on the Bill, read again
 *
 * A correction is a step of its own too (UI redesign §7.2): the Bill's link
 * that names the record, the step that says what will happen, and its result.
 *
 *     await removeLine(page, "1 × Agua mineral", "No se lo llevó");   // ends on "Producto quitado"
 *     await removePayment(page, "$5.00", "Se cobró de más");          // ends on "Pago quitado"
 *     await voidBill(page, "Era una prueba");                         // ends on "Cuenta cancelada"
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

/** The step of a correction: Quitar producto, Quitar pago or Cancelar cuenta. */
export type CorrectionStep = "Quitar producto" | "Quitar pago" | "Cancelar cuenta";

/** From the Bill to a correction's step, by the link that names its record. */
export async function openCorrection(page: Page, link: string, step: CorrectionStep) {
  await page.getByRole("link", { name: link, exact: true }).first().click();
  await expect(title(page, step)).toBeVisible();
}

/** A correction from the Bill on screen to its confirmed result. The reason goes in when the step asks for one. */
async function correct(
  page: Page,
  correction: { link: string; step: CorrectionStep; action: string; done: string; reason?: string | undefined },
) {
  await openCorrection(page, correction.link, correction.step);
  if (correction.reason !== undefined) await page.getByLabel("Motivo").fill(correction.reason);
  await page.getByRole("button", { name: correction.action, exact: true }).click();
  await expect(title(page, correction.done)).toBeVisible();
}

/** Removes a Line, named as the Bill names it: "1 × Agua mineral". */
export const removeLine = (page: Page, what: string, reason?: string) =>
  correct(page, { link: `Quitar ${what}`, step: "Quitar producto", action: `Quitar ${what}`, done: "Producto quitado", reason });

/** Removes a Payment, named by its amount: "$5.00". */
export const removePayment = (page: Page, amount: string, reason: string) =>
  correct(page, {
    link: `Quitar pago de ${amount}`,
    step: "Quitar pago",
    action: `Quitar pago de ${amount}`,
    done: "Pago quitado",
    reason,
  });

/** Voids the Bill on screen. */
export const voidBill = (page: Page, reason: string) =>
  correct(page, { link: "Cancelar esta cuenta", step: "Cancelar cuenta", action: "Cancelar cuenta", done: "Cuenta cancelada", reason });
