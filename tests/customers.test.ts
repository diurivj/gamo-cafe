import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  addCustomer,
  editCustomer,
  getCustomer,
  restoreCustomer,
  retireCustomer,
  searchCustomers,
} from "~/backend/customers";

import { as, seedUser } from "./support/auth";
import { advanceClock, runTest, setClock } from "./support/effect";

// Tests in this file share one D1, so each uses its own Customer names.

describe("adding a Customer", () => {
  it("lets a Worker add one, and records who added it and when", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T10:30:00");
        const beto = yield* seedUser("worker", "Beto");

        const added = yield* addCustomer({ name: "Familia Ruiz", note: "Papás de Leo" }).pipe(as(beto));

        expect(yield* getCustomer(added.id)).toEqual({
          id: added.id,
          name: "Familia Ruiz",
          note: "Papás de Leo",
          retiredAt: null,
          addedBy: { id: beto.id, name: "Beto" },
          addedAt: Date.parse("2026-10-05T10:30:00-06:00"),
        });
      }),
    ));

  it("keeps the name as typed, less stray space, and a blank note as no note", () =>
    runTest(
      Effect.gen(function* () {
        const beto = yield* seedUser("worker");

        const added = yield* addCustomer({ name: "  Doña   Lupita ", note: "   " }).pipe(as(beto));

        expect(yield* getCustomer(added.id)).toMatchObject({ name: "Doña Lupita", note: null });
      }),
    ));

  it("refuses a name with nothing in it", () =>
    runTest(
      Effect.gen(function* () {
        const beto = yield* seedUser("worker");

        const error = yield* Effect.flip(addCustomer({ name: "   " }).pipe(as(beto)));

        expect(error._tag).toBe("CustomerNameRequired");
      }),
    ));

  it("refuses the name of an active Customer, whatever its case or accents", () =>
    runTest(
      Effect.gen(function* () {
        const beto = yield* seedUser("worker");
        yield* addCustomer({ name: "María Núñez" }).pipe(as(beto));

        for (const name of ["María Núñez", "MARIA NUNEZ", " maria  núñez "]) {
          const error = yield* Effect.flip(addCustomer({ name }).pipe(as(beto)));
          expect(error._tag, name).toBe("CustomerNameTaken");
        }
        expect(yield* searchCustomers("maria nunez")).toHaveLength(1);
      }),
    ));
});

describe("searching Customers", () => {
  it("finds those whose name starts with what was typed, ignoring case and accents, in name order", () =>
    runTest(
      Effect.gen(function* () {
        const beto = yield* seedUser("worker");
        for (const name of ["Óscar Peña", "Osvaldo", "oscar aguilar", "Rosa Oscura"]) {
          yield* addCustomer({ name }).pipe(as(beto));
        }

        const found = yield* searchCustomers("OSC");

        expect(found.map((customer) => customer.name)).toEqual(["oscar aguilar", "Óscar Peña"]);
        expect((yield* searchCustomers("óscar p")).map((customer) => customer.name)).toEqual(["Óscar Peña"]);
        expect(yield* searchCustomers("zzz")).toEqual([]);
      }),
    ));

  it("treats % and _ as the characters they are", () =>
    runTest(
      Effect.gen(function* () {
        const beto = yield* seedUser("worker");
        yield* addCustomer({ name: "Quique" }).pipe(as(beto));

        expect(yield* searchCustomers("q%")).toEqual([]);
        expect(yield* searchCustomers("q_i")).toEqual([]);
      }),
    ));
});

describe("retiring and restoring a Customer", () => {
  it("leaves a retired Customer out of the search unless retired ones are asked for", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T10:00:00");
        const ana = yield* seedUser("admin");
        const tere = yield* addCustomer({ name: "Tere Salas" }).pipe(as(ana));
        yield* advanceClock("1 hour");

        yield* retireCustomer(tere.id).pipe(as(ana));

        expect(yield* searchCustomers("tere")).toEqual([]);
        expect(yield* searchCustomers("tere", { includeRetired: true })).toEqual([
          { id: tere.id, name: "Tere Salas", note: null, retiredAt: Date.parse("2026-10-05T11:00:00-06:00") },
        ]);
        expect((yield* getCustomer(tere.id)).retiredAt).toBe(Date.parse("2026-10-05T11:00:00-06:00"));
      }),
    ));

  it("brings a restored Customer back", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const ulises = yield* addCustomer({ name: "Ulises" }).pipe(as(ana));
        yield* retireCustomer(ulises.id).pipe(as(ana));

        yield* restoreCustomer(ulises.id).pipe(as(ana));

        expect((yield* searchCustomers("ulises")).map((customer) => customer.id)).toEqual([ulises.id]);
        expect((yield* getCustomer(ulises.id)).retiredAt).toBeNull();
      }),
    ));

  it("frees the name of a retired Customer, and then refuses to restore them over its new holder", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const first = yield* addCustomer({ name: "Víctor Lara" }).pipe(as(ana));
        yield* retireCustomer(first.id).pipe(as(ana));

        const second = yield* addCustomer({ name: "victor lara" }).pipe(as(ana));
        const error = yield* Effect.flip(restoreCustomer(first.id).pipe(as(ana)));

        expect(error._tag).toBe("CustomerNameTaken");
        expect((yield* searchCustomers("victor")).map((customer) => customer.id)).toEqual([second.id]);
      }),
    ));

  it("keeps the first retirement's time when retired again", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-06T10:00:00");
        const ana = yield* seedUser("admin");
        const wendy = yield* addCustomer({ name: "Wendy" }).pipe(as(ana));
        yield* retireCustomer(wendy.id).pipe(as(ana));
        yield* advanceClock("1 hour");

        yield* retireCustomer(wendy.id).pipe(as(ana));

        expect((yield* getCustomer(wendy.id)).retiredAt).toBe(Date.parse("2026-10-06T10:00:00-06:00"));
      }),
    ));
});

describe("editing a Customer", () => {
  it("renames them and changes their note, and the search follows the new name", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const xime = yield* addCustomer({ name: "Xime", note: "3ºB" }).pipe(as(beto));

        yield* editCustomer(xime.id, { name: "Ximena Ávila", note: "" }).pipe(as(ana));

        expect(yield* getCustomer(xime.id)).toMatchObject({
          name: "Ximena Ávila",
          note: null,
          addedBy: { id: beto.id, name: "Beto" },
        });
        expect((yield* searchCustomers("ximena a")).map((customer) => customer.id)).toEqual([xime.id]);
      }),
    ));

  it("lets a Customer keep their own name with other case or accents", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const yola = yield* addCustomer({ name: "yolanda perez" }).pipe(as(ana));

        yield* editCustomer(yola.id, { name: "Yolanda Pérez" }).pipe(as(ana));

        expect((yield* getCustomer(yola.id)).name).toBe("Yolanda Pérez");
      }),
    ));

  it("refuses another active Customer's name, and an empty one", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        yield* addCustomer({ name: "Zoé Marín" }).pipe(as(ana));
        const other = yield* addCustomer({ name: "Zulema" }).pipe(as(ana));

        const taken = yield* Effect.flip(editCustomer(other.id, { name: "ZOE MARIN" }).pipe(as(ana)));
        const empty = yield* Effect.flip(editCustomer(other.id, { name: " " }).pipe(as(ana)));

        expect(taken._tag).toBe("CustomerNameTaken");
        expect(empty._tag).toBe("CustomerNameRequired");
        expect((yield* getCustomer(other.id)).name).toBe("Zulema");
      }),
    ));
});

describe("only an Admin", () => {
  it("edits, retires or restores: a Worker is refused and nothing changes", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker");
        const active = yield* addCustomer({ name: "Abril Cano" }).pipe(as(beto));
        const retired = yield* addCustomer({ name: "Abel Cano" }).pipe(as(beto));
        yield* retireCustomer(retired.id).pipe(as(ana));

        const errors = [
          yield* Effect.flip(editCustomer(active.id, { name: "Otro nombre" }).pipe(as(beto))),
          yield* Effect.flip(retireCustomer(active.id).pipe(as(beto))),
          yield* Effect.flip(restoreCustomer(retired.id).pipe(as(beto))),
        ];

        expect(errors.map((error) => error._tag)).toEqual(["AdminOnly", "AdminOnly", "AdminOnly"]);
        expect(yield* getCustomer(active.id)).toMatchObject({ name: "Abril Cano", retiredAt: null });
        expect((yield* getCustomer(retired.id)).retiredAt).not.toBeNull();
      }),
    ));
});

describe("a Customer that does not exist", () => {
  it("cannot be read, edited, retired or restored", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");

        const errors = [
          yield* Effect.flip(getCustomer("nobody")),
          yield* Effect.flip(editCustomer("nobody", { name: "Nadie" }).pipe(as(ana))),
          yield* Effect.flip(retireCustomer("nobody").pipe(as(ana))),
          yield* Effect.flip(restoreCustomer("nobody").pipe(as(ana))),
        ];

        expect(errors.map((error) => error._tag)).toEqual(Array(4).fill("CustomerNotFound"));
      }),
    ));
});
