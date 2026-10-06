import { Effect } from "effect";
import { Form, Link } from "react-router";

import {
  addCategory,
  addItem,
  type CatalogCategory,
  listCatalog,
  moveCategory,
  renameCategory,
  restoreCategory,
  retireCategory,
} from "~/backend/catalog";
import { CurrentUser } from "~/backend/current-user";
import type { Db, DbError } from "~/backend/db";
import { run } from "~/backend/run.server";
import {
  answerCatalogError,
  type CatalogError,
  parseItemForm,
  parseStartingStock,
  type Refusal,
  refuseRead,
  refused,
  requireAdminUser,
  text,
} from "~/catalog-forms.server";
import { ItemFields } from "~/components/item-fields";
import { SubmitButton } from "~/components/submit-button";
import { redirectWithFlash, takeFlash } from "~/flash.server";
import { formatMoney } from "~/shared/money";

import type { Route } from "./+types/productos";

export const meta: Route.MetaFunction = () => [{ title: "Productos · Gamo Cafe" }];

export async function loader({ context }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const categories = await run(context, listCatalog.pipe(Effect.provideService(CurrentUser, admin)), refuseRead);
  return { categories, flash: takeFlash(context) };
}

/** The operation a submitted form asks for, or why the form cannot be read. */
function operation(form: FormData): Effect.Effect<unknown, CatalogError | DbError, Db | CurrentUser> | Refusal {
  const id = text(form, "id");
  switch (text(form, "intent")) {
    case "add-category":
      return addCategory(text(form, "name"));
    case "rename-category":
      return renameCategory(id, text(form, "name"));
    case "move-category":
      return moveCategory(id, text(form, "direction") === "later" ? "later" : "earlier");
    case "retire-category":
      return retireCategory(id);
    case "restore-category":
      return restoreCategory(id);
    case "add-item": {
      const item = parseItemForm(form);
      if ("error" in item) return item;
      const startingStock = parseStartingStock(form);
      if ("error" in startingStock) return startingStock;
      return addItem({ ...item.value, startingStock: startingStock.value });
    }
    default:
      return { error: "No entendimos esa acción. Recarga la página e intenta de nuevo." };
  }
}

export async function action({ context, request }: Route.ActionArgs) {
  const admin = requireAdminUser(context);
  const form = await request.formData();
  // Which form on the page this is, so a refusal is shown on it.
  const formKey = `${text(form, "intent")}:${text(form, "id")}`;

  const asked = operation(form);
  if (!Effect.isEffect(asked)) return refused(asked, formKey);

  const result = await run(
    context,
    asked.pipe(Effect.as({ done: true } as const), Effect.provideService(CurrentUser, admin)),
    answerCatalogError,
  );
  if ("error" in result) return refused(result, formKey);
  // Recorded: a redirect back to the page, so a reload or the back button
  // records nothing again (spec §3.4). It names the form, which starts over.
  return redirectWithFlash("/productos", { form: formKey });
}

const button = "rounded-xl border border-stone-300 bg-white px-4 py-3 font-medium disabled:opacity-60";
const primaryButton = "rounded-xl bg-stone-900 px-4 py-3 font-semibold text-white disabled:opacity-60";
const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3";

function Refused({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="text-red-700">
      {message}
    </p>
  ) : null;
}

export default function Productos({ loaderData, actionData }: Route.ComponentProps) {
  const { categories, flash } = loaderData;

  const active = categories.filter((category) => !category.retired);
  const retired = categories.filter((category) => category.retired);
  const errorOn = (form: string) =>
    actionData && "error" in actionData && actionData.form === form ? actionData.error : undefined;
  // A form that was just recorded starts over, empty.
  const fresh = (form: string) => (flash?.form === form ? flash.id : form);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight">Productos</h1>

      <details className="rounded-2xl border border-stone-200 bg-white p-4">
        <summary className="cursor-pointer py-3 text-lg font-semibold">Nuevo producto</summary>
        {active.length === 0 ? (
          <p className="mt-3 text-stone-600">Primero agrega una categoría.</p>
        ) : (
          <Form method="post" key={fresh("add-item:")} className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="intent" value="add-item" />
            <ItemFields categories={active} />
            <label className="flex flex-col gap-1">
              <span className="font-medium">Existencias iniciales</span>
              <input name="startingStock" inputMode="numeric" autoComplete="off" className={field} />
              <span className="text-sm text-stone-600">
                Las unidades que hay hoy. Se registran como una entrada a tu nombre.
              </span>
            </label>
            <Refused message={errorOn("add-item:")} />
            <SubmitButton className={primaryButton}>
              Agregar producto
            </SubmitButton>
          </Form>
        )}
      </details>

      {active.length === 0 ? <p className="text-lg text-stone-600">Todavía no hay categorías.</p> : null}

      {active.map((category, index) => (
        <CategorySection
          key={category.id}
          category={category}
          first={index === 0}
          last={index === active.length - 1}
          error={
            errorOn(`rename-category:${category.id}`) ??
            errorOn(`retire-category:${category.id}`) ??
            errorOn(`move-category:${category.id}`)
          }
        />
      ))}

      <section aria-labelledby="new-category" className="rounded-2xl border border-stone-200 bg-white p-4">
        <h2 id="new-category" className="text-lg font-semibold">
          Nueva categoría
        </h2>
        <Form method="post" key={fresh("add-category:")} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="intent" value="add-category" />
          <label className="flex flex-col gap-1">
            <span className="font-medium">Nombre de la categoría</span>
            <input name="name" required maxLength={40} autoComplete="off" className={field} />
          </label>
          <Refused message={errorOn("add-category:")} />
          <SubmitButton className={button}>
            Agregar categoría
          </SubmitButton>
        </Form>
      </section>

      {retired.length > 0 ? (
        <section aria-labelledby="retired-categories">
          <h2 id="retired-categories" className="text-lg font-semibold text-stone-600">
            Categorías retiradas
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {retired.map((category) => (
              <li key={category.id} className="rounded-2xl border border-dashed border-stone-300 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 break-words font-medium text-stone-600">{category.name}</p>
                  <Form method="post">
                    <input type="hidden" name="intent" value="restore-category" />
                    <input type="hidden" name="id" value={category.id} />
                    <SubmitButton aria-label={`Restaurar ${category.name}`} className={button}>
                      Restaurar
                    </SubmitButton>
                  </Form>
                </div>
                <Items category={category} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function CategorySection(props: {
  category: CatalogCategory;
  first: boolean;
  last: boolean;
  error: string | undefined;
}) {
  const { category, first, last, error } = props;
  const headingId = `category-${category.id}`;

  const act = (intent: string, label: string, extra?: { direction: string; disabled: boolean }) => (
    <Form method="post">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="id" value={category.id} />
      {extra ? <input type="hidden" name="direction" value={extra.direction} /> : null}
      <SubmitButton
        disabled={extra?.disabled}
        aria-label={`${label} ${category.name}`}
        className={button}
      >
        {label}
      </SubmitButton>
    </Form>
  );

  return (
    <section aria-labelledby={headingId} className="rounded-2xl border border-stone-200 bg-white p-4">
      <h2 id={headingId} className="break-words text-xl font-semibold">
        {category.name}
      </h2>

      <Items category={category} />

      <Refused message={error} />

      <details className="mt-4">
        <summary className="cursor-pointer py-3 font-medium text-stone-600">Cambiar categoría</summary>
        <div className="mt-2 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {act("move-category", "Subir", { direction: "earlier", disabled: first })}
            {act("move-category", "Bajar", { direction: "later", disabled: last })}
            {act("retire-category", "Retirar")}
          </div>
          <Form method="post" className="flex flex-col gap-2">
            <input type="hidden" name="intent" value="rename-category" />
            <input type="hidden" name="id" value={category.id} />
            <label className="flex flex-col gap-1">
              <span className="font-medium">Nombre de la categoría</span>
              <input
                name="name"
                required
                maxLength={40}
                defaultValue={category.name}
                autoComplete="off"
                className={field}
              />
            </label>
            <SubmitButton className={button}>
              Guardar nombre
            </SubmitButton>
          </Form>
        </div>
      </details>
    </section>
  );
}

function Items({ category }: { category: CatalogCategory }) {
  if (category.items.length === 0) {
    return <p className="mt-2 text-stone-600">Sin productos.</p>;
  }
  return (
    <ul className="mt-2 divide-y divide-stone-200">
      {category.items.map((item) => (
        <li key={item.id}>
          <Link to={`/productos/${item.id}`} className="flex items-center justify-between gap-3 py-3">
            <span className="min-w-0">
              <span className={`block break-words font-medium ${item.retired ? "text-stone-500" : ""}`}>
                {item.name}
              </span>
              <span className="block text-sm text-stone-600">
                {[
                  item.retired ? "Retirado" : null,
                  item.stockTracked ? null : "Sin inventario",
                  item.minimum === null ? null : `Mínimo ${item.minimum}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{formatMoney(item.price)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
