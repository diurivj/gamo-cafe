import { describe, expect, it } from "vitest";

import { signedIn, type SignedIn } from "./support/auth";
import { savedCustomer } from "./support/customers";

// Through the Worker: what each route answers, and to whom. Tests share one
// D1, so each uses its own Customer names.

const form = (fields: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(fields) });

/** The picker's search, as its resource route answers it. */
async function pick(phone: SignedIn, typed: string) {
  const response = await phone.fetch(`/clientes/selector?q=${encodeURIComponent(typed)}`);
  expect(response.status).toBe(200);
  return (await response.json()) as { customers: Array<{ id: string; name: string; note: string | null }> };
}

describe("Clientes", () => {
  it("lets a Worker add a Customer and shows who added them", async () => {
    const beto = await signedIn("worker", "Beto Campos");

    const added = await beto.fetch("/clientes", form({ name: "Familia Ruiz", note: "Papás de Leo" }));

    expect(added.status).toBe(302);
    const page = added.headers.get("Location")!;
    expect(page).toMatch(/^\/clientes\/[\w-]+$/);
    const html = await (await beto.fetch(page)).text();
    expect(html).toContain("Familia Ruiz");
    expect(html).toContain("Papás de Leo");
    expect(html).toContain("Beto Campos");
  });

  it("refuses a duplicate active name in Spanish", async () => {
    const beto = await signedIn("worker");
    await savedCustomer("Ángela Soto", { by: beto.user });

    const response = await beto.fetch("/clientes", form({ name: "angela SOTO" }));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Ya hay un cliente con ese nombre.");
  });

  it("refuses an empty name in Spanish", async () => {
    const beto = await signedIn("worker");

    const response = await beto.fetch("/clientes", form({ name: "  " }));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Escribe el nombre del cliente.");
  });

  it("lists the Customers whose name starts with what was typed, retired ones marked", async () => {
    const beto = await signedIn("worker");
    await savedCustomer("Bárbara Luna", { by: beto.user });
    await savedCustomer("Barbara Vieja", { by: beto.user, retired: true });
    await savedCustomer("Carlos Luna", { by: beto.user });

    const html = await (await beto.fetch("/clientes?q=barb")).text();

    expect(html).toContain("Bárbara Luna");
    expect(html).toContain("Barbara Vieja");
    expect(html).toContain("Retirado");
    expect(html).not.toContain("Carlos Luna");
  });

  it("answers 404 for a Customer that does not exist", async () => {
    const beto = await signedIn("worker");

    expect((await beto.fetch("/clientes/nobody")).status).toBe(404);
  });
});

describe("the Customer picker's route", () => {
  it("finds active Customers by prefix and leaves retired ones out", async () => {
    const beto = await signedIn("worker");
    const dario = await savedCustomer("Darío Paz", { by: beto.user, note: "5ºA" });
    await savedCustomer("Dariela", { by: beto.user, retired: true });
    await savedCustomer("Elena Paz", { by: beto.user });

    const { customers } = await pick(beto, "DARI");

    expect(customers).toEqual([{ id: dario.id, name: "Darío Paz", note: "5ºA" }]);
  });

  it("adds a new Customer and answers with it", async () => {
    const beto = await signedIn("worker");

    const response = await beto.fetch("/clientes/selector", form({ name: " Fabián  Ríos " }));

    expect(response.status).toBe(200);
    const { customer } = (await response.json()) as { customer: { id: string; name: string } };
    expect(customer.name).toBe("Fabián Ríos");
    expect((await pick(beto, "fabian")).customers).toEqual([{ id: customer.id, name: "Fabián Ríos", note: null }]);
  });

  it("refuses a duplicate active name in Spanish", async () => {
    const beto = await signedIn("worker");
    await savedCustomer("Gael Ortiz", { by: beto.user });

    const response = await beto.fetch("/clientes/selector", form({ name: "GAEL ORTIZ" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Ya hay un cliente con ese nombre." });
  });
});

describe("only an Admin", () => {
  it("renames, retires and restores a Customer", async () => {
    const ana = await signedIn("admin");
    const hugo = await savedCustomer("Hugo", { by: ana.user });
    const page = `/clientes/${hugo.id}`;

    const renamed = await ana.fetch(page, form({ intent: "edit", name: "Hugo Méndez", note: "Paga los viernes" }));
    expect(renamed.status).toBe(200);
    expect(await renamed.text()).toContain("Paga los viernes");
    expect((await pick(ana, "hugo m")).customers.map((customer) => customer.id)).toEqual([hugo.id]);

    expect((await ana.fetch(page, form({ intent: "retire" }))).status).toBe(200);
    expect((await pick(ana, "hugo")).customers).toEqual([]);

    expect((await ana.fetch(page, form({ intent: "restore" }))).status).toBe(200);
    expect((await pick(ana, "hugo")).customers.map((customer) => customer.id)).toEqual([hugo.id]);
  });

  it("is told in Spanish when the new name belongs to another Customer", async () => {
    const ana = await signedIn("admin");
    await savedCustomer("Irene Vega", { by: ana.user });
    const other = await savedCustomer("Iris", { by: ana.user });

    const response = await ana.fetch(`/clientes/${other.id}`, form({ intent: "edit", name: "irene vega" }));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Ya hay un cliente con ese nombre.");
  });

  it("a Worker who posts a rename, a retirement or a restoration is refused, and nothing changes", async () => {
    const beto = await signedIn("worker");
    const active = await savedCustomer("Julia Rey", { by: beto.user });
    const retired = await savedCustomer("Julián Rey", { by: beto.user, retired: true });

    const responses = [
      await beto.fetch(`/clientes/${active.id}`, form({ intent: "edit", name: "Otro nombre" })),
      await beto.fetch(`/clientes/${active.id}`, form({ intent: "retire" })),
      await beto.fetch(`/clientes/${retired.id}`, form({ intent: "restore" })),
    ];

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    expect((await pick(beto, "juli")).customers).toEqual([{ id: active.id, name: "Julia Rey", note: null }]);
  });

  it("a Worker's page for a Customer offers none of it", async () => {
    const beto = await signedIn("worker");
    const ana = await signedIn("admin");
    const karla = await savedCustomer("Karla", { by: beto.user });

    const forWorker = await (await beto.fetch(`/clientes/${karla.id}`)).text();
    const forAdmin = await (await ana.fetch(`/clientes/${karla.id}`)).text();

    expect(forAdmin).toContain("Retirar cliente");
    expect(forWorker).not.toContain("Retirar cliente");
    expect(forWorker).not.toContain("Guardar");
  });
});
