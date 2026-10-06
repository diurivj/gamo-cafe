import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  activeItemsByCategory,
  addCategory,
  addItem,
  getItem,
  listCatalog,
  moveCategory,
  renameCategory,
  restoreCategory,
  restoreItem,
  retireCategory,
  retireItem,
  updateItem,
} from "~/backend/catalog";
import type { CurrentUser } from "~/backend/current-user";
import type { Db } from "~/backend/db";
import { listAdjustments, stockOf } from "~/backend/stock";

import { as, seedUser } from "./support/auth";
import { runTest, setClock } from "./support/effect";

// Tests in this file share one D1, and active Item names are unique, so each
// test uses its own names.

describe("adding an Item", () => {
  it("records its starting Stock as one Restock by the Admin, on that Day", () =>
    runTest(
      Effect.gen(function* () {
        // Late evening in Mexico City: already the 6th in UTC.
        yield* setClock("2026-10-05T22:30:00");
        const ana = yield* seedUser("admin");
        const bebidas = yield* addCategory("Bebidas").pipe(as(ana));

        const item = yield* addItem({
          name: "Agua mineral",
          price: 1850,
          categoryId: bebidas.id,
          startingStock: 24,
        }).pipe(as(ana));

        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(24);
        expect(yield* listAdjustments(item.id).pipe(as(ana))).toEqual([
          {
            id: expect.any(String),
            itemId: item.id,
            reason: "restock",
            units: 24,
            note: null,
            by: ana.id,
            at: Date.parse("2026-10-05T22:30:00-06:00"),
            day: "2026-10-05",
          },
        ]);
      }),
    ));

  it("with no starting Stock records no Adjustment", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* addCategory("Snacks").pipe(as(ana));

        const item = yield* addItem({ name: "Cacahuates", price: 1500, categoryId: category.id }).pipe(as(ana));

        expect(item).toMatchObject({ name: "Cacahuates", price: 1500, stockTracked: true, minimum: null });
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(0);
        expect(yield* listAdjustments(item.id).pipe(as(ana))).toEqual([]);
      }),
    ));

  it("that is not stock-tracked has no Stock, whatever starting Stock was sent", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* addCategory("Cocina").pipe(as(ana));

        const item = yield* addItem({
          name: "Sándwich de jamón",
          price: 4500,
          categoryId: category.id,
          stockTracked: false,
          startingStock: 10,
        }).pipe(as(ana));

        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(0);
        expect(yield* listAdjustments(item.id).pipe(as(ana))).toEqual([]);
      }),
    ));

  it.for([
    ["the same name", "Jugo de piña"],
    ["another case", "JUGO DE PIÑA"],
    ["no accents", "Jugo de pina"],
    ["other spacing", "  jugo   de piña "],
  ])("refuses the name of an active Item written with %s", ([, name]) =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* addCategory("Jugos").pipe(as(ana));
        // The first test of this group adds it; the others find it there.
        yield* Effect.ignore(addItem({ name: "Jugo de piña", price: 2500, categoryId: category.id }).pipe(as(ana)));

        const error = yield* Effect.flip(
          addItem({ name: name!, price: 2500, categoryId: category.id, startingStock: 5 }).pipe(as(ana)),
        );

        expect(error._tag).toBe("ItemNameTaken");
      }),
    ));

  it("accepts the name of a retired Item", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* addCategory("Temporada").pipe(as(ana));
        const old = yield* addItem({ name: "Ponche", price: 3000, categoryId: category.id }).pipe(as(ana));
        yield* retireItem(old.id).pipe(as(ana));

        const again = yield* addItem({ name: "ponche", price: 3500, categoryId: category.id }).pipe(as(ana));

        expect(again.id).not.toBe(old.id);
      }),
    ));

  it.for([
    ["an empty name", { name: "   " }, "NameMissing"],
    ["a price of zero", { price: 0 }, "InvalidPrice"],
    ["a negative price", { price: -100 }, "InvalidPrice"],
    ["a price with a fraction of a centavo", { price: 10.5 }, "InvalidPrice"],
    ["a negative Minimum", { minimum: -1 }, "InvalidUnits"],
    ["a fractional starting Stock", { startingStock: 1.5 }, "InvalidUnits"],
    ["a Category that does not exist", { categoryId: "nope" }, "CategoryUnavailable"],
  ] as const)("refuses %s", ([, change, tag]) =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* addCategory("Varios").pipe(as(ana));

        const error = yield* Effect.flip(
          addItem({ name: `Rechazado ${tag} ${JSON.stringify(change)}`, price: 1000, categoryId: category.id, ...change }).pipe(
            as(ana),
          ),
        );

        expect(error._tag).toBe(tag);
      }),
    ));
});

type User = Parameters<typeof as>[0];

/** Any operation of the catalog, before it is given its User. */
type Operation = Effect.Effect<unknown, { readonly _tag: string }, Db | CurrentUser>;

/** The names of the active Items of one Category, as the Sell screen will list them. */
const activeNames = (categoryId: string) =>
  Effect.map(activeItemsByCategory, (groups) =>
    groups.find((group) => group.id === categoryId)?.items.map((item) => item.name),
  );

/** What Productos shows of one Category. */
const inCatalog = (categoryId: string, admin: User) =>
  Effect.map(listCatalog.pipe(as(admin)), (catalog) => catalog.find((category) => category.id === categoryId)!);

describe("retiring and restoring an Item", () => {
  it("hides it from the active Items and keeps its Stock records", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* addCategory("Paletas").pipe(as(ana));
        const item = yield* addItem({ name: "Paleta de limón", price: 1200, categoryId: category.id, startingStock: 8 }).pipe(as(ana));
        yield* addItem({ name: "Paleta de fresa", price: 1200, categoryId: category.id }).pipe(as(ana));

        yield* retireItem(item.id).pipe(as(ana));

        expect(yield* activeNames(category.id)).toEqual(["Paleta de fresa"]);
        expect((yield* getItem(item.id).pipe(as(ana))).retired).toBe(true);
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(8);
        expect(yield* listAdjustments(item.id).pipe(as(ana))).toHaveLength(1);

        yield* restoreItem(item.id).pipe(as(ana));

        expect(yield* activeNames(category.id)).toEqual(["Paleta de fresa", "Paleta de limón"]);
        expect(yield* getItem(item.id).pipe(as(ana))).toMatchObject({ id: item.id, price: 1200, retired: false });
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(8);
        expect(yield* listAdjustments(item.id).pipe(as(ana))).toHaveLength(1);
      }),
    ));

  it("refuses to restore an Item whose name an active Item took meanwhile", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* addCategory("Galletas").pipe(as(ana));
        const old = yield* addItem({ name: "Galleta de avena", price: 900, categoryId: category.id }).pipe(as(ana));
        yield* retireItem(old.id).pipe(as(ana));
        yield* addItem({ name: "Galleta de Avena", price: 1000, categoryId: category.id }).pipe(as(ana));

        const error = yield* Effect.flip(restoreItem(old.id).pipe(as(ana)));

        expect(error._tag).toBe("ItemNameTaken");
        expect((yield* getItem(old.id).pipe(as(ana))).retired).toBe(true);
      }),
    ));

  it("answers ItemNotFound for an Item that does not exist", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const operations: Operation[] = [retireItem("nope"), restoreItem("nope"), getItem("nope")];
        for (const operation of operations) {
          expect((yield* Effect.flip(operation.pipe(as(ana))))._tag).toBe("ItemNotFound");
        }
      }),
    ));
});

describe("retiring and restoring a Category", () => {
  it("is refused while the Category has an active Item, and allowed once they are retired", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* addCategory("Refrescos").pipe(as(ana));
        const item = yield* addItem({ name: "Refresco de cola", price: 2000, categoryId: category.id }).pipe(as(ana));

        const error = yield* Effect.flip(retireCategory(category.id).pipe(as(ana)));
        expect(error._tag).toBe("CategoryHasActiveItems");
        expect((yield* inCatalog(category.id, ana)).retired).toBe(false);

        yield* retireItem(item.id).pipe(as(ana));
        yield* retireCategory(category.id).pipe(as(ana));
        expect((yield* inCatalog(category.id, ana)).retired).toBe(true);

        // A retired Category holds no active Item: none added, none restored.
        const added = yield* Effect.flip(
          addItem({ name: "Refresco de naranja", price: 2000, categoryId: category.id }).pipe(as(ana)),
        );
        expect(added._tag).toBe("CategoryUnavailable");
        const restored = yield* Effect.flip(restoreItem(item.id).pipe(as(ana)));
        expect(restored._tag).toBe("CategoryUnavailable");

        yield* restoreCategory(category.id).pipe(as(ana));
        expect((yield* inCatalog(category.id, ana)).retired).toBe(false);
        yield* restoreItem(item.id).pipe(as(ana));
        expect(yield* activeNames(category.id)).toEqual(["Refresco de cola"]);
      }),
    ));

  it("answers CategoryNotFound for a Category that does not exist", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const operations: Operation[] = [
          retireCategory("nope"),
          restoreCategory("nope"),
          renameCategory("nope", "Nada"),
          moveCategory("nope", "earlier"),
        ];
        for (const operation of operations) {
          expect((yield* Effect.flip(operation.pipe(as(ana))))._tag).toBe("CategoryNotFound");
        }
      }),
    ));
});

describe("changing an Item", () => {
  it("changes its name, price, Category and Minimum", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const dulces = yield* addCategory("Dulces").pipe(as(ana));
        const chocolates = yield* addCategory("Chocolates").pipe(as(ana));
        const item = yield* addItem({ name: "Barra de cacao", price: 2200, categoryId: dulces.id }).pipe(as(ana));

        yield* updateItem(item.id, {
          name: " Barra  de chocolate ",
          price: 2400,
          categoryId: chocolates.id,
          stockTracked: true,
          minimum: 6,
        }).pipe(as(ana));

        expect(yield* getItem(item.id).pipe(as(ana))).toEqual({
          id: item.id,
          name: "Barra de chocolate",
          price: 2400,
          categoryId: chocolates.id,
          stockTracked: true,
          minimum: 6,
          retired: false,
        });
        expect(yield* activeNames(dulces.id)).toBeUndefined();
        expect(yield* activeNames(chocolates.id)).toEqual(["Barra de chocolate"]);
      }),
    ));

  it("lets an Item keep its own name written another way, and refuses another active Item's", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* addCategory("Tés").pipe(as(ana));
        const verde = yield* addItem({ name: "Te verde", price: 2000, categoryId: category.id }).pipe(as(ana));
        yield* addItem({ name: "Té negro", price: 2000, categoryId: category.id }).pipe(as(ana));
        const same = { price: 2000, categoryId: category.id, stockTracked: true, minimum: null };

        yield* updateItem(verde.id, { ...same, name: "Té Verde" }).pipe(as(ana));
        expect((yield* getItem(verde.id).pipe(as(ana))).name).toBe("Té Verde");

        const error = yield* Effect.flip(updateItem(verde.id, { ...same, name: "TE NEGRO" }).pipe(as(ana)));
        expect(error._tag).toBe("ItemNameTaken");
        expect((yield* getItem(verde.id).pipe(as(ana))).name).toBe("Té Verde");
      }),
    ));

  it("switching stock tracking off and on again changes no Stock record", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* addCategory("Aguas").pipe(as(ana));
        const item = yield* addItem({ name: "Agua de jamaica", price: 1800, categoryId: category.id, startingStock: 12 }).pipe(as(ana));
        const adjustments = yield* listAdjustments(item.id).pipe(as(ana));
        const same = { name: item.name, price: item.price, categoryId: category.id, minimum: null };

        yield* updateItem(item.id, { ...same, stockTracked: false }).pipe(as(ana));

        expect((yield* getItem(item.id).pipe(as(ana))).stockTracked).toBe(false);
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(12);
        expect(yield* listAdjustments(item.id).pipe(as(ana))).toEqual(adjustments);

        yield* updateItem(item.id, { ...same, stockTracked: true }).pipe(as(ana));

        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(12);
        expect(yield* listAdjustments(item.id).pipe(as(ana))).toEqual(adjustments);
      }),
    ));

  it.for([
    ["an empty name", { name: "" }, "NameMissing"],
    ["a price of zero", { price: 0 }, "InvalidPrice"],
    ["a negative Minimum", { minimum: -3 }, "InvalidUnits"],
    ["a Category that does not exist", { categoryId: "nope" }, "CategoryUnavailable"],
  ] as const)("refuses %s and leaves the Item as it was", ([, change, tag]) =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* addCategory("Intactos").pipe(as(ana));
        const item = yield* addItem({ name: `Intacto ${tag}`, price: 1000, categoryId: category.id }).pipe(as(ana));
        const before = yield* getItem(item.id).pipe(as(ana));

        const error = yield* Effect.flip(
          updateItem(item.id, { name: item.name, price: 1000, categoryId: category.id, stockTracked: true, minimum: null, ...change }).pipe(
            as(ana),
          ),
        );

        expect(error._tag).toBe(tag);
        expect(yield* getItem(item.id).pipe(as(ana))).toEqual(before);
      }),
    ));

  it("refuses to move an Item into a retired Category", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const open = yield* addCategory("Abierta").pipe(as(ana));
        const closed = yield* addCategory("Cerrada").pipe(as(ana));
        yield* retireCategory(closed.id).pipe(as(ana));
        const item = yield* addItem({ name: "Mazapán", price: 800, categoryId: open.id }).pipe(as(ana));

        const error = yield* Effect.flip(
          updateItem(item.id, { name: "Mazapán", price: 800, categoryId: closed.id, stockTracked: true, minimum: null }).pipe(as(ana)),
        );

        expect(error._tag).toBe("CategoryUnavailable");
      }),
    ));

  it("answers ItemNotFound for an Item that does not exist", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* addCategory("Nadie").pipe(as(ana));
        const error = yield* Effect.flip(
          updateItem("nope", { name: "Fantasma", price: 100, categoryId: category.id, stockTracked: true, minimum: null }).pipe(as(ana)),
        );
        expect(error._tag).toBe("ItemNotFound");
      }),
    ));
});

describe("the order of Categories and Items", () => {
  it("is the Categories' position, then the Items' names ignoring case and accents", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const first = yield* addCategory("Orden uno").pipe(as(ana));
        const second = yield* addCategory("Orden dos").pipe(as(ana));
        for (const name of ["Zarzamora", "álamo", "Betabel", "Árbol"]) {
          yield* addItem({ name: `${name} (orden)`, price: 1000, categoryId: second.id }).pipe(as(ana));
        }
        yield* addItem({ name: "Único (orden)", price: 1050, categoryId: first.id }).pipe(as(ana));

        const ours = (yield* activeItemsByCategory).filter((group) => group.name.startsWith("Orden"));

        expect(ours).toEqual([
          { id: first.id, name: "Orden uno", items: [{ id: expect.any(String), name: "Único (orden)", price: 1050 }] },
          {
            id: second.id,
            name: "Orden dos",
            items: ["álamo (orden)", "Árbol (orden)", "Betabel (orden)", "Zarzamora (orden)"].map((name) => ({
              id: expect.any(String),
              name,
              price: 1000,
            })),
          },
        ]);
      }),
    ));

  it("follows a Category that is moved earlier or later, and one that is renamed", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const a = yield* addCategory("Mover A").pipe(as(ana));
        const b = yield* addCategory("Mover B").pipe(as(ana));
        const c = yield* addCategory("Mover C").pipe(as(ana));
        const ours = Effect.map(listCatalog.pipe(as(ana)), (catalog) =>
          catalog.filter((category) => [a.id, b.id, c.id].includes(category.id)).map((category) => category.name),
        );

        yield* moveCategory(c.id, "earlier").pipe(as(ana));
        expect(yield* ours).toEqual(["Mover A", "Mover C", "Mover B"]);

        yield* moveCategory(a.id, "later").pipe(as(ana));
        expect(yield* ours).toEqual(["Mover C", "Mover A", "Mover B"]);

        yield* renameCategory(a.id, "  Movida ").pipe(as(ana));
        expect(yield* ours).toEqual(["Mover C", "Movida", "Mover B"]);

        expect((yield* Effect.flip(renameCategory(a.id, " ").pipe(as(ana))))._tag).toBe("NameMissing");
        expect((yield* Effect.flip(addCategory("").pipe(as(ana))))._tag).toBe("NameMissing");
      }),
    ));
});

describe("a Worker", () => {
  it("is refused every operation on Productos", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker");
        const category = yield* addCategory("Solo admins").pipe(as(ana));
        const item = yield* addItem({ name: "Solo admins", price: 1000, categoryId: category.id }).pipe(as(ana));
        const change = { name: "Cambiado", price: 1, categoryId: category.id, stockTracked: false, minimum: null };

        const operations: Record<string, Operation> = {
          listCatalog,
          getItem: getItem(item.id),
          addCategory: addCategory("De Beto"),
          renameCategory: renameCategory(category.id, "De Beto"),
          moveCategory: moveCategory(category.id, "earlier"),
          retireCategory: retireCategory(category.id),
          restoreCategory: restoreCategory(category.id),
          addItem: addItem({ name: "De Beto", price: 1000, categoryId: category.id, startingStock: 3 }),
          updateItem: updateItem(item.id, change),
          retireItem: retireItem(item.id),
          restoreItem: restoreItem(item.id),
          stockOf: stockOf(item.id),
          listAdjustments: listAdjustments(item.id),
        };
        const before = yield* listCatalog.pipe(as(ana));

        for (const [name, operation] of Object.entries(operations)) {
          const error = yield* Effect.flip(operation.pipe(as(beto)));
          expect(error._tag, name).toBe("AdminOnly");
        }
        expect(yield* listCatalog.pipe(as(ana))).toEqual(before);
      }),
    ));

  it("can read the active Items, without anything about Stock", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker");
        const category = yield* addCategory("Para vender").pipe(as(ana));
        yield* addItem({ name: "Para vender", price: 1000, categoryId: category.id, minimum: 2, startingStock: 9 }).pipe(as(ana));

        const groups = yield* activeItemsByCategory.pipe(as(beto));

        const group = groups.find(({ id }) => id === category.id)!;
        expect(Object.keys(group.items[0]!).sort()).toEqual(["id", "name", "price"]);
      }),
    ));
});
