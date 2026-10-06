import { Effect } from "effect";
import { Form, Link, redirect, useNavigation } from "react-router";

import { getItem, listCatalog, restoreItem, retireItem, updateItem } from "~/backend/catalog";
import { CurrentUser } from "~/backend/current-user";
import type { Db, DbError } from "~/backend/db";
import { run } from "~/backend/run.server";
import {
  answerCatalogError,
  type CatalogError,
  parseItemForm,
  type Refusal,
  refuseRead,
  refused,
  requireAdminUser,
  text,
} from "~/catalog-forms.server";
import { ItemFields } from "~/components/item-fields";

import type { Route } from "./+types/producto";

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `${loaderData?.item.name ?? "Producto"} · Gamo Cafe` },
];

const PRODUCTOS = "/productos";

export async function loader({ context, params }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const { item, catalog } = await run(
    context,
    Effect.all({ item: getItem(params.itemId), catalog: listCatalog }).pipe(
      Effect.provideService(CurrentUser, admin),
    ),
    refuseRead,
  );
  return {
    item,
    // Where the Item may be: an active Category, or the one it is in.
    categories: catalog
      .filter((category) => !category.retired || category.id === item.categoryId)
      .map(({ id, name }) => ({ id, name })),
  };
}

/** The operation a submitted form asks for, or why the form cannot be read. */
function operation(
  itemId: string,
  form: FormData,
): Effect.Effect<unknown, CatalogError | DbError, Db | CurrentUser> | Refusal {
  switch (text(form, "intent")) {
    case "update-item": {
      const change = parseItemForm(form);
      return "error" in change ? change : updateItem(itemId, change.value);
    }
    case "retire-item":
      return retireItem(itemId);
    case "restore-item":
      return restoreItem(itemId);
    default:
      return { error: "No entendimos esa acción. Recarga la página e intenta de nuevo." };
  }
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const admin = requireAdminUser(context);
  const form = await request.formData();
  const intent = text(form, "intent");

  const asked = operation(params.itemId, form);
  if (!Effect.isEffect(asked)) return refused(asked, intent);

  const result = await run(
    context,
    asked.pipe(Effect.as({ done: true } as const), Effect.provideService(CurrentUser, admin)),
    answerCatalogError,
  );
  if ("error" in result) return refused(result, intent);
  if (intent === "update-item") throw redirect(PRODUCTOS);
  return result;
}

const button = "rounded-xl border border-stone-300 bg-white px-4 py-3 font-medium disabled:opacity-60";
const primaryButton = "rounded-xl bg-stone-900 px-4 py-3 font-semibold text-white disabled:opacity-60";

export default function Producto({ loaderData, actionData }: Route.ComponentProps) {
  const { item, categories } = loaderData;
  const busy = useNavigation().state !== "idle";
  const errorOn = (form: string) =>
    actionData && "error" in actionData && actionData.form === form ? actionData.error : undefined;
  const saveError = errorOn("update-item");
  const stateError = errorOn("restore-item") ?? errorOn("retire-item");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to={PRODUCTOS} className="inline-block py-2 font-medium text-stone-600 underline">
          Productos
        </Link>
        <h1 className="break-words text-3xl font-semibold tracking-tight">{item.name}</h1>
        {item.retired ? <p className="mt-1 text-lg text-stone-600">Retirado: no aparece en Vender.</p> : null}
      </div>

      <Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="intent" value="update-item" />
        <ItemFields categories={categories} item={item} />
        {saveError ? (
          <p role="alert" className="text-red-700">
            {saveError}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={primaryButton}>
          Guardar
        </button>
      </Form>

      <Form method="post" className="flex flex-col gap-3 border-t border-stone-200 pt-6">
        <input type="hidden" name="intent" value={item.retired ? "restore-item" : "retire-item"} />
        <p className="text-stone-600">
          {item.retired
            ? "Al restaurarlo vuelve a aparecer en Vender."
            : "Al retirarlo deja de aparecer en Vender. Sus ventas y su inventario se conservan, y se puede restaurar."}
        </p>
        {stateError ? (
          <p role="alert" className="text-red-700">
            {stateError}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={button}>
          {item.retired ? "Restaurar producto" : "Retirar producto"}
        </button>
      </Form>
    </div>
  );
}
