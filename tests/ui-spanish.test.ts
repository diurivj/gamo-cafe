import { Effect } from "effect";
import { expect, it } from "vitest";

import { getBill, recordSelection, takePayment } from "~/backend/bills";
import { recordCount } from "~/backend/counts";
import { removeLine, voidBill } from "~/backend/corrections";
import { recordAdjustment } from "~/backend/inventory";

import { appFetch, as, signedIn, type SignedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { seedCustomer } from "./support/customers";
import { runTest } from "./support/effect";

/**
 * Spec §3.4: all visible text is Spanish, and money and dates use the `es-MX`
 * formats. This walks every screen the app has, with real records behind it,
 * and reads the text a person would see — nothing else, so class names, hidden
 * fields and the loader data embedded in the page cannot hide English words.
 *
 * It is also where the two error pages a Worker can meet are read: the 403 and
 * the 404, both of which must say something in Spanish rather than the
 * framework's own words.
 */

const form = (fields: Record<string, string> = {}) => ({
  method: "POST",
  body: new URLSearchParams(fields),
});

/**
 * The text a person sees: the scripts and tags taken out, entities decoded.
 * The route data React Router embeds lives in a script and is removed with it.
 */
function visibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

/** The labels a screen reader is given: they are shown to Users too. */
function spokenLabels(html: string): ReadonlyArray<string> {
  return [...html.matchAll(/(?:aria-label|placeholder|alt|title)="([^"]*)"/g)].map((match) => match[1]!);
}

/**
 * Words that never appear in Spanish. Deliberately narrow: every one is an
 * unmistakable English word a screen of this app could only show by accident.
 * "Cancel" does not match "Cancelar" or "Cancelada" because of the boundary.
 */
const english =
  /\b(sign in|sign out|signed in|log in|log out|loading|save|saved|cancel|delete|remove|removed|search|submit|back|next|previous|close|closed|page not found|not found|something went wrong|unauthorized|forbidden|internal server error|create|update|edit|add|name|role|note|price|minimum|inventory|count|history|users|bills|customers|items|stock|paid|owed|cash|transfer|payment|today|open|clear|change|settings)\b/gi;

/** An ISO date, which `es-MX` screens never show: they show formatDay. */
const isoDate = /\b\d{4}-\d{2}-\d{2}\b/;

function expectSpanish(html: string, what: string) {
  expect(html, `${what} is in Spanish`).toContain('<html lang="es-MX">');
  const text = visibleText(html);
  const found = text.match(english);
  expect(found, `${what}: no English, found «${found?.[0] ?? ""}»`).toBeNull();
  for (const label of spokenLabels(html)) {
    const inLabel = label.match(english);
    expect(inLabel, `${what}: «${label}» is English`).toBeNull();
  }
  expect(isoDate.test(text), `${what}: dates are es-MX, not ISO`).toBe(false);
}

/** Every page one phone shows, read as its User. */
async function expectScreensSpanish(who: SignedIn | undefined, paths: ReadonlyArray<string>) {
  for (const path of paths) {
    const response = who ? await who.fetch(path) : await appFetch(path);
    expect(response.status, `${path} answers a page`).toBe(200);
    expectSpanish(await response.text(), path);
  }
}

interface World {
  readonly item: { id: string; name: string };
  readonly customer: { id: string; name: string };
  readonly openBill: string;
  readonly paidBill: string;
  readonly voidedBill: string;
  readonly removedLineBill: string;
}

it("every screen a User can open is in Spanish, with es-MX money and dates", async () => {
  const ana = await signedIn("admin", "Ana Pantalla");
  const beto = await signedIn("worker", "Beto Pantalla");

  // A world with one of everything, through the real operations: two Items, a
  // Customer, an Open Bill, a Paid Bill, a Voided Bill, a removal for
  // Historial, an Adjustment and a Count for Inventario and Diferencias.
  const world: World = await runTest(
    Effect.gen(function* () {
      const item = yield* seedItem({
        name: "Café de olla",
        price: 2500,
        minimum: 3,
        startingStock: 10,
        by: ana.user,
      });
      const other = yield* seedItem({ name: "Agua de horchata", price: 1800, by: ana.user });
      const customer = yield* seedCustomer("Familia Pantalla", { by: beto.user });

      const open = yield* recordSelection({
        items: [{ itemId: item.id, quantity: 2 }],
        customerId: customer.id,
        note: "Paga el viernes",
      }).pipe(as(beto.user));

      const paid = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(beto.user));
      yield* takePayment({
        billId: paid.id,
        amount: 2500,
        method: "cash",
        expectedRevision: paid.revision,
      }).pipe(as(beto.user));

      const toVoid = yield* recordSelection({ items: [{ itemId: other.id, quantity: 1 }] }).pipe(as(beto.user));
      yield* voidBill({ billId: toVoid.id, reason: "Era una prueba", expectedRevision: toVoid.revision }).pipe(
        as(ana.user),
      );

      const removed = yield* recordSelection({
        items: [
          { itemId: item.id, quantity: 1 },
          { itemId: other.id, quantity: 1 },
        ],
      }).pipe(as(beto.user));
      const seen = yield* getBill(removed.id).pipe(as(beto.user));
      yield* removeLine({
        billId: removed.id,
        lineId: seen.lines[0]!.id,
        reason: null,
        expectedRevision: seen.revision,
      }).pipe(as(beto.user));

      yield* recordAdjustment({ itemId: item.id, reason: "waste", units: 2, note: "Se venció" }).pipe(
        as(ana.user),
      );
      yield* recordCount({ lines: [{ itemId: item.id, found: 8 }], note: "Conteo de prueba" }).pipe(as(ana.user));

      return {
        item: { id: item.id, name: item.name },
        customer: { id: customer.id, name: customer.name },
        openBill: open.id,
        paidBill: paid.id,
        voidedBill: toVoid.id,
        removedLineBill: removed.id,
      };
    }),
  );

  // Every screen an Admin's phone shows. The 404 is the boundary's own page.
  await expectScreensSpanish(ana, [
    "/",
    "/cuentas-abiertas",
    "/cuentas",
    `/cuentas/${world.openBill}`,
    `/cuentas/${world.paidBill}`,
    `/cuentas/${world.voidedBill}`,
    "/clientes",
    `/clientes/${world.customer.id}`,
    "/mi-dia",
    "/dia",
    "/diferencias",
    "/historial",
    "/inventario",
    "/inventario/conteo",
    "/por-cobrar",
    "/productos",
    `/productos/${world.item.id}`,
    "/usuarios",
  ]);

  // Every screen a Worker's phone shows.
  await expectScreensSpanish(beto, [
    "/",
    "/cuentas-abiertas",
    "/clientes",
    `/clientes/${world.customer.id}`,
    "/mi-dia",
    `/cuentas/${world.openBill}`,
  ]);

  // Entrar, for a phone with no session.
  await expectScreensSpanish(undefined, ["/entrar"]);

  // The pages the app answers with when something is not there or not allowed.
  const missing = await ana.fetch("/esta-pagina-no-existe");
  expect(missing.status).toBe(404);
  expectSpanish(await missing.text(), "404");

  const refused = await beto.fetch("/cuentas");
  expect(refused.status, "a Worker still gets 403").toBe(403);
  const refusedHtml = await refused.text();
  expectSpanish(refusedHtml, "403");
  expect(refusedHtml, "the 403 page says it in Spanish").toContain("No tienes acceso a esta página");

  // A hand-made submission that names no form: the boundary's page, in
  // Spanish too, so no failure mode shows raw framework words.
  const badForm = await ana.fetch(`/clientes/${world.customer.id}`, form({ intent: "no-existe" }));
  expect(badForm.status).toBe(400);
  expectSpanish(await badForm.text(), "400");

  const wrongMethod = await ana.fetch("/cuentas-abiertas", form());
  expect(wrongMethod.status).toBe(405);
  expectSpanish(await wrongMethod.text(), "405");
});
