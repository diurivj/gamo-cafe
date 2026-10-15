import { describe, expect, it } from "vitest";

import { destinationAt } from "~/shared/navigation";

import { appFetch, signedIn, type SignedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { runTest } from "./support/effect";
import { recordSale, saleForm } from "./support/sales";

/**
 * UI redesign §4 and §7: each role's four destinations, what Más holds for
 * them, and the pages the app answers with when a screen cannot be shown.
 * These read the pages the Worker serves; e2e/navigation.spec.ts walks them in
 * a browser.
 */

/** The text a person sees in a piece of a page. */
const textOf = (html: string) =>
  html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The links of a piece of a page, in order: where each leads and what it says. */
function linksIn(html: string): ReadonlyArray<{ readonly to: string; readonly label: string }> {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => ({
    to: match[1]!,
    label: textOf(match[2]!),
  }));
}

/** One element of a page, by the opening tag that names it. */
function element(html: string, tag: string, attribute: string): string {
  const found = new RegExp(`<${tag}\\b[^>]*${attribute}[^>]*>[\\s\\S]*?</${tag}>`).exec(html);
  expect(found, `the page has <${tag} ${attribute}>`).not.toBeNull();
  return found![0];
}

async function page(who: SignedIn, path: string): Promise<string> {
  const response = await who.fetch(path);
  expect(response.status, path).toBe(200);
  return response.text();
}

const primary = (html: string) => linksIn(element(html, "nav", 'aria-label="Principal"'));
const main = (html: string) => element(html, "main", 'id="contenido"');

/** Every link §4.1 keeps for Admins. */
const adminOnly = ["/dia", "/cuentas", "/por-cobrar", "/inventario", "/diferencias", "/historial", "/productos", "/usuarios"];

/**
 * A Worker's page links to none of them and names none anywhere, the data it
 * embeds included. `/cuentas` alone is named, and only as what a Worker's
 * Cuentas holds: the Bills opened from Cuentas abiertas are under it.
 */
function expectNothingOfAnAdmins(html: string) {
  const links = linksIn(html).map((link) => link.to);
  for (const path of adminOnly) {
    expect(links, `no link to ${path}`).not.toContain(path);
    if (path === "/cuentas") continue;
    expect(new RegExp(`${path}(?![\\w/-])`).test(html), `${path} is not named`).toBe(false);
  }
}

describe("the four destinations", () => {
  it("an Admin has Inicio, Vender, Día and Más", async () => {
    const ana = await signedIn("admin", "Ana Navega");
    const html = await page(ana, "/inicio");

    expect(primary(html)).toEqual([
      { to: "/inicio", label: "Inicio" },
      { to: "/", label: "Vender" },
      { to: "/dia", label: "Día" },
      { to: "/mas", label: "Más" },
    ]);
    expect(textOf(html)).toContain("Ana Navega · Administrador");
    expect(element(html, "a", 'aria-current="page"')).toContain("Inicio");
  });

  it("a Worker has Inicio, Vender, Cuentas and Más; Cuentas is Cuentas abiertas", async () => {
    const beto = await signedIn("worker", "Beto Navega");
    const html = await page(beto, "/");

    expect(primary(html)).toEqual([
      { to: "/inicio", label: "Inicio" },
      { to: "/", label: "Vender" },
      { to: "/cuentas-abiertas", label: "Cuentas" },
      { to: "/mas", label: "Más" },
    ]);
    expect(element(html, "a", 'aria-current="page"')).toContain("Vender");
    expect(textOf(html)).toContain("Beto Navega · Empleado");
    expectNothingOfAnAdmins(html);
  });

  it("the destination a screen belongs to is the current one", () => {
    const admin = [{ to: "/inicio" }, { to: "/" }, { to: "/dia" }, { to: "/mas" }];
    const worker = [{ to: "/inicio" }, { to: "/" }, { to: "/cuentas-abiertas", holds: ["/cuentas"] }, { to: "/mas" }];
    const at = (destinations: typeof worker, pathname: string) => destinationAt(destinations, pathname)?.to;

    expect(at(admin, "/")).toBe("/");
    expect(at(admin, "/inicio")).toBe("/inicio");
    expect(at(admin, "/dia")).toBe("/dia");
    expect(at(admin, "/inventario/conteo")).toBe("/mas");
    // Everything no destination holds is reached through Más.
    expect(at(admin, "/cuentas-abiertas")).toBe("/mas");
    expect(at(admin, "/cuentas/b1")).toBe("/mas");
    expect(at(admin, "/productos/p1")).toBe("/mas");
    expect(at(worker, "/cuentas-abiertas")).toBe("/cuentas-abiertas");
    expect(at(worker, "/cuentas/b1")).toBe("/cuentas-abiertas");
    expect(at(worker, "/clientes/c1")).toBe("/mas");
  });
});

describe("Inicio", () => {
  it("is where a User lands, with a card for a new sale and one for each thing worth knowing", async () => {
    const ana = await signedIn("admin", "Ana Llega");
    // Before anything can be sold, an Admin's first card leads to adding it.
    const empty = main(await page(ana, "/inicio"));
    expect(linksIn(empty).map((link) => link.to)).toEqual([
      "/productos?paso=nuevo",
      "/",
      "/dia",
      "/cuentas-abiertas",
      "/inventario",
      "/clientes",
      "/mi-dia",
    ]);
    expect(textOf(empty)).toContain("Agrega lo que vende la cafetería");

    await runTest(seedItem({ name: "Para empezar a vender", price: 1000 }));
    const html = main(await page(ana, "/inicio"));

    expect(textOf(html)).toContain("Hola, Ana Llega");
    expect(linksIn(html).map((link) => link.to)).toEqual(["/", "/dia", "/cuentas-abiertas", "/inventario", "/clientes", "/mi-dia"]);
    expect(textOf(html)).toContain("Nueva venta");
    expect(textOf(html)).toContain("Cobrado hoy");
    expect(textOf(html)).not.toContain("Agrega lo que vende la cafetería");
  });

  it("gives a Worker their own Day in place of everyone's, and no Inventario", async () => {
    const beto = await signedIn("worker", "Beto Llega");
    const whole = await page(beto, "/inicio");
    const html = main(whole);

    expect(textOf(html)).toContain("Hola, Beto Llega");
    expect(linksIn(html).map((link) => link.to)).toEqual(["/", "/mi-dia", "/cuentas-abiertas", "/clientes"]);
    expect(textOf(html)).toContain("Cobraste hoy");
    expectNothingOfAnAdmins(whole);
  });
});

describe("Más", () => {
  it("gives an Admin every remaining destination, grouped, and the way out", async () => {
    const ana = await signedIn("admin", "Ana Más");
    const html = await page(ana, "/mas");
    const shown = main(html);

    expect(linksIn(shown).map((link) => `${link.label} ${link.to}`)).toEqual([
      "Cuentas abiertas /cuentas-abiertas",
      "Cuentas /cuentas",
      "Por cobrar /por-cobrar",
      "Clientes /clientes",
      "Inventario /inventario",
      "Diferencias /diferencias",
      "Mi día /mi-dia",
      "Historial /historial",
      "Productos /productos",
      "Usuarios /usuarios",
    ]);
    expect((shown.match(/<h2\b/g) ?? []).length, "grouped under headings").toBeGreaterThan(2);
    expect(textOf(shown)).toContain("Ana Más");
    expect(textOf(shown)).toContain("Administrador");
    expect(shown).toContain('action="/salir"');
    expect(element(html, "a", 'aria-current="page"')).toContain("Más");
  });

  it("gives a Worker Clientes, Mi día and their session, and nothing of an Admin's", async () => {
    const beto = await signedIn("worker", "Beto Más");
    const html = await page(beto, "/mas");
    const shown = main(html);

    expect(linksIn(shown)).toEqual([
      { to: "/clientes", label: "Clientes" },
      { to: "/mi-dia", label: "Mi día" },
    ]);
    expect(textOf(shown)).toContain("Beto Más");
    expect(textOf(shown)).toContain("Empleado");
    expect(shown).toContain('action="/salir"');
    expectNothingOfAnAdmins(html);
    for (const word of ["Inventario", "Historial", "Por cobrar", "Existencias", "Usuarios", "Productos"]) {
      expect(html, `a Worker's Más does not say «${word}»`).not.toContain(word);
    }
  });
});

describe("Entrar", () => {
  it("explains how to get a code, on a field with a label", async () => {
    const html = await (await appFetch("/entrar")).text();

    expect(html).toMatch(/<label[^>]*for="code"[^>]*>Código de acceso<\/label>/);
    expect(textOf(html)).toContain("Pídeselo a un administrador. Sirve una sola vez y dura 10 minutos.");
    expect(html, "a placeholder is not a label").not.toContain("placeholder=");
    expect(textOf(html)).not.toContain("Tu sesión terminó");
  });

  it("tells a phone whose session ended why it is back on Entrar", async () => {
    const response = await appFetch("/entrar", { headers: { Cookie: "__Host-gamo-session=ya-no-existe" } });

    expect(response.status).toBe(200);
    expect(textOf(await response.text())).toContain("Tu sesión terminó");
    // Told once: the phone forgets the cookie that said so.
    expect(response.headers.getSetCookie().join()).toMatch(/__Host-gamo-session=; Max-Age=0/);
  });

  it("keeps what was typed when the code is refused", async () => {
    const response = await appFetch("/entrar", { method: "POST", body: new URLSearchParams({ code: "mala 2345" }) });

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(textOf(html)).toContain("Ese código no es válido o ya venció. Pide uno nuevo.");
    expect(html).toContain('value="mala 2345"');
  });
});

describe("the pages for what cannot be shown", () => {
  it("a page that does not exist says so and offers Vender", async () => {
    const ana = await signedIn("admin", "Ana Perdida");
    const response = await ana.fetch("/esta-pagina-no-existe");

    expect(response.status).toBe(404);
    const html = await response.text();
    expect(textOf(html)).toContain("No encontramos esta página");
    expect(linksIn(html)).toContainEqual({ to: "/", label: "Ir a Vender" });
  });

  it("a Bill that is no longer Open tells a Worker so, and leads to the ones that are", async () => {
    const beto = await signedIn("worker", "Beto Cobrador");
    const item = await runTest(seedItem({ name: "Cobrado por Beto", price: 1000 }));
    const { sale } = await recordSale(beto, saleForm({ itemId: item.id, intent: "cobrar" }));
    const response = await beto.fetch(`/cuentas/${sale!.billId}`);

    expect(response.status).toBe(403);
    const html = await response.text();
    expect(textOf(html)).toContain("Esta cuenta ya no está abierta");
    expect(textOf(html)).toContain("solo un administrador puede abrirla");
    expect(textOf(html)).not.toContain("No tienes acceso a esta página");
    expect(linksIn(main(html))).toEqual([
      { to: "/cuentas-abiertas", label: "Cuentas abiertas" },
      { to: "/", label: "Ir a Vender" },
    ]);
  });

  it("a screen a Worker may not open says so inside their own navigation", async () => {
    const beto = await signedIn("worker", "Beto Sin Paso");
    const response = await beto.fetch("/inventario");

    expect(response.status).toBe(403);
    const html = await response.text();
    expect(textOf(html)).toContain("No tienes acceso a esta página");
    expect(linksIn(main(html))).toContainEqual({ to: "/", label: "Ir a Vender" });
    expect(primary(html).map((link) => link.label)).toEqual(["Inicio", "Vender", "Cuentas", "Más"]);
    // The words of the screen that was refused are not among them.
    expect(html).not.toContain("Existencias");
  });

  it("a form the app does not understand is not called a failed recording", async () => {
    const ana = await signedIn("admin", "Ana Forma");
    const response = await ana.fetch("/usuarios", { method: "POST", body: new URLSearchParams({ intent: "no-existe" }) });

    expect(response.status).toBe(400);
    const html = await response.text();
    const said = textOf(main(html));
    expect(said).toContain("Algo salió mal");
    expect(said).toContain("revísalo antes de repetirlo");
    expect(said).not.toMatch(/no se (guardó|registró)/i);
    expect(linksIn(main(html)).map((link) => link.label)).toEqual(["Volver a intentar", "Ir a Vender"]);
  });
});
