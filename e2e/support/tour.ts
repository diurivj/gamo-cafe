import type { Page, Route } from "@playwright/test";

import { SESSION_COOKIE } from "../../app/shared/secret.ts";
import { expect, type TestFixtures } from "../fixtures";
import { openCorrection, openPay, payBill, payInFull } from "./bill";
import { type Cafe, LONG_CUSTOMER, LONG_ITEM } from "./cafe";
import { abonar } from "./customer";
import { recordCount, reviewCount, typeCount } from "./count";
import { holdSubmissions } from "./held";
import { INTERNAL_USE, typeInternalUse } from "./internal-use";
import { destinations } from "./navigate";
import { leaveOpen, pay, review, select, selection } from "./sell";
import { adjust, typeAdjustment } from "./stock";

/**
 * Every screen of the app in each state a User meets it in (UI redesign §7):
 * a list of stops, each of which opens one state and leaves it on screen.
 * `e2e/accessibility.spec.ts` scans each stop and `e2e/layout.spec.ts`
 * measures it; neither is about what a screen records, which its own spec
 * holds.
 *
 *     for (const stop of adminStops(cafe)) {
 *       const leave = await stop.open(page, { query });
 *       // ...look at the screen...
 *       await leave?.();
 *     }
 *
 * A stop starts from an address, so it does not depend on the one before. The
 * stops that record something come after the ones that read what the cafe
 * holds, and none takes away what a later one needs. A stop that holds or
 * fails a request answers the function that lets go of it.
 *
 * Not here: the second page of a list (`e2e/load-more.spec.ts` builds the
 * rows that takes) and the results each screen's own spec ends on.
 */
export interface Stop {
  readonly name: string;
  readonly open: (page: Page, tools: Pick<TestFixtures, "query">) => Promise<void | (() => Promise<void>)>;
}

const title = (page: Page, name: string | RegExp) => page.getByRole("heading", { name, level: 1 });

/** A stop that is an address and the heading it shows. */
const at = (name: string, path: string, heading: string | RegExp): Stop => ({
  name,
  open: async (page) => {
    await page.goto(path);
    await expect(title(page, heading)).toBeVisible();
  },
});

/** A stop reached by doing something on an address. */
const after = (name: string, path: string, then: Stop["open"]): Stop => ({
  name,
  open: async (page, tools) => {
    await page.goto(path);
    return then(page, tools);
  },
});

const dropped = (route: Route) => route.abort("connectionfailed");

/** Fails every request to `url` until the stop is left: the screen then says it does not know. */
async function withoutAnswer(page: Page, url: string) {
  await page.route(url, dropped);
  return () => page.unroute(url, dropped);
}

const coffee = "Café de olla";

/** What nobody needs to be signed in for. */
export const signedOutStops: ReadonlyArray<Stop> = [
  at("Entrar", "/entrar", "Entrar"),
  after("Entrar: a code that is refused", "/entrar", async (page) => {
    await page.getByLabel("Código de acceso").fill("ZZZZ2222");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert")).toContainText("Ese código no es válido");
  }),
  after("Entrar: a session that ended", "/entrar", async (page) => {
    // A cookie no session answers to: the phone had one, and it ended.
    await page.context().addCookies([
      { name: SESSION_COOKIE, value: "ended", url: page.url(), httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
    await page.goto("/");
    await expect(page.getByRole("status")).toContainText("Tu sesión terminó");
    return () => page.context().clearCookies();
  }),
  after("Entrar: too many refused codes", "/entrar", async (page, { query }) => {
    // The limit is ten refused codes in ten minutes, across the whole app.
    for (let n = 0; n < 10; n++) {
      await query("INSERT INTO sign_in_failures (id, at) VALUES (?, ?)", [crypto.randomUUID(), Date.now()]);
    }
    await page.getByLabel("Código de acceso").fill("ZZZZ2222");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert")).toContainText("Demasiados intentos");
  }),
  at("A path the app does not have, signed out", "/no-existe", "No encontramos esta página"),
];

/** Vender, for either role: its two steps and every way a sale ends. */
function sellStops(cafe: Cafe): ReadonlyArray<Stop> {
  const toReview = async (page: Page) => {
    await select(page, [[coffee, 2], LONG_ITEM]);
    await review(page);
  };
  return [
    at("Vender: nothing chosen", "/", "Vender"),
    after("Vender: a selection", "/", async (page) => {
      await select(page, [[coffee, 2], LONG_ITEM, "Pan dulce"]);
    }),
    after("Vender: a search with no match", "/", async (page) => {
      await page.getByLabel("Buscar producto").fill("zzz");
    }),
    after("Vender: review, with the cash handed over", "/", async (page) => {
      await toReview(page);
      await page.getByLabel("Efectivo que te entregan (opcional)").fill("2000");
    }),
    after("Vender: review, a part that is more than the total", "/", async (page) => {
      await toReview(page);
      await page.getByRole("button", { name: "Cobrar solo una parte" }).click();
      await page.getByLabel("Monto a cobrar").fill("99999");
      await expect(page.getByRole("alert")).toBeVisible();
    }),
    after("Vender: review, by transfer, with the Customer's matches", "/", async (page) => {
      await toReview(page);
      await page.getByRole("radio", { name: "Transferencia" }).check();
      await page.getByLabel("Cliente", { exact: true }).pressSequentially("mar");
      await expect(page.getByRole("list", { name: "Coincidencias" })).toBeVisible();
    }),
    after("Vender: Vaciar asks first", "/", async (page) => {
      await select(page, [coffee]);
      await page.getByRole("button", { name: "Vaciar" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    }),
    after("Vender: leaving a selection asks first", "/", async (page) => {
      await select(page, [coffee]);
      await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      return async () => {
        await page.getByRole("alertdialog").getByRole("button", { name: "Salir y descartar" }).click();
      };
    }),
    after("Vender: a sale on its way", "/", async (page) => {
      await toReview(page);
      const held = await holdSubmissions(page);
      await page.getByRole("button", { name: /^Registrar pago de / }).click();
      await expect(title(page, /^Registrando pago/)).toBeVisible();
      return async () => {
        await held.releaseAll();
        await held.stop();
        await expect(title(page, "Pago registrado")).toBeVisible();
      };
    }),
    after("Vender: a sale of unknown outcome", "/", async (page) => {
      await toReview(page);
      const answer = await withoutAnswer(page, "**/vender/registrar");
      await page.getByRole("button", { name: /^Registrar pago de / }).click();
      await expect(title(page, "No sabemos si se registró")).toBeVisible();
      return async () => {
        await answer();
        await page.getByRole("button", { name: "Volver a intentar" }).click();
        await expect(title(page, "Pago registrado")).toBeVisible();
      };
    }),
    after("Vender: a refused sale", "/", async (page, { query }) => {
      await select(page, [coffee, "Galleta de nuez"]);
      await review(page);
      // Retired on another phone since Vender was opened.
      await query("UPDATE items SET retired_at = ? WHERE id = ?", [Date.now(), cafe.items.cookie.id]);
      await page.getByRole("button", { name: /^Registrar pago de / }).click();
      await expect(page.getByRole("alert")).toContainText("ya no está disponible");
      await query("UPDATE items SET retired_at = NULL WHERE id = ?", [cafe.items.cookie.id]);
      return async () => {
        await page.getByRole("button", { name: /^Registrar pago de / }).click();
        await expect(title(page, "Pago registrado")).toBeVisible();
      };
    }),
    after("Vender: Pago registrado, with its change", "/", async (page) => {
      await pay(page, { items: [coffee, LONG_ITEM], handed: "2000" });
    }),
    after("Vender: Pago registrado for a part, by transfer", "/", async (page) => {
      await pay(page, { items: [coffee], method: "Transferencia", amount: "10", note: "Mesa 9" });
    }),
    after("Vender: Cuenta abierta", "/", async (page) => {
      await leaveOpen(page, { items: [coffee], note: "Mesa 7" });
    }),
    after("Vender: adding to an Open Bill", `/?billId=${cafe.bills.open}`, async (page) => {
      await expect(page.getByRole("region", { name: "Cuenta destino" })).toBeVisible();
      await select(page, [coffee]);
      await review(page);
      await expect(selection(page)).toBeVisible();
    }),
  ];
}

/** Cuentas abiertas, a Bill and its Payment, and Clientes with Abonar: what either role may do. */
function collectStops(cafe: Cafe): ReadonlyArray<Stop> {
  const bill = (id: string) => `/cuentas/${id}`;
  const customer = `/clientes/${cafe.customers.ruiz.id}`;
  return [
    at("Cuentas abiertas", "/cuentas-abiertas", "Cuentas abiertas"),
    at("Cuentas abiertas: a search with no match", "/cuentas-abiertas?q=zzz", "Cuentas abiertas"),
    at("Cuenta: Open", bill(cafe.bills.open), "Cuenta"),
    at("Cuenta: Partially paid", bill(cafe.bills.partial), "Cuenta"),
    at("Cuenta: with a removed Line and a removed Payment", bill(cafe.bills.corrected), "Cuenta"),
    at("Cuenta: Cobrar", `${bill(cafe.bills.open)}?paso=cobrar`, "Cobrar"),
    after("Cuenta: Cobrar, a part that cannot be read", `${bill(cafe.bills.open)}?paso=cobrar`, async (page) => {
      await page.getByRole("button", { name: "Cobrar solo una parte" }).click();
      await page.getByLabel("Monto a cobrar").fill("");
      await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
      await expect(page.getByRole("alert")).toBeVisible();
    }),
    after("Cuenta: a Payment on its way", bill(cafe.bills.open), async (page) => {
      await openPay(page);
      await page.getByRole("button", { name: "Cobrar solo una parte" }).click();
      await page.getByLabel("Monto a cobrar").fill("1");
      const held = await holdSubmissions(page);
      await page.getByRole("button", { name: "Registrar pago de $1.00" }).click();
      await expect(title(page, /^Registrando pago/)).toBeVisible();
      return async () => {
        await held.releaseAll();
        await held.stop();
        await expect(title(page, "Pago registrado")).toBeVisible();
      };
    }),
    after("Cuenta: a Payment of unknown outcome, and leaving it asks first", bill(cafe.bills.open), async (page) => {
      await openPay(page);
      await page.getByRole("button", { name: "Cobrar solo una parte" }).click();
      await page.getByLabel("Monto a cobrar").fill("1");
      const answer = await withoutAnswer(page, "**/cuentas/*/cobrar");
      await page.getByRole("button", { name: "Registrar pago de $1.00" }).click();
      await expect(title(page, "No sabemos si se registró")).toBeVisible();
      await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      return async () => {
        await page.getByRole("alertdialog").getByRole("button", { name: "Quedarme aquí" }).click();
        await answer();
        await page.getByRole("button", { name: "Volver a intentar" }).click();
        await expect(title(page, "Pago registrado")).toBeVisible();
      };
    }),
    after("Cuenta: Pago registrado, with its change", bill(cafe.bills.open), async (page) => {
      await payBill(page, { amount: "1", handed: "20" });
    }),
    at("Clientes", "/clientes", "Clientes"),
    at("Clientes: matches", "/clientes?q=fam", "Clientes"),
    at("Clientes: a name nobody has, offered to be added", "/clientes?q=Zenaida", "Clientes"),
    at("Cliente: owes", customer, "Familia Ruiz"),
    at("Cliente: a long name", `/clientes/${cafe.customers.long.id}`, LONG_CUSTOMER),
    at("Cliente: Abonar", `${customer}?paso=abonar`, "Abonar"),
    after("Cliente: an Abonar of unknown outcome", `${customer}?paso=abonar`, async (page) => {
      await page.getByRole("button", { name: "Cobrar solo una parte" }).click();
      await page.getByLabel("Monto a cobrar").fill("1");
      const answer = await withoutAnswer(page, "**/clientes/*/abonar");
      await page.getByRole("button", { name: "Registrar abono de $1.00" }).click();
      await expect(title(page, "No sabemos si se registró")).toBeVisible();
      return async () => {
        await answer();
        await page.getByRole("button", { name: "Volver a intentar" }).click();
        await expect(title(page, "Abono registrado")).toBeVisible();
      };
    }),
    after("Cliente: Abono registrado", customer, async (page) => {
      await abonar(page, { amount: "1", method: "Transferencia" });
    }),
    // Last: it closes a Bill no later stop needs open.
    after("Inicio: a Bill paid and closed, with its change", bill(cafe.bills.corrected), async (page) => {
      await payInFull(page, { handed: "20" });
    }),
  ];
}

/** Consumo interno, for either role: its one step, and every way an Internal use ends. */
function internalUseStops(): ReadonlyArray<Stop> {
  const typed = (page: Page) => typeInternalUse(page, { item: "Galleta de nuez", units: "1", note: "Para la junta de la tarde" });
  const record = (page: Page) => page.getByRole("button", { name: "Registrar consumo interno de 1" }).click();
  return [
    at("Consumo interno", "/consumo-interno", "Consumo interno"),
    after("Consumo interno: nothing chosen, and its action tapped", "/consumo-interno", async (page) => {
      await page.getByRole("button", { name: "Registrar consumo interno" }).click();
      await expect(page.getByRole("alert").first()).toBeVisible();
    }),
    after("Consumo interno: typed, with what it will do", "/consumo-interno", async (page) => {
      await typed(page);
      await expect(page.getByText("No se cobra.")).toBeVisible();
    }),
    after("Consumo interno: on its way", "/consumo-interno", async (page) => {
      await typed(page);
      const held = await holdSubmissions(page);
      await record(page);
      await expect(title(page, /^Registrando consumo interno/)).toBeVisible();
      return async () => {
        await held.releaseAll();
        await held.stop();
        await expect(title(page, "Consumo interno registrado")).toBeVisible();
      };
    }),
    after("Consumo interno: of unknown outcome", "/consumo-interno", async (page) => {
      await typed(page);
      const answer = await withoutAnswer(page, INTERNAL_USE);
      await record(page);
      await expect(title(page, "No sabemos si se registró")).toBeVisible();
      return async () => {
        await answer();
        await page.getByRole("button", { name: "Volver a intentar" }).click();
        await expect(title(page, "Consumo interno registrado")).toBeVisible();
      };
    }),
    after("Consumo interno: registrado", "/consumo-interno", async (page) => {
      await typed(page);
      await record(page);
      await expect(title(page, "Consumo interno registrado")).toBeVisible();
    }),
  ];
}

/** An Admin's screens are four walks: each is a test's worth, and starts from a cafe of its own. */
export const ADMIN_WALKS = ["selling", "figuresAndStock", "catalogAndUsers", "billsAndCustomers"] as const;

/** Everything an Admin can open, in every state the cafe gives it, by walk. */
export function adminStops(cafe: Cafe): Readonly<Record<(typeof ADMIN_WALKS)[number], ReadonlyArray<Stop>>> {
  const bill = (id: string) => `/cuentas/${id}`;
  const partial = bill(cafe.bills.partial);
  const selling = [at("Inicio", "/inicio", "Hola, Ana"), at("Más", "/mas", "Más"), ...sellStops(cafe)];
  const figuresAndStock: ReadonlyArray<Stop> = [
    at("Mi día", "/mi-dia", "Mi día"),
    at("Día", "/dia", "Día"),
    after("Día: every part open", "/dia", async (page) => {
      for (const part of await page.getByRole("main").locator("summary").all()) await part.click();
    }),
    at("Día: a range that cannot be", "/dia?desde=2026-10-09&hasta=2026-10-01", "Día"),
    at("Cuentas", "/cuentas", "Cuentas"),
    at("Cuentas: filtered to nothing", "/cuentas?dia=2001-01-01", "Cuentas"),
    at("Por cobrar", "/por-cobrar", "Por cobrar"),
    at("Inventario", "/inventario", "Inventario"),
    after("Inventario: a search with no match", "/inventario", async (page) => {
      await page.getByLabel("Buscar producto").fill("zzz");
    }),
    at("Inventario: Registrar entrada", "/inventario?paso=ajustar", /^Registrar /),
    after("Inventario: an Adjustment that would leave Stock below zero", "/inventario?paso=ajustar", async (page) => {
      await typeAdjustment(page, { item: "Pan dulce", reason: "Merma", units: "2", note: "Se cayó la charola" });
    }),
    after("Inventario: an Adjustment with nothing typed", "/inventario?paso=ajustar", async (page) => {
      await page.getByRole("button", { name: /^Registrar/ }).click();
      await expect(page.getByRole("alert").first()).toBeVisible();
    }),
    at("Inventario: Ajustes recientes", "/inventario?paso=ajustes", "Ajustes recientes"),
    at("Inventario: Cancelar ajuste", `/inventario?paso=cancelar&ajuste=${cafe.adjustments.standing}`, "Cancelar ajuste"),
    at("Inventario: an Adjustment already cancelled", `/inventario?paso=cancelar&ajuste=${cafe.adjustments.cancelled}`, "Cancelar ajuste"),
    at("Conteo", "/inventario/conteo", "Conteo"),
    after("Conteo: a field that cannot be read", "/inventario/conteo", async (page) => {
      await typeCount(page, { [coffee]: "muchos", "Agua mineral": "3" });
      await page.getByRole("button", { name: "Revisar conteo" }).click();
    }),
    after("Conteo: the review", "/inventario/conteo", async (page) => {
      await typeCount(page, { [coffee]: "1", "Agua mineral": "99", "Galleta de nuez": "3" }, "Conteo de prueba");
      await reviewCount(page);
    }),
    at("Diferencias", "/diferencias", "Diferencias"),
    at("Historial", "/historial", "Historial"),
    ...internalUseStops(),
    after("Inventario: an Adjustment on its way", "/inventario?paso=ajustar", async (page) => {
      await typeAdjustment(page, { item: "Galleta de nuez", units: "2" });
      const held = await holdSubmissions(page);
      await page.getByRole("button", { name: "Registrar entrada de 2" }).click();
      await expect(title(page, /^Registrando entrada/)).toBeVisible();
      return async () => {
        await held.releaseAll();
        await held.stop();
        await expect(title(page, "Entrada registrada")).toBeVisible();
      };
    }),
    after("Inventario: an Adjustment of unknown outcome", "/inventario?paso=ajustar", async (page) => {
      await typeAdjustment(page, { item: "Galleta de nuez", units: "2" });
      const answer = await withoutAnswer(page, "**/inventario/ajustar");
      await page.getByRole("button", { name: "Registrar entrada de 2" }).click();
      await expect(title(page, "No sabemos si se registró")).toBeVisible();
      return async () => {
        await answer();
        await page.getByRole("button", { name: "Volver a intentar" }).click();
        await expect(title(page, "Entrada registrada")).toBeVisible();
      };
    }),
    after("Conteo: a Count of unknown outcome", "/inventario/conteo", async (page) => {
      await typeCount(page, { "Galleta de nuez": "7" });
      await reviewCount(page);
      const answer = await withoutAnswer(page, "**/inventario/conteo/registrar");
      await page.getByRole("button", { name: /^Registrar conteo de / }).click();
      await expect(title(page, "No sabemos si se registró")).toBeVisible();
      return async () => {
        await answer();
        await page.getByRole("button", { name: "Volver a intentar" }).click();
        await expect(title(page, "Conteo registrado")).toBeVisible();
      };
    }),
    after("Inventario: Entrada registrada", "/inventario", async (page) => {
      await adjust(page, { item: "Agua mineral", units: "12" });
    }),
    after("Conteo: Conteo registrado", "/inventario/conteo", async (page) => {
      await typeCount(page, { [coffee]: "1", "Galleta de nuez": "5" });
      await reviewCount(page);
      await recordCount(page);
    }),
  ];
  const catalogAndUsers: ReadonlyArray<Stop> = [
    at("Productos", "/productos", "Productos"),
    at("Productos: Agregar producto", "/productos?paso=nuevo", "Agregar producto"),
    after("Productos: a name that is taken", "/productos?paso=nuevo", async (page) => {
      await page.getByLabel("Nombre", { exact: true }).fill(coffee);
      await page.getByLabel("Precio", { exact: true }).fill("10");
      await page.getByRole("button", { name: "Agregar producto" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
    }),
    at("Productos: Categorías", "/productos?paso=categorias", "Categorías"),
    at("Productos: a Category that still sells Items", `/productos?paso=categoria&id=${cafe.categories.drinks.id}`, "Bebidas"),
    at("Producto", `/productos/${cafe.items.water.id}`, "Agua mineral"),
    at("Producto: a long name, not stock-tracked", `/productos/${cafe.items.juice.id}`, LONG_ITEM),
    at("Producto: retired", `/productos/${cafe.items.retired.id}`, "Galleta de avena"),
    at("Usuarios", "/usuarios", "Usuarios"),
    at("Usuarios: Agregar usuario", "/usuarios?paso=nuevo", "Agregar usuario"),
    at("Usuarios: a Worker", `/usuarios?paso=usuario&id=${cafe.beto.id}`, "Beto"),
    at("Usuarios: the only Admin, themselves", `/usuarios?paso=usuario&id=${cafe.ana.id}`, "Ana"),
    after("Usuarios: a new code", `/usuarios?paso=usuario&id=${cafe.beto.id}`, async (page) => {
      await page.getByRole("button", { name: "Dar código nuevo" }).click();
      await expect(page.locator("output")).toBeVisible();
    }),
    after("Usuarios: a name that is taken", "/usuarios?paso=nuevo", async (page) => {
      await page.getByLabel("Nombre", { exact: true }).fill("Beto");
      await page.getByRole("button", { name: "Agregar y dar código" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
    }),
    at("A record that is not there", "/cuentas/no-existe", "No encontramos esta página"),
    at("A path the app does not have", "/no-existe", "No encontramos esta página"),
    {
      name: "A screen that failed to load",
      open: async (page) => {
        await page.goto("/mas");
        const answer = await withoutAnswer(page, "**/dia.data*");
        await destinations(page).getByRole("link", { name: "Día", exact: true }).click();
        await expect(title(page, "Algo salió mal")).toBeVisible();
        return answer;
      },
    },
  ];
  const billsAndCustomers: ReadonlyArray<Stop> = [
    ...collectStops(cafe),
    at("Cuenta: Paid", bill(cafe.bills.paid), "Cuenta"),
    at("Cuenta: Voided", bill(cafe.bills.voided), "Cuenta"),
    at("Cliente: retired", `/clientes/${cafe.customers.retired.id}`, "Don Pepe"),
    after("Cuenta: Quitar producto", bill(cafe.bills.open), async (page) => {
      await openCorrection(page, "Quitar 1 × Agua mineral", "Quitar producto");
    }),
    after("Cuenta: Quitar producto, which its Payments stand in the way of", partial, async (page) => {
      await openCorrection(page, `Quitar 1 × ${coffee}`, "Quitar producto");
    }),
    after("Cuenta: Quitar pago, with its reason missing", partial, async (page) => {
      await openCorrection(page, "Quitar pago de $10.00", "Quitar pago");
      await page.getByRole("button", { name: "Quitar pago de $10.00", exact: true }).click();
      await expect(page.getByRole("alert")).toHaveText("Escribe el motivo.");
    }),
    at("Cuenta: Cancelar cuenta", `${partial}?paso=cancelar-cuenta`, "Cancelar cuenta"),
    after("Cuenta: a correction on its way", partial, async (page) => {
      await openCorrection(page, "Quitar pago de $10.00", "Quitar pago");
      await page.getByLabel("Motivo").fill("Se cobró de más");
      const held = await holdSubmissions(page);
      await page.getByRole("button", { name: "Quitar pago de $10.00", exact: true }).click();
      await expect(title(page, /^Quitando/)).toBeVisible();
      return async () => {
        await held.releaseAll();
        await held.stop();
        await expect(title(page, "Pago quitado")).toBeVisible();
      };
    }),
  ];
  return { selling, figuresAndStock, catalogAndUsers, billsAndCustomers };
}

/** Everything a Worker can open, and what answers when they open more. */
export function workerStops(cafe: Cafe): ReadonlyArray<Stop> {
  return [
    at("Inicio", "/inicio", "Hola, Beto"),
    at("Más", "/mas", "Más"),
    at("Mi día", "/mi-dia", "Mi día"),
    ...sellStops(cafe),
    ...collectStops(cafe),
    ...internalUseStops(),
    at("A screen that is an Admin's", "/dia", "No tienes acceso a esta página"),
    at("A Bill that is no longer Open", `/cuentas/${cafe.bills.paid}`, "Esta cuenta ya no está abierta"),
    after("Cuenta: a Payment for a Bill another phone closed", `/cuentas/${cafe.bills.partial}?paso=cobrar`, async (page, { query }) => {
      await expect(title(page, "Cobrar")).toBeVisible();
      // What another phone's Payment leaves on the Bill: its projections and a new revision.
      await query("UPDATE bills SET paid = total, state = 'paid', revision = revision + 1 WHERE id = ?", [cafe.bills.partial]);
      await page.getByRole("button", { name: /^Registrar pago de / }).click();
      await expect(title(page, "No se registró el pago")).toBeVisible();
    }),
  ];
}

/** What a Worker finds in an app nobody has used yet. */
export const emptyWorkerStops: ReadonlyArray<Stop> = [
  at("Inicio, with nothing yet, as a Worker", "/inicio", /^Hola/),
  at("Vender, without a menu, as a Worker", "/", "Vender"),
  at("Cuentas abiertas, with none, as a Worker", "/cuentas-abiertas", "Cuentas abiertas"),
  at("Clientes, with none, as a Worker", "/clientes", "Clientes"),
  at("Mi día, with nothing, as a Worker", "/mi-dia", "Mi día"),
  at("Consumo interno, with no Item, as a Worker", "/consumo-interno", "Consumo interno"),
];

/** The lists and figures of an app nobody has used yet, as its first Admin finds them. */
export const emptyStops: ReadonlyArray<Stop> = [
  at("Inicio, with nothing yet", "/inicio", /^Hola/),
  at("Vender, without a menu", "/", "Vender"),
  at("Cuentas abiertas, with none", "/cuentas-abiertas", "Cuentas abiertas"),
  at("Cuentas, with none", "/cuentas", "Cuentas"),
  at("Clientes, with none", "/clientes", "Clientes"),
  at("Mi día, with nothing", "/mi-dia", "Mi día"),
  at("Día, with nothing", "/dia", "Día"),
  at("Por cobrar, with nothing owed", "/por-cobrar", "Por cobrar"),
  at("Inventario, with no Item", "/inventario", "Inventario"),
  at("Inventario: Ajustes recientes, with none", "/inventario?paso=ajustes", "Ajustes recientes"),
  at("Conteo, with no Item", "/inventario/conteo", "Conteo"),
  at("Diferencias, with no Count", "/diferencias", "Diferencias"),
  at("Historial, with nothing", "/historial", "Historial"),
  at("Productos, with no Item", "/productos", "Productos"),
  at("Productos: Categorías, with none", "/productos?paso=categorias", "Categorías"),
  at("Usuarios, with nobody else", "/usuarios", "Usuarios"),
];
