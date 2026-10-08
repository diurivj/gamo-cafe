import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import * as build from "virtual:react-router/server-build";

import { getBill, recordSelection, takePayment } from "~/backend/bills";
import { voidBill } from "~/backend/corrections";
import type { NewItem } from "~/backend/catalog";
import { CurrentUser, type Role } from "~/backend/current-user";
import type { Db } from "~/backend/db";

import { appFetch, as, landing, seedUser, type SignedIn, signedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { seedCustomer } from "./support/customers";
import { runTest } from "./support/effect";
import { correctionPath, recordPayment, recordSale, saleForm } from "./support/sales";

/**
 * Spec §4.1 and §10.6: the server enforces the permissions matrix in every
 * loader and action, and hiding a control is not enforcement.
 *
 * This file is the one place the app's routes are *classified*. The route
 * manifest drives the sweep, and the table below has an entry for every route
 * the manifest holds: add a route to app/routes.ts without classifying it here
 * and "every route is classified" fails. Each entry says what a signed-out
 * visitor, a Worker and an Admin get from the route's loader and action, so a
 * gate that is dropped or a route that becomes public is a test failure.
 *
 * The §4.1 rows at the bottom walk every cell of the matrix with a real
 * request: a Worker must be refused 403 what the matrix reserves for Admins,
 * and an Admin (or Worker, where the row says so) must get through.
 */

// ---------------------------------------------------------------------------
// The route manifest, the same sweep tests/route-guard.test.ts makes.
// ---------------------------------------------------------------------------

type Routes = typeof build.routes;
type RouteEntry = NonNullable<Routes[string]>;

/** The URL path of a route, with `x` standing in for each parameter. */
function pathOf(route: RouteEntry, routes: Routes): string {
  const segments: string[] = [];
  for (let at: RouteEntry | undefined = route; at; at = at.parentId ? routes[at.parentId] : undefined) {
    if (at.path) segments.unshift(at.path);
  }
  const path = segments
    .join("/")
    .split("/")
    .map((segment) => (segment.startsWith(":") || segment === "*" ? "x" : segment.replace(/\?$/, "")))
    .join("/");
  return `/${path}`;
}

const manifestPaths = [
  ...new Set(
    Object.values(build.routes)
      .filter((route) => route !== undefined)
      .map((route) => pathOf(route, build.routes)),
  ),
].sort();

// ---------------------------------------------------------------------------
// The classification table: every route, and what each visitor gets.
// ---------------------------------------------------------------------------

interface RouteRule {
  /** What this route is, in a few words. */
  readonly about: string;
  /**
   * What a request without a session gets. Every route redirects to Entrar
   * (§10.1) except the exemptions, each of which must also be in
   * PUBLIC_PATHS in app/session.server.ts and in tests/route-guard.test.ts.
   */
  readonly signedOut: "redirect" | "public";
  /** GET as a signed-in Worker, then as a signed-in Admin. */
  readonly get: { readonly worker: number; readonly admin: number };
  /**
   * POST carrying a body that names no known form. A route without an action
   * is answered 405 by the router.
   */
  readonly post?: { readonly worker: number; readonly admin: number } | undefined;
}

const routes: Readonly<Record<string, RouteRule>> = {
  "/": {
    about: "Vender: choose the Items of a sale and review it",
    signedOut: "redirect",
    get: { worker: 200, admin: 200 },
  },
  "/vender/registrar": {
    about: "Where Vender sends a sale: leave it open or pay it",
    signedOut: "redirect",
    // An action and no loader: there is nothing to read here.
    get: { worker: 400, admin: 400 },
    post: { worker: 400, admin: 400 },
  },
  "/entrar": {
    about: "Entrar: the one public screen, and the code exchange",
    signedOut: "public",
    // A signed-in visitor is sent home, from the loader on GET and after the
    // action on POST.
    get: { worker: 302, admin: 302 },
    post: { worker: 302, admin: 302 },
  },
  "/salir": {
    about: "Salir: ends this phone's session",
    signedOut: "redirect",
    get: { worker: 302, admin: 302 },
    post: { worker: 302, admin: 302 },
  },
  "/healthz": {
    about: "Liveness for the deploy check; holds nothing of the app's",
    signedOut: "public",
    get: { worker: 200, admin: 200 },
  },
  "/clientes/selector": {
    about: "The Customer picker's search and add",
    signedOut: "redirect",
    get: { worker: 200, admin: 200 },
    post: { worker: 400, admin: 400 },
  },
  "/cuentas-abiertas": {
    about: "Cuentas abiertas: every Open Bill",
    signedOut: "redirect",
    get: { worker: 200, admin: 200 },
  },
  "/cuentas": {
    about: "Cuentas: every Bill, Admin only",
    signedOut: "redirect",
    get: { worker: 403, admin: 200 },
  },
  "/cuentas/x": {
    about: "Cuenta: one Bill and its Customer and note; unknown id",
    signedOut: "redirect",
    get: { worker: 404, admin: 404 },
    post: { worker: 400, admin: 400 },
  },
  "/cuentas/x/cobrar": {
    about: "Where Cuenta sends a Payment",
    signedOut: "redirect",
    // An action and no loader: there is nothing to read here.
    get: { worker: 400, admin: 400 },
    post: { worker: 400, admin: 400 },
  },
  "/cuentas/x/corregir": {
    about: "Where Cuenta sends a correction",
    signedOut: "redirect",
    // An action and no loader: there is nothing to read here.
    get: { worker: 400, admin: 400 },
    post: { worker: 400, admin: 400 },
  },
  "/clientes": {
    about: "Clientes: search and add",
    signedOut: "redirect",
    get: { worker: 200, admin: 200 },
    post: { worker: 400, admin: 400 },
  },
  "/clientes/x": {
    about: "Un Cliente: Open Bills, Abonar, Admin management; unknown id",
    signedOut: "redirect",
    get: { worker: 404, admin: 404 },
    post: { worker: 400, admin: 400 },
  },
  "/mi-dia": {
    about: "Mi día: the signed-in User's own activity",
    signedOut: "redirect",
    get: { worker: 200, admin: 200 },
  },
  "/dia": {
    about: "Día: the figures of a date or range, Admin only",
    signedOut: "redirect",
    get: { worker: 403, admin: 200 },
  },
  "/diferencias": {
    about: "Diferencias: the Counts recorded, Admin only",
    signedOut: "redirect",
    get: { worker: 403, admin: 200 },
  },
  "/historial": {
    about: "Historial: corrections and Adjustments, Admin only",
    signedOut: "redirect",
    get: { worker: 403, admin: 200 },
  },
  "/inventario": {
    about: "Inventario: Stock, Minimums, Adjustments, Admin only",
    signedOut: "redirect",
    get: { worker: 403, admin: 200 },
    post: { worker: 403, admin: 400 },
  },
  "/inventario/conteo": {
    about: "Conteo: the entry and review steps, Admin only",
    signedOut: "redirect",
    get: { worker: 403, admin: 200 },
    post: { worker: 403, admin: 400 },
  },
  "/por-cobrar": {
    about: "Por cobrar: what Customers owe, Admin only",
    signedOut: "redirect",
    get: { worker: 403, admin: 200 },
  },
  "/productos": {
    about: "Productos: Items and Categories, Admin only",
    signedOut: "redirect",
    get: { worker: 403, admin: 200 },
    post: { worker: 403, admin: 400 },
  },
  "/productos/x": {
    about: "Un Producto: its form and retirement, Admin only",
    signedOut: "redirect",
    get: { worker: 403, admin: 404 },
    post: { worker: 403, admin: 400 },
  },
  "/usuarios": {
    about: "Usuarios: roles and sign-in codes, Admin only",
    signedOut: "redirect",
    get: { worker: 403, admin: 200 },
    post: { worker: 400, admin: 400 },
  },
  "/inicio": {
    about: "Inicio: the home screen's cards; tests/home.test.ts holds what each role's carry",
    signedOut: "redirect",
    get: { worker: 200, admin: 200 },
  },
  "/mas": {
    about: "Más: the role's remaining screens and the way out; tests/navigation.test.ts reads what each role gets",
    signedOut: "redirect",
    get: { worker: 200, admin: 200 },
  },
};

// ---------------------------------------------------------------------------
// The sweep. Every route the manifest holds, and nothing less.
// ---------------------------------------------------------------------------

const form = (fields: Record<string, string> = {}) => ({
  method: "POST",
  body: new URLSearchParams(fields),
});

let serial = 0;
/** A signed-in caller whose name no other test in this file has used. */
function caller(role: Role): Promise<SignedIn> {
  return signedIn(role, `${role === "admin" ? "Admin" : "Empleado"} ${++serial}`);
}

describe("the route classification", () => {
  it("covers every route the app has, and only those", () => {
    expect(Object.keys(routes).sort()).toEqual(manifestPaths);
  });

  const classified = Object.entries(routes).map(([path, rule]) => ({
    path,
    rule,
    title: `GET ${path} — ${rule.about}`,
  }));

  it.for(classified)(
    "$title",
    async ({ path, rule }) => {
      // Without a session: Entrar, or the way to it (§10.1).
      const signedOut = await appFetch(path);
      if (rule.signedOut === "public") {
        expect(signedOut.status, `${path} signed out`).not.toBe(302);
      } else {
        expect(signedOut.status, `${path} signed out`).toBe(302);
        expect(signedOut.headers.get("Location"), `${path} signed out`).toBe("/entrar");
      }

      const worker = await caller("worker");
      const asWorker = await worker.fetch(path);
      expect(asWorker.status, `${path} as a Worker`).toBe(rule.get.worker);

      const admin = await caller("admin");
      const asAdmin = await admin.fetch(path);
      expect(asAdmin.status, `${path} as an Admin`).toBe(rule.get.admin);
    },
  );

  it.for(classified)(
    "POST $path — $rule.about",
    async ({ path, rule }) => {
      // Without a session: Entrar, or the way to it (§10.1).
      const signedOut = await appFetch(path, form());
      if (rule.signedOut === "public") {
        expect(signedOut.status, `${path} signed out`).not.toBe(302);
      } else {
        expect(signedOut.status, `${path} signed out`).toBe(302);
        expect(signedOut.headers.get("Location"), `${path} signed out`).toBe("/entrar");
      }

      if (!rule.post) {
        // No action: the router refuses the method before any route runs.
        const worker = await caller("worker");
        expect((await worker.fetch(path, form())).status, `${path} as a Worker`).toBe(405);
        const admin = await caller("admin");
        expect((await admin.fetch(path, form())).status, `${path} as an Admin`).toBe(405);
        return;
      }

      // Fresh callers: POST /salir ends the session it is sent with.
      const worker = await caller("worker");
      expect((await worker.fetch(path, form())).status, `${path} as a Worker`).toBe(rule.post.worker);

      const admin = await caller("admin");
      expect((await admin.fetch(path, form())).status, `${path} as an Admin`).toBe(rule.post.admin);
    },
  );
});

// ---------------------------------------------------------------------------
// §4.1 row by row: every cell, against the running Worker.
// ---------------------------------------------------------------------------

type SeedAuthor = CurrentUser["Service"];

/**
 * Seeds through the real operations, as a fresh Admin. The operations and the
 * Worker share the local D1, so what the checks read from a response is what
 * the routes wrote. Checks seed under their own names: one file shares a D1.
 */
function seed<A, E>(program: (author: SeedAuthor) => Effect.Effect<A, E, Db>): Promise<A> {
  return runTest(
    Effect.gen(function* () {
      const author = yield* seedUser("admin", `Semilla ${++serial}`);
      return yield* program(author);
    }),
  );
}

const itemName = () => `Producto ${++serial}`;
const customerName = () => `Cliente ${++serial}`;

/** An Item the caller never manages: Items are an Admin's (spec §4.1). */
const seedItemFor = (options: Partial<Omit<NewItem, "name">> = {}, price = 1000) =>
  seed((author) => seedItem({ ...options, name: itemName(), price, by: author }));

/** A Customer, added by a seeded Worker; `who` only ever collects or manages. */
const seedCustomerFor = () => seed((author) => seedCustomer(customerName(), { by: author }));

/**
 * An Open Bill seeded through the operations: one Line per quantity given,
 * then an optional Payment. The seeded Admin authors every part of it, so a
 * Worker's permissions are never confused with the fixture's.
 */
function seedBill(options: {
  readonly itemId: string;
  readonly quantities?: ReadonlyArray<number>;
  readonly customerId?: string | null;
  readonly payment?: number;
  readonly note?: string | null;
}) {
  return seed((author) =>
    Effect.gen(function* () {
      const first = yield* recordSelection({
        items: [{ itemId: options.itemId, quantity: (options.quantities ?? [1])[0]! }],
        customerId: options.customerId ?? null,
        note: options.note ?? null,
      }).pipe(as(author));
      for (const quantity of (options.quantities ?? [1]).slice(1)) {
        yield* recordSelection({ items: [{ itemId: options.itemId, quantity }], billId: first.id }).pipe(as(author));
      }
      let bill = yield* getBill(first.id).pipe(as(author));
      if (options.payment !== undefined) {
        yield* takePayment({
          billId: first.id,
          amount: options.payment,
          method: "cash",
          expectedRevision: bill.revision,
        }).pipe(as(author));
        bill = yield* getBill(first.id).pipe(as(author));
      }
      return bill;
    }),
  );
}

/** The value of a hidden field, as a response renders it. */
function fieldOf(html: string, name: string): string {
  const found = new RegExp(`name="${name}" value="([^"]+)"`).exec(html);
  expect(found, `the response carries ${name}`).not.toBeNull();
  return found![1]!;
}

/**
 * A recorded form answers with a redirect (spec §3.4): this is the page it
 * lands on, which says what was recorded.
 */
async function landed(recorded: Response, who: SignedIn, label: string): Promise<Response> {
  expect(recorded.status, label).toBe(302);
  return landing(who, recorded);
}

interface MatrixRow {
  /** The §4.1 capability, in the spec's words. */
  readonly capability: string;
  readonly worker: "yes" | "no";
  readonly admin: "yes" | "no";
  /**
   * The status a refused cell answers with. 403 (the AdminOnly convention)
   * unless the operation refuses for a state that makes the rule visible, as
   * `BillHasPayment` does with its Spanish message.
   */
  readonly refusedWith?: number;
  /** Makes the capability's request as `who`, asserting what it did. */
  readonly check: (who: SignedIn, label: string) => Promise<Response>;
}

const rows: ReadonlyArray<MatrixRow> = [
  {
    capability: "Record a sale, and add Lines to any Open Bill",
    worker: "yes",
    admin: "yes",
    async check(who, label) {
      const item = await seedItemFor();
      const openElsewhere = await seedBill({ itemId: item.id });

      const sale = await recordSale(who, saleForm({ itemId: item.id }));
      expect(sale.response.status, label).toBe(200);
      expect(sale.sale, label).toMatchObject({ state: "open", total: 1000, canOpen: true });

      // Any User adds to any Open Bill, not only the one they opened.
      const added = await recordSale(who, {
        intent: "dejar-abierta",
        billId: openElsewhere.id,
        selection: JSON.stringify([{ itemId: item.id, quantity: 1 }]),
      });
      expect(added.sale, label).toMatchObject({ billId: openElsewhere.id, total: 2000 });
      return added.response;
    },
  },
  {
    capability: "Take a Payment on any Open Bill, or for any Customer",
    worker: "yes",
    admin: "yes",
    async check(who, label) {
      const item = await seedItemFor();
      const bill = await seedBill({ itemId: item.id, quantities: [2] });
      const customer = await seedCustomerFor();
      const theirs = await seedBill({ itemId: item.id, quantities: [2], customerId: customer.id });

      const onBill = await recordPayment(who, bill.id, {
        method: "cash",
        amount: "5.00",
        revision: String(bill.revision),
      });
      expect(onBill.response.status, label).toBe(200);
      expect(onBill.payment, label).toMatchObject({ amount: 500, owed: 1500, paid: false, canOpen: true });

      // For a Customer: one amount over their Open Bills, oldest first.
      const forCustomer = await who.fetch(
        `/clientes/${customer.id}`,
        form({
          intent: "abonar",
          method: "cash",
          amount: "5.00",
          bill: `${theirs.id}:${theirs.revision}`,
        }),
      );
      const forCustomerPage = await landed(forCustomer, who, label);
      expect(await forCustomerPage.text(), label).toContain("Abono de $5.00 registrado.");
      return forCustomer;
    },
  },
  {
    capability: "Add a Customer",
    worker: "yes",
    admin: "yes",
    async check(who, label) {
      const name = customerName();
      const added = await who.fetch("/clientes", form({ name }));
      expect(added.status, label).toBe(302);
      expect(added.headers.get("Location"), label).toMatch(/^\/clientes\//);

      // The picker's resource route adds one the same way, from inside a form.
      const fromPicker = await who.fetch("/clientes/selector", form({ name: customerName() }));
      expect(fromPicker.status, label).toBe(200);
      return fromPicker;
    },
  },
  {
    capability: "See every Open Bill, and what one Customer owes",
    worker: "yes",
    admin: "yes",
    async check(who, label) {
      const item = await seedItemFor();
      const customer = await seedCustomerFor();
      const bill = await seedBill({ itemId: item.id, customerId: customer.id });

      const list = await who.fetch("/cuentas-abiertas");
      expect(list.status, label).toBe(200);
      expect(await list.text(), label).toContain(customer.name);

      const page = await who.fetch(`/clientes/${customer.id}`);
      expect(page.status, label).toBe(200);
      const html = await page.text();
      expect(html, label).toContain("Debe $10.00");
      expect(html, label).toContain(`/cuentas/${bill.id}`);
      return page;
    },
  },
  {
    capability: "See own activity for today",
    worker: "yes",
    admin: "yes",
    async check(who, label) {
      // Today's records come through the Worker; the test clock cannot set the
      // real clock the Worker reads.
      const item = await seedItemFor();
      const sale = await recordSale(who, {
        intent: "cobrar",
        method: "cash",
        amount: "10.00",
        selection: JSON.stringify([{ itemId: item.id, quantity: 1 }]),
      });
      expect(sale.response.status, label).toBe(200);

      const mine = await who.fetch("/mi-dia");
      expect(mine.status, label).toBe(200);
      const html = await mine.text();
      expect(html, label).toContain(who.user.name);
      expect(html, label).toContain("$10.00");
      return mine;
    },
  },
  {
    capability: "Set or change a Bill's Customer or note, before any Payment",
    worker: "yes",
    admin: "yes",
    async check(who, label) {
      const item = await seedItemFor();
      const bill = await seedBill({ itemId: item.id });
      const note = `Nota antes ${++serial}`;

      const edited = await who.fetch(
        `/cuentas/${bill.id}`,
        form({ intent: "editar", note, customerId: "", revision: String(bill.revision) }),
      );
      const editedPage = await landed(edited, who, label);
      expect(await editedPage.text(), label).toContain(note);
      return edited;
    },
  },
  {
    capability: "Set or change a Bill's Customer or note, after a Payment",
    worker: "no",
    admin: "yes",
    // The operation refuses a Worker with `BillHasPayment`, whose message says
    // who may: the same rule, told on the form instead of on a 403 page.
    refusedWith: 400,
    async check(who, label) {
      const item = await seedItemFor();
      const bill = await seedBill({ itemId: item.id, quantities: [2], payment: 500 });
      const note = `Nota después ${++serial}`;

      if (who.user.role === "worker") {
        const refused = await who.fetch(
          `/cuentas/${bill.id}`,
          form({ intent: "editar", note, customerId: "", revision: String(bill.revision) }),
        );
        expect(refused.status, label).toBe(400);
        expect(await refused.text(), label).toContain("Solo un administrador puede cambiar el cliente o la nota");
        return refused;
      }

      const edited = await who.fetch(
        `/cuentas/${bill.id}`,
        form({ intent: "editar", note, customerId: "", revision: String(bill.revision) }),
      );
      const editedPage = await landed(edited, who, label);
      expect(await editedPage.text(), label).toContain(note);
      return edited;
    },
  },
  {
    capability: "Remove a Line from a Bill with no Payment",
    worker: "yes",
    admin: "yes",
    async check(who, label) {
      const item = await seedItemFor();
      const bill = await seedBill({ itemId: item.id, quantities: [1, 1] });
      const line = bill.lines[0]!;

      const removed = await who.fetch(
        correctionPath(bill.id),
        form({ intent: "quitar-linea", lineId: line.id, revision: String(bill.revision) }),
      );
      expect(await removed.clone().json(), label).toMatchObject({ correction: { total: 1000, owed: 1000 } });
      return removed;
    },
  },
  {
    capability: "Remove a Line from a Bill that has a Payment",
    worker: "no",
    admin: "yes",
    async check(who, label) {
      const item = await seedItemFor();
      const bill = await seedBill({ itemId: item.id, quantities: [1, 1], payment: 500 });
      const line = bill.lines[0]!;
      const correction = { intent: "quitar-linea", lineId: line.id, revision: String(bill.revision) };

      if (who.user.role === "worker") return who.fetch(correctionPath(bill.id), form(correction));

      // An Admin must give a reason, and only then is the Line removed.
      const withoutReason = await who.fetch(correctionPath(bill.id), form(correction));
      expect(withoutReason.status, label).toBe(400);
      expect(await withoutReason.json(), label).toEqual({ error: "Escribe el motivo." });

      const removed = await who.fetch(
        correctionPath(bill.id),
        form({ ...correction, reason: "Se registró de más" }),
      );
      expect(await removed.clone().json(), label).toMatchObject({ correction: { total: 1000, owed: 500 } });
      return removed;
    },
  },
  {
    capability: "Remove a Payment",
    worker: "no",
    admin: "yes",
    async check(who, label) {
      const item = await seedItemFor();
      const bill = await seedBill({ itemId: item.id, quantities: [2], payment: 500 });
      const payment = bill.payments[0]!;
      const correction = { intent: "quitar-pago", paymentId: payment.id, revision: String(bill.revision) };

      if (who.user.role === "worker") return who.fetch(correctionPath(bill.id), form(correction));

      const withoutReason = await who.fetch(correctionPath(bill.id), form(correction));
      expect(withoutReason.status, label).toBe(400);
      expect(await withoutReason.json(), label).toEqual({ error: "Escribe el motivo." });

      const removed = await who.fetch(
        correctionPath(bill.id),
        form({ ...correction, reason: "Se cobró por error" }),
      );
      expect(await removed.clone().json(), label).toMatchObject({ correction: { total: 2000, owed: 2000 } });
      return removed;
    },
  },
  {
    capability: "Void a Bill",
    worker: "no",
    admin: "yes",
    async check(who, label) {
      const item = await seedItemFor();
      const bill = await seedBill({ itemId: item.id });
      const correction = { intent: "cancelar-cuenta", revision: String(bill.revision) };

      if (who.user.role === "worker") return who.fetch(correctionPath(bill.id), form(correction));

      const withoutReason = await who.fetch(correctionPath(bill.id), form(correction));
      expect(withoutReason.status, label).toBe(400);
      expect(await withoutReason.json(), label).toEqual({ error: "Escribe el motivo." });

      const voided = await who.fetch(correctionPath(bill.id), form({ ...correction, reason: "Era una prueba" }));
      expect(await voided.clone().json(), label).toMatchObject({ correction: { canOpen: true } });
      return voided;
    },
  },
  {
    capability: "See Paid and Voided Bills",
    worker: "no",
    admin: "yes",
    async check(who, label) {
      const item = await seedItemFor();
      const paid = await seedBill({ itemId: item.id, payment: 1000 });
      const toVoid = await seedBill({ itemId: item.id });
      const voided = await seed((author) =>
        voidBill({ billId: toVoid.id, reason: "Era una prueba", expectedRevision: toVoid.revision }).pipe(
          Effect.as(toVoid),
          as(author),
        ),
      );

      const seenPaid = await who.fetch(`/cuentas/${paid.id}`);
      const seenVoided = await who.fetch(`/cuentas/${voided.id}`);

      if (who.user.role === "worker") {
        expect(seenPaid.status, label).toBe(403);
        expect(seenVoided.status, label).toBe(403);
        return seenVoided;
      }

      expect(seenPaid.status, label).toBe(200);
      expect(await seenPaid.text(), label).toContain("Pagada");
      expect(seenVoided.status, label).toBe(200);
      expect(await seenVoided.text(), label).toContain("Cancelada");
      return seenVoided;
    },
  },
  {
    capability: "See the Day, Bills, Owed, Discrepancies and History lists",
    worker: "no",
    admin: "yes",
    async check(who, label) {
      const lists = ["/dia", "/cuentas", "/por-cobrar", "/diferencias", "/historial"];
      const expected = who.user.role === "worker" ? 403 : 200;
      let last: Response | undefined;
      for (const path of lists) {
        const response = await who.fetch(path);
        expect(response.status, `${label} · ${path}`).toBe(expected);
        last = response;
      }
      return last!;
    },
  },
  {
    capability: "See Stock, Minimums, Adjustments and Counts",
    worker: "no",
    admin: "yes",
    async check(who, label) {
      const item = await seedItemFor({ minimum: 2, startingStock: 3 });

      if (who.user.role === "worker") {
        const stock = await who.fetch("/inventario");
        expect(stock.status, label).toBe(403);
        const counts = await who.fetch("/inventario/conteo");
        expect(counts.status, label).toBe(403);
        return counts;
      }

      const stock = await who.fetch("/inventario");
      expect(stock.status, label).toBe(200);
      const stockHtml = await stock.text();
      expect(stockHtml, label).toContain(item.name);
      expect(stockHtml, label).toContain("Existencias: 3 · Mínimo: 2");
      expect(stockHtml, label).toContain("Entrada +3");

      const counts = await who.fetch("/inventario/conteo");
      expect(counts.status, label).toBe(200);
      expect(await counts.text(), label).toContain(item.name);
      return counts;
    },
  },
  {
    capability: "Record or cancel an Adjustment, and record a Count",
    worker: "no",
    admin: "yes",
    async check(who, label) {
      const item = await seedItemFor({ startingStock: 0 });
      const adjustment = { intent: "record-adjustment", itemId: item.id, reason: "restock", units: "5" };

      if (who.user.role === "worker") {
        const recorded = await who.fetch("/inventario", form(adjustment));
        expect(recorded.status, label).toBe(403);
        const count = await who.fetch("/inventario/conteo", form({ intent: "review", [`units.${item.id}`]: "5" }));
        expect(count.status, label).toBe(403);
        return count;
      }

      const recorded = await who.fetch("/inventario", form(adjustment));
      const recordedPage = await landed(recorded, who, label);
      const recordedHtml = await recordedPage.text();
      expect(recordedHtml, label).toContain("Entrada +5");

      const adjustmentId = fieldOf(recordedHtml, "adjustmentId");
      const cancelled = await who.fetch(
        "/inventario",
        form({ intent: "cancel-adjustment", adjustmentId, reason: "Se contó dos veces" }),
      );
      const cancelledPage = await landed(cancelled, who, label);
      expect(await cancelledPage.text(), label).toContain("Cancelado: Se contó dos veces");

      const review = await who.fetch(
        "/inventario/conteo",
        form({ intent: "review", [`units.${item.id}`]: "7" }),
      );
      expect(review.status, label).toBe(200);
      expect(await review.text(), label).toContain("Revisión del conteo");

      const confirmed = await who.fetch(
        "/inventario/conteo",
        form({ intent: "confirm", [`units.${item.id}`]: "7" }),
      );
      expect(confirmed.status, label).toBe(302);
      expect(confirmed.headers.get("Location"), label).toBe("/diferencias");
      return confirmed;
    },
  },
  {
    capability: "Manage Items and Categories",
    worker: "no",
    admin: "yes",
    async check(who, label) {
      const item = await seedItemFor();

      if (who.user.role === "worker") {
        const category = await who.fetch("/productos", form({ intent: "add-category", name: itemName() }));
        expect(category.status, label).toBe(403);
        const retired = await who.fetch(`/productos/${item.id}`, form({ intent: "retire-item" }));
        expect(retired.status, label).toBe(403);
        return retired;
      }

      const name = `Categoría ${++serial}`;
      const category = await who.fetch("/productos", form({ intent: "add-category", name }));
      const categoryPage = await landed(category, who, label);
      expect(await categoryPage.text(), label).toContain(name);

      const retired = await who.fetch(`/productos/${item.id}`, form({ intent: "retire-item" }));
      const retiredPage = await landed(retired, who, label);
      expect(await retiredPage.text(), label).toContain("Retirado: no aparece en Vender.");
      return retired;
    },
  },
  {
    capability: "Rename, retire or restore a Customer",
    worker: "no",
    admin: "yes",
    async check(who, label) {
      const customer = await seedCustomerFor();

      if (who.user.role === "worker") {
        const edited = await who.fetch(
          `/clientes/${customer.id}`,
          form({ intent: "edit", name: customerName(), note: "" }),
        );
        expect(edited.status, label).toBe(403);
        const retired = await who.fetch(`/clientes/${customer.id}`, form({ intent: "retire" }));
        expect(retired.status, label).toBe(403);
        return retired;
      }

      const renamed = `Cliente ${++serial}`;
      const edited = await who.fetch(
        `/clientes/${customer.id}`,
        form({ intent: "edit", name: renamed, note: "" }),
      );
      const editedPage = await landed(edited, who, label);
      expect(await editedPage.text(), label).toContain(renamed);

      const retired = await who.fetch(`/clientes/${customer.id}`, form({ intent: "retire" }));
      const retiredPage = await landed(retired, who, label);
      expect(await retiredPage.text(), label).toContain("Ya no se puede elegir para cuentas nuevas.");

      const restored = await who.fetch(`/clientes/${customer.id}`, form({ intent: "restore" }));
      const restoredPage = await landed(restored, who, label);
      const restoredHtml = await restoredPage.text();
      expect(restoredHtml, label).toContain(renamed);
      expect(restoredHtml, label).not.toContain("Ya no se puede elegir para cuentas nuevas.");
      return restored;
    },
  },
  {
    capability: "Manage Users and issue sign-in codes",
    worker: "no",
    admin: "yes",
    async check(who, label) {
      if (who.user.role === "worker") {
        const added = await who.fetch("/usuarios", form({ intent: "add", name: `Usuario ${++serial}`, role: "worker" }));
        expect(added.status, label).toBe(403);
        const code = await who.fetch("/usuarios", form({ intent: "new-code", userId: who.user.id }));
        expect(code.status, label).toBe(403);
        return code;
      }

      const name = `Usuario ${++serial}`;
      const added = await who.fetch("/usuarios", form({ intent: "add", name, role: "worker" }));
      const addedPage = await landed(added, who, label);
      const html = await addedPage.text();
      expect(html, label).toContain("Código de acceso para");
      expect(html, label).toContain(name);
      return added;
    },
  },
];

const cell = (allowed: "yes" | "no", role: Role) =>
  `${role === "worker" ? "Worker" : "Admin"} ${allowed === "yes" ? "allowed" : "refused"}`;

describe("§4.1 the permissions matrix", () => {
  it.for(rows)("$capability", async (row) => {
    for (const role of ["worker", "admin"] as const) {
      const label = `${row.capability} — ${cell(row[role], role)}`;
      const who = await caller(role);
      const response = await row.check(who, label);
      if (row[role] === "no") expect(response.status, label).toBe(row.refusedWith ?? 403);
      else expect(response.status, label).not.toBe(403);
    }
  });

  it("classifies every row of the matrix, with both cells", () => {
    // The spec's wording, so the table above cannot quietly lose or rename a
    // row: each of §4.1's capabilities appears once, in order, with both
    // cells filled in.
    expect(rows.map((row) => row.capability)).toEqual([
      "Record a sale, and add Lines to any Open Bill",
      "Take a Payment on any Open Bill, or for any Customer",
      "Add a Customer",
      "See every Open Bill, and what one Customer owes",
      "See own activity for today",
      "Set or change a Bill's Customer or note, before any Payment",
      "Set or change a Bill's Customer or note, after a Payment",
      "Remove a Line from a Bill with no Payment",
      "Remove a Line from a Bill that has a Payment",
      "Remove a Payment",
      "Void a Bill",
      "See Paid and Voided Bills",
      "See the Day, Bills, Owed, Discrepancies and History lists",
      "See Stock, Minimums, Adjustments and Counts",
      "Record or cancel an Adjustment, and record a Count",
      "Manage Items and Categories",
      "Rename, retire or restore a Customer",
      "Manage Users and issue sign-in codes",
    ]);
    for (const row of rows) {
      expect(["yes", "no"]).toContain(row.worker);
      expect(["yes", "no"]).toContain(row.admin);
    }
  });
});
