import type { Page } from "@playwright/test";

import { expect } from "../fixtures";
import { type BillPayment, typePayment } from "./bill";

/**
 * A Customer's page as a User drives it (UI redesign §5.3): what they owe, the
 * step that takes one handover across their Open Bills, and its confirmed
 * result, which stays until the User goes on.
 *
 *     await page.goto(`/clientes/${ruiz.id}`);
 *     await abonar(page, { amount: "60.00", method: "Transferencia" });   // ends on "Abono registrado"
 *     await seeCustomer(page, "Familia Ruiz");                             // back on the Customer, read again
 */

const title = (page: Page, name: string) => page.getByRole("heading", { name, level: 1 });

/** What the Customer owes, as their page leads with it. */
export const owed = (page: Page) => page.getByRole("region", { name: "Resumen" });

/** The Customer's Open Bills, oldest first. */
export const openBills = (page: Page) => page.getByRole("list", { name: "Cuentas abiertas" }).getByRole("listitem");

/** The Customer's handovers, newest first. */
export const handovers = (page: Page) => page.getByRole("list", { name: "Abonos" }).getByRole("listitem");

/** From the Customer to the step that takes a handover. */
export async function openAbonar(page: Page) {
  await page.getByRole("link", { name: "Abonar", exact: true }).click();
  await expect(title(page, "Abonar")).toBeVisible();
}

/** A whole handover from the Customer on screen: everything they owe in cash unless told otherwise. */
export async function abonar(page: Page, payment: BillPayment = {}) {
  await openAbonar(page);
  await typePayment(page, payment);
  await page.getByRole("button", { name: /^Registrar abono de / }).click();
  await expect(title(page, "Abono registrado")).toBeVisible();
}

/** From a confirmed handover back to the Customer, read again. */
export async function seeCustomer(page: Page, name: string) {
  await page.getByRole("button", { name: "Ver cliente" }).click();
  await expect(title(page, name)).toBeVisible();
}
