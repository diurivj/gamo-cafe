import { useEffect } from "react";
import { Effect } from "effect";
import { Form, Link } from "react-router";

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
import { BackLink } from "~/components/back-link";
import { FormError, type FormRefusal, useFocusOnRefusal } from "~/components/field-error";
import { ChevronDrawing } from "~/components/icons";
import { ItemFields } from "~/components/item-fields";
import { Notice } from "~/components/notice";
import { pageTitle, sectionTitle } from "~/components/styles";
import { SubmitButton } from "~/components/submit-button";
import { Badge } from "~/components/ui/badge";
import { buttonClasses } from "~/components/ui/button";
import { answerWithNotice, takeNotice } from "~/notice.server";
import { adjustHref } from "~/shared/stock-change";

import type { Route } from "./+types/producto";

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `${loaderData?.item.name ?? "Producto"} · Gamo Cafe` },
];

// Producto (spec §5.1; UI redesign §7): one Item of the catalog. Its fields
// say what a change does not reach — Lines keep the price they were recorded
// with, and Stock already recorded stays — and retiring or restoring says
// what it does before its button. Every form is answered on this page with
// what was recorded. Stock itself is not changed here: Inventario does that.

const PRODUCTOS = "/productos";
/** The `id` of what the last recorded form said. */
const RECORDED = "recorded";

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
      .map(({ id, name, retired }) => ({ id, name, retired })),
    notice: takeNotice(context),
  };
}

/** The operation a submitted form asks for, answering what to say, or why the form cannot be read. */
function operation(
  itemId: string,
  form: FormData,
): Effect.Effect<{ readonly said: string }, CatalogError | DbError, Db | CurrentUser> | Refusal {
  switch (text(form, "intent")) {
    case "update-item": {
      const change = parseItemForm(form);
      return "error" in change ? change : updateItem(itemId, change.value).pipe(Effect.as({ said: "Cambios guardados." }));
    }
    case "retire-item":
      return retireItem(itemId).pipe(Effect.as({ said: "Producto retirado. Ya no aparece en Vender." }));
    case "restore-item":
      return restoreItem(itemId).pipe(Effect.as({ said: "Producto restaurado. Ya aparece en Vender." }));
    default:
      return { error: "No entendimos esa acción. Recarga la página e intenta de nuevo." };
  }
}

/** What stands in the way of restoring an Item, and what to do about it. */
function answerRestoreError(error: CatalogError): Refusal {
  switch (error._tag) {
    case "ItemNameTaken":
      return { error: "Otro producto activo ya se llama así. Cambia el nombre de uno de los dos y vuelve a restaurarlo." };
    case "CategoryUnavailable":
      return { error: "Su categoría está retirada. Restaura la categoría o guarda el producto en otra, y vuelve a restaurarlo." };
    case "AdminOnly":
    case "ItemNotFound":
    case "CategoryNotFound":
    case "NameMissing":
    case "InvalidPrice":
    case "InvalidUnits":
    case "CategoryHasActiveItems":
      return answerCatalogError(error);
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
    asked.pipe(Effect.provideService(CurrentUser, admin)),
    intent === "restore-item" ? answerRestoreError : answerCatalogError,
  );
  if ("error" in result) return refused(result, intent);
  // Recorded: the Item's own page says so, with the Item as it is now.
  return answerWithNotice(request, `${PRODUCTOS}/${params.itemId}`, { form: intent, message: result.said });
}

export default function Producto({ loaderData, actionData }: Route.ComponentProps) {
  const { item, categories, notice: landingNotice } = loaderData;
  const refusal: FormRefusal | undefined = actionData && "error" in actionData ? actionData : undefined;
  const saveRefusal = refusal?.form === "update-item" ? refusal : undefined;
  useFocusOnRefusal(saveRefusal);
  const stateRefusal = refusal && refusal.form !== "update-item" ? refusal.error : null;
  const answered = actionData && "notice" in actionData ? actionData.notice : null;
  const notice = answered ?? landingNotice;
  // Saved fields start over with what is stored, and took their button with
  // them: the keyboard goes to what was said. Retiring and restoring keep
  // theirs, which takes it back by itself (`SubmitButton`).
  useEffect(() => {
    if (answered?.form === "update-item") document.getElementById(RECORDED)?.focus();
  }, [answered?.id]);
  // An Item cannot be restored into a retired Category: said before it is tried.
  const categoryRetired = categories.some((category) => category.id === item.categoryId && category.retired);

  return (
    <div className="flex flex-col gap-6">
      <BackLink to={PRODUCTOS} label="Productos" />
      <div className="flex flex-col gap-2">
        <h1 className={`${pageTitle} wrap-anywhere`}>{item.name}</h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge variant={item.retired ? "secondary" : "outline"}>{item.retired ? "Retirado" : "Activo"}</Badge>
          <span>{item.retired ? "No aparece en Vender." : "Aparece en Vender."}</span>
        </p>
      </div>
      {notice?.message ? (
        <div id={RECORDED} tabIndex={-1} className="rounded-2xl outline-none">
          <Notice tone="success">{notice.message}</Notice>
        </div>
      ) : null}

      {/* Keyed by what is stored, so the fields show it after saving. */}
      <Form
        key={[item.name, item.price, item.categoryId, item.stockTracked, item.minimum].join("\n")}
        method="post"
        className="flex flex-col gap-6"
      >
        <input type="hidden" name="intent" value="update-item" />
        <ItemFields categories={categories} item={item} refusal={saveRefusal} />
        <FormError refusal={saveRefusal} />
        <SubmitButton pendingLabel="Guardando…" className={buttonClasses({ size: "touch" })}>
          Guardar cambios
        </SubmitButton>
      </Form>

      {item.stockTracked ? (
        <Link
          to={adjustHref({ itemId: item.id })}
          className="flex min-h-12 items-center justify-between gap-3 border-t pt-4 font-medium"
        >
          <span className="min-w-0 wrap-break-word">Ver o ajustar sus existencias en Inventario</span>
          <ChevronDrawing className="size-5 shrink-0" />
        </Link>
      ) : null}

      <section aria-labelledby="estado" className="flex flex-col gap-3 border-t pt-6">
        <h2 id="estado" className={sectionTitle}>
          {item.retired ? "Restaurar producto" : "Retirar producto"}
        </h2>
        {stateRefusal ? <Notice tone="error">{stateRefusal}</Notice> : null}
        {item.retired && categoryRetired ? (
          <p>
            Su categoría está retirada. Para restaurarlo, primero restaura la categoría en Categorías, o guárdalo
            aquí en otra.
          </p>
        ) : (
          <>
            <p>
              {item.retired
                ? "Al restaurarlo vuelve a aparecer en Vender, con el precio y la categoría que tiene aquí."
                : "Al retirarlo deja de aparecer en Vender. Sus ventas y sus movimientos de inventario se conservan, y se puede restaurar después."}
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value={item.retired ? "restore-item" : "retire-item"} />
              <SubmitButton
                pendingLabel={item.retired ? "Restaurando…" : "Retirando…"}
                className={`${buttonClasses({ variant: "outline", size: "touch" })} w-full`}
              >
                {item.retired ? "Restaurar producto" : "Retirar producto"}
              </SubmitButton>
            </Form>
          </>
        )}
      </section>
    </div>
  );
}
