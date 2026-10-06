import { data, type RouterContextProvider } from "react-router";

import type {
  CategoryHasActiveItems,
  CategoryNotFound,
  CategoryUnavailable,
  InvalidPrice,
  InvalidUnits,
  ItemChange,
  ItemNameTaken,
  ItemNotFound,
  NameMissing,
} from "~/backend/catalog";
import type { AdminOnly } from "~/backend/current-user";
import { requireUser } from "~/session.server";
import { parsePesos } from "~/shared/money";
import { parseUnits } from "~/shared/units";

/**
 * What the two Productos routes share: who gets in, how an Item's form is
 * read, and what each rule violation answers.
 */

/**
 * The signed-in Admin, or a 403 before anything else happens. The operations
 * check again with `requireAdmin`; this only makes sure a Worker is refused
 * before a form is even read.
 */
export function requireAdminUser(context: Readonly<RouterContextProvider>) {
  const user = requireUser(context);
  if (user.role !== "admin") throw forbidden();
  return user;
}

const forbidden = () => new Response(null, { status: 403 });

/** What cannot be done, in words for the Admin who asked. */
export interface Refusal {
  readonly error: string;
}

/**
 * A refusal as an action answers it: a 400 carrying the message and the key of
 * the form that was sent, so the page shows the message on that form.
 */
export function refused({ error }: Refusal, form: string) {
  return data({ error, form }, { status: 400 });
}

export type CatalogError =
  | AdminOnly
  | NameMissing
  | InvalidPrice
  | InvalidUnits
  | ItemNameTaken
  | CategoryUnavailable
  | CategoryHasActiveItems
  | ItemNotFound
  | CategoryNotFound;

/**
 * The answer to each rule violation of `~/backend/catalog`, for `run`: a 403,
 * a 404, or the Spanish message to show on the form.
 */
export function answerCatalogError(error: CatalogError): Refusal {
  switch (error._tag) {
    case "AdminOnly":
      throw forbidden();
    case "ItemNotFound":
    case "CategoryNotFound":
      throw new Response(null, { status: 404 });
    case "NameMissing":
      return { error: "Escribe un nombre." };
    case "InvalidPrice":
      return { error: "El precio debe ser mayor a cero." };
    case "InvalidUnits":
      return { error: unitsMessage[error.field] };
    case "ItemNameTaken":
      return { error: "Ya hay un producto activo con ese nombre." };
    case "CategoryUnavailable":
      return { error: "Esa categoría no existe o está retirada." };
    case "CategoryHasActiveItems":
      return { error: "Esta categoría tiene productos activos. Retíralos o cámbialos de categoría primero." };
  }
}

/** For a loader, which has no form to show a message on: a 403 or a 404. */
export function refuseRead(error: AdminOnly | ItemNotFound): never {
  throw error._tag === "AdminOnly" ? forbidden() : new Response(null, { status: 404 });
}

const unitsMessage = {
  minimum: "El mínimo debe ser un número entero, cero o más.",
  startingStock: "Las existencias iniciales deben ser un número entero, cero o más.",
} as const;

export const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

type Parsed<A> = { readonly value: A } | Refusal;

/**
 * Reads the fields of an Item's form: the price typed in pesos becomes
 * centavos, an empty Minimum is no Minimum, an unticked box is "not
 * stock-tracked". What cannot be read is answered here; what breaks a rule is
 * left to the operation.
 */
export function parseItemForm(form: FormData): Parsed<ItemChange> {
  const price = parsePesos(text(form, "price"));
  if (price === undefined) return { error: "Escribe el precio en pesos, por ejemplo 18.50." };

  const minimum = optionalUnits(text(form, "minimum"));
  if (minimum === undefined) return { error: unitsMessage.minimum };

  return {
    value: {
      name: text(form, "name"),
      price,
      categoryId: text(form, "categoryId"),
      stockTracked: form.get("stockTracked") !== null,
      minimum,
    },
  };
}

/** The starting Stock of a new Item: an empty field is none. */
export function parseStartingStock(form: FormData): Parsed<number> {
  const units = optionalUnits(text(form, "startingStock"));
  if (units === undefined) return { error: unitsMessage.startingStock };
  return { value: units ?? 0 };
}

/** Units, `null` for an empty field, `undefined` for anything unreadable. */
function optionalUnits(typed: string): number | null | undefined {
  return typed.trim() === "" ? null : parseUnits(typed);
}
