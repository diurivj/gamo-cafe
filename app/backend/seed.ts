/**
 * The synthetic year behind the §10.7 request budgets (ticket 21): a whole cafe's
 * records — Users, Categories, Items, Customers, Bills with their Lines and
 * Payments, the corrections of §5.7, Adjustments and Counts — as plain SQL
 * that loads into the local D1.
 *
 * `scripts/seed.ts` writes these statements to a file and hands them to
 * Wrangler; `tests/proof-seed.test.ts` sends the same strings to a real D1,
 * so what the tests measure is what the developer loads.
 *
 * Shape the budget test's requests need:
 *
 * - exactly 200 Open Bills in the last hundred Days, so Cuentas abiertas and
 *   a page of Cuentas have something to be measured against;
 * - one Customer holding 30 of them, for Abonar;
 * - one clearly busiest Day, for Día;
 * - every fact table of History with entries inside the last four months, so
 *   a page of Historial finds all six of its branches full;
 * - 60 Items, so a Count of every Item is 60 lines.
 *
 * The generator is a pure function of the Day (a hash seeds each Day's
 * randomness and its ids derive from the Day), so a window of Days is a
 * subset of the year: the budget test loads four months, then appends the
 * older nine, and the same request must read the same rows either way.
 *
 * Projections: every row carries the values the facts imply, and the last
 * statements are the ticket 19 rebuild (`./rebuild.ts`) over those same
 * facts — so a loaded database is consistent by construction and
 * `npm run projections:verify` is the gate that says so.
 */

import { normalizeName } from "../shared/normalize-name.ts";
import { rebuildProjectionStatements } from "./rebuild.ts";

/** The first Day of the synthetic year. */
export const SEED_FROM = "2025-10-01";
/** The last Day of the synthetic year. */
export const SEED_TO = "2026-09-30";
/** The Day the budget test's Día request asks for: clearly busier than any other. */
export const BUSIEST_DAY = "2026-08-15";
/** The Customer with 30 Open Bills, for the Abonar request. */
export const THIRTY_BILL_CUSTOMER_ID = "proof-customer-30";
/** How many Open Bills the seed leaves behind, for Cuentas abiertas. */
export const OPEN_BILLS = 200;

/** One window of Days to generate, and whether its entities come with it. */
export interface SeedWindow {
  readonly from: string;
  readonly to: string;
  /**
   * Whether the Users, Categories, Items and Customers are part of this
   * window. False when appending older history to a database that already
   * has them.
   */
  readonly withEntities: boolean;
}

const DAY_MS = 86_400_000;

const addDays = (day: string, by: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);

const weekDay = (day: string): number => new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay();

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** The instant of a Mexico City wall-clock time on a Day (UTC-6 all year). */
const localInstant = (day: string, seconds: number): number =>
  Date.parse(`${day}T00:00:00-06:00`) + seconds * 1000;

function listDays(from: string, to: string): ReadonlyArray<string> {
  if (to < from) return [];
  const days: string[] = [];
  for (let at = 0; at <= daysBetween(from, to); at++) days.push(addDays(from, at));
  return days;
}

/** FNV-1a: a stable 32-bit hash of a string, the seed of one Day's randomness. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let at = 0; at < text.length; at++) {
    value ^= text.charCodeAt(at);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** Mulberry32: a small deterministic generator, so a Day always repeats. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    /** A whole number in `[low, high]`. */
    int: (low: number, high: number) => low + Math.floor(next() * (high - low + 1)),
    /** One of the items, uniformly. */
    pick: <A>(items: ReadonlyArray<A>): A => items[Math.floor(next() * items.length)]!,
    /** True with this probability. */
    chance: (probability: number) => next() < probability,
  };
}

type Rng = ReturnType<typeof generator>;

// ---------------------------------------------------------------------------
// The entities the year belongs to.
// ---------------------------------------------------------------------------

interface User {
  readonly id: string;
  readonly name: string;
  readonly role: "admin" | "worker";
}

const USERS: ReadonlyArray<User> = [
  { id: "proof-user-ana", name: "Ana", role: "admin" },
  { id: "proof-user-diego", name: "Diego", role: "admin" },
  { id: "proof-user-beto", name: "Beto", role: "worker" },
  { id: "proof-user-carla", name: "Carla", role: "worker" },
];

const ADMINS: ReadonlyArray<User> = USERS.filter((user) => user.role === "admin");

const CATEGORY_NAMES: ReadonlyArray<string> = [
  "Café",
  "Bebidas frías",
  "Refrescos",
  "Pan dulce",
  "Botanas",
  "Dulces",
  "Comida",
  "Desechables",
];

const ITEM_NAMES: ReadonlyArray<ReadonlyArray<string>> = [
  [
    "Café americano",
    "Capuchino",
    "Latte",
    "Espresso doble",
    "Café de olla",
    "Chocolate caliente",
    "Té verde",
    "Té negro",
  ],
  [
    "Café helado",
    "Frappé de café",
    "Frappé de moka",
    "Chocolate frío",
    "Té helado",
    "Limonada",
    "Agua de horchata",
    "Agua de jamaica",
  ],
  [
    "Refresco de cola",
    "Refresco de naranja",
    "Refresco de limón",
    "Agua mineral",
    "Agua natural",
    "Bebida energética",
    "Bebida deportiva",
    "Leche entera",
  ],
  [
    "Concha de vainilla",
    "Concha de chocolate",
    "Cuernito",
    "Oreja",
    "Mantecada",
    "Pan de elote",
    "Polvorón",
    "Puerquito",
  ],
  [
    "Papas saladas",
    "Papas con chile",
    "Cacahuates",
    "Palomitas",
    "Galletas de animalitos",
    "Galletas de chocolate",
    "Barrita de granola",
    "Churritos",
    "Totopos",
    "Nachos",
  ],
  [
    "Paleta de caramelo",
    "Paleta de tamarindo",
    "Chocolate en barra",
    "Gomitas",
    "Mazapán",
    "Cajeta",
    "Chicle",
    "Bombón",
    "Dulce de leche",
    "Obleas",
  ],
  [
    "Sándwich de jamón",
    "Sándwich de pollo",
    "Sándwich vegetariano",
    "Bagel con queso",
    "Sincronizada",
    "Quesadilla",
    "Torta de pavo",
    "Ensalada de frutas",
  ],
];

const CATEGORIES = CATEGORY_NAMES.map((name, at) => ({
  id: `proof-category-${String(at + 1).padStart(2, "0")}`,
  name,
}));

interface Item {
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly price: number;
  readonly categoryId: string;
  readonly minimum: number | null;
}

const ITEMS: ReadonlyArray<Item> = ITEM_NAMES.flat().map((name, at) => ({
  id: `proof-item-${String(at + 1).padStart(2, "0")}`,
  name,
  normalizedName: normalizeName(name),
  // $19.00 to $73.00, drifting up with the Item's place on the menu.
  price: 1900 + (at % 55) * 100,
  categoryId: CATEGORIES[ITEM_NAMES.findIndex((names) => names.includes(name))]!.id,
  minimum: hash(name) % 3 === 0 ? 6 + (hash(name) % 10) : null,
}));

/** The Item ids, in menu order: the first ten are a ten-Item selection. */
export const PROOF_ITEMS: ReadonlyArray<string> = ITEMS.map((item) => item.id);

const CUSTOMER_NAMES: ReadonlyArray<string> = [
  "Familia Aguilar",
  "Familia Bautista",
  "Familia Camacho",
  "Familia Domínguez",
  "Familia Estrada",
  "Familia Fuentes",
  "Familia Galván",
  "Familia Hernández",
  "Familia Ibarra",
  "Familia Jiménez",
  "Familia Lara",
  "Familia Mendoza",
  "Familia Núñez",
  "Familia Ochoa",
  "Familia Peña",
  "Familia Quiroz",
  "Familia Ramírez",
  "Familia Salazar",
  "Familia Tapia",
  "Familia Uribe",
  "Familia Vargas",
  "Familia Zamora",
  "Doña Marta",
  "Don Chuy",
  "Doña Chelo",
  "Don Jacinto",
  "Oficina 3B",
  "Oficina 5A",
  "Taller mecánico",
  "Peluquería Lulú",
  "Consultorio dental",
  "Papelería del centro",
  "Gimnasio Zeus",
  "Panadería vecina",
  "Escuela primaria",
  "Casa de la esquina",
  "Grupo de lectura",
  "Equipo de fútbol",
  "Cocina del turno",
  "Visitas de recepción",
];

const CUSTOMERS = CUSTOMER_NAMES.map((name, at) => ({
  id: `proof-customer-${String(at + 1).padStart(2, "0")}`,
  name,
  normalizedName: normalizeName(name),
}));

/** Every Customer but the one holding the 30 Open Bills. */
const OTHER_CUSTOMERS = CUSTOMERS.filter((customer) => customer.id !== THIRTY_BILL_CUSTOMER_ID);

const NOTES: ReadonlyArray<string> = [
  "Para la mesa 1",
  "Se lo lleva María",
  "Para llevar",
  "Cliente de la mañana",
  "Pago pendiente",
  "Pedido de la oficina",
];

const NOTES_AFTER: ReadonlyArray<string> = [
  "Sin cliente, corregido",
  "Pidió factura después",
  "Se anotó mal",
  "Cuenta del turno",
];

/** The 200 Open Bills live in the last hundred Days of the year. */
const FEATURES_FROM = addDays(SEED_TO, -99);
/** The Customer with 30 Open Bills holds one for each of the last thirty Days. */
const THIRTY_FROM = addDays(SEED_TO, -29);

/** The reasons an Adjustment carries, cycled Day by Day. */
const REASONS = ["restock", "waste", "internal_use"] as const;

// ---------------------------------------------------------------------------
// The rows, as SQL literals, table by table.
// ---------------------------------------------------------------------------

type Cell = string | number | null;

const TABLES = [
  { name: "users", columns: ["id", "name", "role", "active"] },
  { name: "categories", columns: ["id", "name", "position", "retired_at"] },
  {
    name: "items",
    columns: ["id", "name", "normalized_name", "price", "category_id", "stock_tracked", "minimum", "retired_at"],
  },
  {
    name: "customers",
    columns: ["id", "name", "normalized_name", "note", "retired_at", "added_by", "added_at"],
  },
  {
    name: "bills",
    columns: [
      "id",
      "day",
      "opened_by",
      "opened_at",
      "opened_customer_id",
      "opened_note",
      "customer_id",
      "note",
      "total",
      "paid",
      "state",
      "revision",
    ],
  },
  {
    name: "lines",
    columns: [
      "id",
      "bill_id",
      "item_id",
      "quantity",
      "unit_price",
      "moved_stock",
      "added_by",
      "added_at",
      "day",
    ],
  },
  {
    name: "payments",
    columns: ["id", "bill_id", "amount", "method", "handover_reference", "received_by", "received_at", "day"],
  },
  { name: "line_removals", columns: ["id", "line_id", "reason", "removed_by", "removed_at"] },
  { name: "payment_removals", columns: ["id", "payment_id", "reason", "removed_by", "removed_at"] },
  { name: "bill_voids", columns: ["id", "bill_id", "reason", "voided_by", "voided_at"] },
  {
    name: "bill_edits",
    columns: ["id", "bill_id", "field", "previous_value", "new_value", "edited_by", "edited_at"],
  },
  { name: "adjustments", columns: ["id", "item_id", "reason", "units", "note", "recorded_by", "recorded_at", "day"] },
  {
    name: "adjustment_cancellations",
    columns: ["id", "adjustment_id", "cancelled_by", "cancelled_at", "reason"],
  },
  { name: "counts", columns: ["id", "note", "recorded_by", "recorded_at", "day"] },
  { name: "count_lines", columns: ["id", "count_id", "item_id", "units_expected", "units_found"] },
] as const;

type TableName = (typeof TABLES)[number]["name"];

interface SeedData {
  readonly rows: Record<TableName, Cell[][]>;
}

function emptyData(): SeedData {
  return {
    rows: Object.fromEntries(TABLES.map((table) => [table.name, []])) as unknown as Record<TableName, Cell[][]>,
  };
}

// ---------------------------------------------------------------------------
// A Day of records.
// ---------------------------------------------------------------------------

/** The Day's clock, in seconds from midnight; each record takes the next one. */
interface Clock {
  seconds: number;
}

function generateEntities(data: SeedData) {
  for (const user of USERS) data.rows.users.push([user.id, user.name, user.role, 1]);
  CATEGORIES.forEach((category, at) => data.rows.categories.push([category.id, category.name, at + 1, null]));
  for (const item of ITEMS) {
    data.rows.items.push([
      item.id,
      item.name,
      item.normalizedName,
      item.price,
      item.categoryId,
      1,
      item.minimum,
      null,
    ]);
  }
  const addedBy = ADMINS[0]!.id;
  const addedAt = localInstant(SEED_FROM, 7 * 3600);
  for (const customer of CUSTOMERS) {
    data.rows.customers.push([customer.id, customer.name, customer.normalizedName, null, null, addedBy, addedAt]);
  }
}

function generateDay(data: SeedData, day: string) {
  const rng = generator(hash(`gamo-cafe-proof:${day}`));
  const clock: Clock = { seconds: 6 * 3600 };
  /** The next instant of this Day, one second after the one before. */
  const tick = () => localInstant(day, clock.seconds++);

  // Every Item starts the year with more units than a Day sells.
  if (day === SEED_FROM) {
    const at = tick();
    for (const item of ITEMS) {
      data.rows.adjustments.push([
        `proof-adjustment-start-${item.id}`,
        item.id,
        "restock",
        80 + (hash(item.id) % 120),
        null,
        ADMINS[0]!.id,
        at,
        day,
      ]);
    }
  }

  // One Adjustment a day; a little over half are cancelled within the hour.
  const adjustmentId = `proof-adjustment-${day}`;
  const adjustmentItem = ITEMS[hash(day) % ITEMS.length]!;
  const adjustmentAt = tick();
  data.rows.adjustments.push([
    adjustmentId,
    adjustmentItem.id,
    REASONS[hash(day) % REASONS.length]!,
    1 + (hash(`units:${day}`) % 20),
    null,
    rng.chance(0.5) ? ADMINS[0]!.id : ADMINS[1]!.id,
    adjustmentAt,
    day,
  ]);
  if (rng.chance(0.55)) {
    data.rows.adjustment_cancellations.push([
      `proof-cancel-${day}`,
      adjustmentId,
      ADMINS[0]!.id,
      tick(),
      "Se registró por error",
    ]);
  }

  generateBills(data, day, rng, clock, tick);
  generateOpenBills(data, day, rng, clock, tick);
  generateCount(data, day, clock, tick);
}

/** One Bill's worth of Lines, as a Bill's creation writes it. */
interface GeneratedLine {
  readonly id: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

function generateBills(data: SeedData, day: string, rng: Rng, clock: Clock, tick: () => number) {
  const weekend = [5, 6, 0].includes(weekDay(day));
  const ordinary = day === BUSIEST_DAY ? 55 : 6 + (weekend ? 2 : 0) + rng.int(0, 2);

  for (let index = 0; index < ordinary; index++) {
    clock.seconds = 8 * 3600 + index * 600 + rng.int(0, 300);
    const at = tick();
    const author = rng.pick(USERS);
    const createdCustomer = rng.chance(0.35) ? rng.pick(OTHER_CUSTOMERS).id : null;
    const createdNote = createdCustomer === null && rng.chance(0.5) ? rng.pick(NOTES) : null;

    const lines = chosenLines(rng, day, `bill-${index}`, 1 + rng.int(0, 2));
    const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const paymentAt = tick();
    const voided = index % 13 === 7;

    // A Bill's Customer and note may change afterwards; both are Edits.
    let customerId = createdCustomer;
    let note = createdNote;
    const edits: Array<{ field: "customer" | "note"; previous: string | null; next: string | null }> = [];
    if (!voided && index % 7 === 3) {
      const next = rng.pick(NOTES_AFTER);
      edits.push({ field: "note", previous: note, next });
      note = next;
    }
    if (!voided && index % 11 === 5) {
      const next = rng.chance(0.2) ? null : rng.pick(OTHER_CUSTOMERS).id;
      edits.push({ field: "customer", previous: customerId, next });
      customerId = next;
    }

    const billId = `proof-bill-${day}-${index}`;
    data.rows.bills.push([
      billId,
      day,
      author.id,
      at,
      createdCustomer,
      createdNote,
      customerId,
      note,
      total,
      total,
      voided ? "voided" : "paid",
      1 + edits.length,
    ]);
    for (const line of lines) {
      data.rows.lines.push([
        line.id,
        billId,
        line.itemId,
        line.quantity,
        line.unitPrice,
        1,
        author.id,
        at,
        day,
      ]);
    }
    data.rows.payments.push([
      `proof-payment-${day}-${index}`,
      billId,
      total,
      rng.chance(0.5) ? "cash" : "transfer",
      null,
      author.id,
      paymentAt,
      day,
    ]);

    if (voided) {
      data.rows.bill_voids.push([
        `proof-void-${day}-${index}`,
        billId,
        rng.pick(["Se cobró en otra cuenta", "Cliente se arrepintió", "Cuenta de prueba"]),
        rng.pick(ADMINS).id,
        tick(),
      ]);
    }
    for (const edit of edits) {
      data.rows.bill_edits.push([
        `proof-edit-${day}-${index}-${edit.field}`,
        billId,
        edit.field,
        edit.previous,
        edit.next,
        ADMINS[0]!.id,
        tick(),
      ]);
    }
  }
}

/**
 * The 200 Open Bills, two a Day for the last hundred Days. A third carries
 * one partial Payment, a third two (the second corrected away) and a third
 * none; every Bill without a Payment loses a Line to a correction (spec
 * §5.7). One Customer holds the first Bill of each of the last thirty Days.
 */
function generateOpenBills(data: SeedData, day: string, rng: Rng, clock: Clock, tick: () => number) {
  if (day < FEATURES_FROM) return;

  const firstIndex = daysBetween(FEATURES_FROM, day) * 2;
  for (let offset = 0; offset < 2; offset++) {
    const index = firstIndex + offset;
    clock.seconds = 16 * 3600 + index * 30;
    const at = tick();
    const billId = `proof-open-${String(index).padStart(3, "0")}`;
    const withThirty = day >= THIRTY_FROM && offset === 0;
    const customerId = withThirty
      ? THIRTY_BILL_CUSTOMER_ID
      : rng.chance(0.45)
        ? rng.pick(OTHER_CUSTOMERS).id
        : null;
    const note = customerId === null && rng.chance(0.7) ? rng.pick(NOTES) : null;
    const author = rng.pick(USERS);

    const shape = index % 3;
    const lines = chosenLines(rng, day, `open-${index}`, shape === 2 ? 2 : 1 + rng.int(0, 1));
    const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);

    // A removed Line leaves a Bill that owes nothing yet; a removed Payment
    // leaves one that still owes after it.
    const removedLine = shape === 2 ? lines[lines.length - 1]! : undefined;
    const payable = removedLine ? total - removedLine.quantity * removedLine.unitPrice : total;
    const payments: Array<{ id: string; amount: number }> = [];
    if (shape === 0) {
      payments.push({ id: `proof-payment-open-${index}-1`, amount: Math.floor(total / 2) });
    } else if (shape === 1) {
      payments.push(
        { id: `proof-payment-open-${index}-1`, amount: Math.floor(total * 0.3) },
        { id: `proof-payment-open-${index}-2`, amount: Math.floor(total * 0.3) },
      );
    }
    const paid = payments
      .filter((_, position) => !(shape === 1 && position === 1))
      .reduce((sum, payment) => sum + payment.amount, 0);

    data.rows.bills.push([
      billId,
      day,
      author.id,
      at,
      customerId,
      note,
      customerId,
      note,
      payable,
      paid,
      paid === 0 ? "open" : "partial",
      1 + (shape === 1 ? 1 : 0) + (shape === 2 ? 1 : 0),
    ]);
    for (const line of lines) {
      data.rows.lines.push([
        line.id,
        billId,
        line.itemId,
        line.quantity,
        line.unitPrice,
        1,
        author.id,
        at,
        day,
      ]);
    }
    for (const payment of payments) {
      data.rows.payments.push([
        payment.id,
        billId,
        payment.amount,
        rng.chance(0.5) ? "cash" : "transfer",
        null,
        author.id,
        tick(),
        day,
      ]);
    }
    if (shape === 1) {
      data.rows.payment_removals.push([
        `proof-remove-payment-${index}`,
        payments[1]!.id,
        "Se aplicó a otra cuenta",
        rng.pick(ADMINS).id,
        tick(),
      ]);
    }
    if (removedLine) {
      data.rows.line_removals.push([`proof-remove-line-${index}`, removedLine.id, null, rng.pick(USERS).id, tick()]);
    }
  }
}

/** A monthly Count of every Item, with small Discrepancies (spec §5.8). */
function generateCount(data: SeedData, day: string, clock: Clock, tick: () => number) {
  if (!day.endsWith("-01")) return;
  clock.seconds = 20 * 3600;
  const at = tick();
  const countId = `proof-count-${day}`;
  data.rows.counts.push([countId, "Conteo mensual", ADMINS[0]!.id, at, day]);
  for (const item of ITEMS) {
    const expected = 30 + (hash(`count:${day}:${item.id}`) % 90);
    const difference = (hash(`difference:${day}:${item.id}`) % 7) - 3;
    data.rows.count_lines.push([
      `proof-count-line-${day}-${item.id}`,
      countId,
      item.id,
      expected,
      Math.max(0, expected + difference),
    ]);
  }
}

/** One to three distinct Items of the menu, with whole quantities. */
function chosenLines(rng: Rng, day: string, key: string, count: number): ReadonlyArray<GeneratedLine> {
  const chosen: Array<Item> = [];
  while (chosen.length < count) {
    const item = rng.pick(ITEMS);
    if (!chosen.includes(item)) chosen.push(item);
  }
  return chosen.map((item, at) => ({
    id: `proof-line-${day}-${key}-${at}`,
    itemId: item.id,
    quantity: rng.chance(0.25) ? 2 : 1,
    unitPrice: item.price,
  }));
}

// ---------------------------------------------------------------------------
// SQL.
// ---------------------------------------------------------------------------

/** Text as a SQL literal, as `command-line.ts` writes it. */
function text(value: string): string {
  if (value.includes("\0")) throw new Error("text for SQL cannot contain a NUL character");
  return `'${value.replaceAll("'", "''")}'`;
}

const sqlValue = (value: Cell) =>
  value === null ? "NULL" : typeof value === "number" ? String(value) : text(value);

/** How many rows one INSERT carries before another one starts. */
const ROWS_PER_STATEMENT = 100;
/** How long one statement may get, whatever the row count. */
const STATEMENT_LIMIT = 90_000;

function insertStatements(table: (typeof TABLES)[number], rows: ReadonlyArray<ReadonlyArray<Cell>>) {
  const statements: string[] = [];
  let at = 0;
  while (at < rows.length) {
    let end = Math.min(at + ROWS_PER_STATEMENT, rows.length);
    let sql = "";
    for (;;) {
      const values = rows
        .slice(at, end)
        .map((row) => `(${row.map(sqlValue).join(", ")})`)
        .join(", ");
      sql = `INSERT INTO ${table.name} (${table.columns.join(", ")}) VALUES ${values}`;
      if (sql.length <= STATEMENT_LIMIT || end - at === 1) break;
      end = at + Math.max(1, Math.floor((end - at) / 2));
    }
    statements.push(sql);
    at = end;
  }
  return statements;
}

const windowOf = (window?: Partial<SeedWindow>): SeedWindow => ({
  from: window?.from ?? SEED_FROM,
  to: window?.to ?? SEED_TO,
  withEntities: window?.withEntities ?? true,
});

function buildData(window: SeedWindow): SeedData {
  const data = emptyData();
  if (window.withEntities) generateEntities(data);
  for (const day of listDays(window.from, window.to)) generateDay(data, day);
  return data;
}

function emit(data: SeedData): ReadonlyArray<string> {
  const statements: string[] = [];
  for (const table of TABLES) statements.push(...insertStatements(table, data.rows[table.name]));
  // The projections the facts imply, written by the ticket 19 rebuild itself.
  for (const statement of rebuildProjectionStatements) statements.push(statement.sql);
  return statements;
}

/** Every SQL statement of a window, in load order. */
export function seedStatements(window?: Partial<SeedWindow>): ReadonlyArray<string> {
  return emit(buildData(windowOf(window)));
}

/** What the seed holds, for the report `scripts/seed.ts` prints. */
export interface SeedStats {
  /** One count per table of the SQL itself. */
  readonly rows: Readonly<Record<string, number>>;
  readonly statements: number;
  readonly bytes: number;
}

export function seedStats(window?: Partial<SeedWindow>): SeedStats {
  const data = buildData(windowOf(window));
  const statements = emit(data);
  const rows = Object.fromEntries(TABLES.map((table) => [table.name, data.rows[table.name].length]));
  return {
    rows,
    statements: statements.length,
    bytes: new TextEncoder().encode(statements.join(";\n")).length,
  };
}
