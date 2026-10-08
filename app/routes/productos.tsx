import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { Effect } from "effect";
import { Form, Link, useNavigation, useSearchParams } from "react-router";

import {
  addCategory,
  addItem,
  type CatalogCategory,
  type CatalogItem,
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
import { BackLink } from "~/components/back-link";
import { FieldError, FormError, type FormRefusal, refusedField, useFocusOnRefusal } from "~/components/field-error";
import { ChevronDrawing } from "~/components/icons";
import { ItemFields } from "~/components/item-fields";
import { Notice } from "~/components/notice";
import { hint, pageTitle, sectionTitle } from "~/components/styles";
import { SubmitButton } from "~/components/submit-button";
import { Badge } from "~/components/ui/badge";
import { buttonClasses } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { answerWithNotice, takeNotice } from "~/notice.server";
import { formatMoney } from "~/shared/money";
import { useSaidNotice } from "~/shared/notice";

import type { Route } from "./+types/productos";

export const meta: Route.MetaFunction = () => [{ title: "Productos · Gamo Cafe" }];

// Productos (spec §5.1; UI redesign §7): the catalog, which is not where a
// sale is made and says so. The list is every active Category with the Items
// it sells, then the retired Items; no form is on it. Adding an Item, the
// Categories and their order, and one Category's name and retirement are
// steps of the same screen (`?paso=nuevo`, `?paso=categorias`,
// `?paso=categoria&id=…`), each a `<Form>` this page's action answers with a
// notice of what was recorded. An Admin screen: `requireAdminUser` refuses a
// Worker before anything is read, and the operations refuse one again.

const PRODUCTOS = "/productos";

/** Which step of the screen an address asks for. */
type Step =
  | { readonly name: "list" }
  | { readonly name: "new" }
  | { readonly name: "categories" }
  | { readonly name: "category"; readonly id: string };

function stepOf(search: URLSearchParams): Step {
  switch (search.get("paso")) {
    case "nuevo":
      return { name: "new" };
    case "categorias":
      return { name: "categories" };
    case "categoria":
      return { name: "category", id: search.get("id") ?? "" };
    default:
      return { name: "list" };
  }
}

const NEW_ITEM_HREF = `${PRODUCTOS}?paso=nuevo`;
const CATEGORIES_HREF = `${PRODUCTOS}?paso=categorias`;
const categoryHref = (id: string) => `${PRODUCTOS}?${new URLSearchParams({ paso: "categoria", id })}`;

function stepHref(step: Step): string {
  switch (step.name) {
    case "list":
      return PRODUCTOS;
    case "new":
      return NEW_ITEM_HREF;
    case "categories":
      return CATEGORIES_HREF;
    case "category":
      return categoryHref(step.id);
  }
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const categories = await run(context, listCatalog.pipe(Effect.provideService(CurrentUser, admin)), refuseRead);
  const step = stepOf(new URL(request.url).searchParams);
  if (step.name === "category" && !categories.some((category) => category.id === step.id)) {
    throw new Response(null, { status: 404 });
  }
  return { categories, notice: takeNotice(context) };
}

/** The operation a submitted form asks for, answering what to say, or why the form cannot be read. */
function operation(
  form: FormData,
): Effect.Effect<{ readonly said: string }, CatalogError | DbError, Db | CurrentUser> | Refusal {
  const id = text(form, "id");
  switch (text(form, "intent")) {
    case "add-category":
      return addCategory(text(form, "name")).pipe(
        Effect.map((category) => ({ said: `Se agregó la categoría «${category.name}».` })),
      );
    case "rename-category":
      return renameCategory(id, text(form, "name")).pipe(Effect.as({ said: "Nombre guardado." }));
    case "move-category":
      return moveCategory(id, text(form, "direction") === "later" ? "later" : "earlier").pipe(
        Effect.as({ said: "Orden guardado." }),
      );
    case "retire-category":
      return retireCategory(id).pipe(Effect.as({ said: "Categoría retirada." }));
    case "restore-category":
      return restoreCategory(id).pipe(Effect.as({ said: "Categoría restaurada." }));
    case "add-item": {
      const item = parseItemForm(form);
      if ("error" in item) return item;
      const startingStock = parseStartingStock(form);
      if ("error" in startingStock) return startingStock;
      return addItem({ ...item.value, startingStock: startingStock.value }).pipe(
        // Starting Stock is an Entrada only for an Item that counts its units,
        // and it is said only once the Item and the Entrada were recorded.
        Effect.map((added) => ({
          said:
            added.stockTracked && startingStock.value > 0
              ? `Se agregó «${added.name}». Se registró una entrada de ${startingStock.value} en existencias.`
              : `Se agregó «${added.name}».`,
        })),
      );
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

  const result = await run(context, asked.pipe(Effect.provideService(CurrentUser, admin)), answerCatalogError);
  if ("error" in result) return refused(result, formKey);
  // Recorded: the request that sent the form is answered with the notice,
  // which names the form, so it starts over (spec §3.4, ticket 34). A
  // document POST lands on the step it was sent from.
  const here = stepHref(stepOf(new URL(request.url).searchParams));
  return answerWithNotice(request, here, { form: formKey, message: result.said });
}

type Heading = RefObject<HTMLHeadingElement | null>;

/** The `id` of what the last recorded form said. */
const RECORDED = "recorded";
/** How the form that moves a Category is keyed, before the Category's id. */
const MOVED = "move-category:";

/** How many, in words: "1 producto", "3 productos". */
const itemsText = (count: number) => (count === 1 ? "1 producto" : `${count} productos`);

const activeItems = (category: CatalogCategory) => category.items.filter((item) => !item.retired);

export default function Productos({ loaderData, actionData }: Route.ComponentProps) {
  const { categories, notice: landingNotice } = loaderData;
  const [search] = useSearchParams();
  const step = stepOf(search);

  const refusal: FormRefusal | undefined = actionData && "error" in actionData ? actionData : undefined;
  useFocusOnRefusal(refusal);
  /** The refusal, for the form it was sent from. */
  const refusalOf = (form: string) => (refusal?.form === form ? refusal : undefined);
  // The answer of the form that was just recorded, or the notice a document
  // POST left for the loader (spec §3.4, ticket 34).
  const answered = actionData && "notice" in actionData ? actionData.notice : null;
  const notice = answered ?? landingNotice;
  const recorded = notice?.message ? (
    <div id={RECORDED} tabIndex={-1} className="rounded-2xl outline-none">
      <Notice tone="success">{notice.message}</Notice>
    </div>
  ) : null;
  // A form that was just recorded starts over, empty. It is keyed by the last
  // form recorded, not by the last answer: a refusal that follows keeps what
  // was typed.
  const [last] = useSaidNotice(landingNotice, answered);
  const fresh = (form: string) => (last?.form === form ? last.id : form);
  // A Category that moved keeps the keyboard on its own buttons. Every other
  // recorded form starts over or gives way to another, and took its button
  // with it: the keyboard goes to what was said.
  const moved = answered?.form?.startsWith(MOVED) ? { id: answered.form.slice(MOVED.length), at: answered.id } : null;
  useEffect(() => {
    if (answered && !moved) document.getElementById(RECORDED)?.focus();
  }, [answered?.id]);

  // A new step takes the keyboard and the screen reader to its heading.
  const heading = useRef<HTMLHeadingElement>(null);
  const view = stepHref(step);
  const shown = useRef(view);
  useEffect(() => {
    if (shown.current === view) return;
    shown.current = view;
    heading.current?.focus({ preventScroll: true });
  }, [view]);

  const active = categories.filter((category) => !category.retired);
  const category = step.name === "category" ? categories.find((known) => known.id === step.id) : undefined;

  if (step.name === "new") {
    return (
      <NewItem
        categories={active}
        heading={heading}
        refusal={refusalOf("add-item:")}
        recorded={recorded}
        formKey={fresh("add-item:")}
      />
    );
  }
  if (step.name === "categories") {
    return (
      <Categories
        active={active}
        retired={categories.filter((known) => known.retired)}
        heading={heading}
        refusal={refusalOf("add-category:")}
        // A refusal of a form that has no place of its own to say it: a move.
        unplaced={refusal && refusal.form !== "add-category:" ? refusal.error : null}
        moved={moved}
        recorded={recorded}
        formKey={fresh("add-category:")}
      />
    );
  }
  if (category) {
    const renaming = `rename-category:${category.id}`;
    return (
      <Category
        category={category}
        heading={heading}
        renameRefusal={refusalOf(renaming)}
        stateRefusal={refusal && refusal.form !== renaming ? refusal.error : null}
        recorded={recorded}
      />
    );
  }
  return <Catalog active={active} categories={categories} heading={heading} recorded={recorded} />;
}

/** The catalog: each active Category with what it sells, then the retired Items. */
function Catalog({
  active,
  categories,
  heading,
  recorded,
}: {
  readonly active: ReadonlyArray<CatalogCategory>;
  readonly categories: ReadonlyArray<CatalogCategory>;
  readonly heading: Heading;
  readonly recorded: ReactNode;
}) {
  const retired = categories.flatMap((category) =>
    category.items.filter((item) => item.retired).map((item) => ({ item, category })),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 ref={heading} tabIndex={-1} className={`${pageTitle} wrap-anywhere outline-none`}>
          Productos
        </h1>
        <p className={hint}>
          El catálogo: qué se vende, a qué precio y en qué categoría. Las ventas se registran en{" "}
          <Link to="/" className="font-medium text-foreground underline underline-offset-4">
            Vender
          </Link>
          .
        </p>
      </div>
      {recorded}

      <div className="flex flex-col gap-3">
        <Link to={NEW_ITEM_HREF} className={buttonClasses({ size: "touch" })}>
          Agregar producto
        </Link>
        <Link to={CATEGORIES_HREF} className={buttonClasses({ variant: "outline", size: "touch" })}>
          Categorías
        </Link>
      </div>

      {active.length === 0 ? (
        <p className={hint}>Todavía no hay categorías. Agrega una en Categorías y después sus productos.</p>
      ) : null}

      {active.map((category) => {
        const items = activeItems(category);
        const headingId = `category-${category.id}`;
        return (
          <section key={category.id} aria-labelledby={headingId} className="flex flex-col gap-3">
            <h2 id={headingId} className={`${sectionTitle} wrap-anywhere`}>
              {category.name}
            </h2>
            {items.length === 0 ? (
              <p className={hint}>Sin productos.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {items.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {retired.length > 0 ? (
        <section aria-labelledby="retirados" className="flex flex-col gap-3 border-t pt-6">
          <h2 id="retirados" className={sectionTitle}>
            Productos retirados
          </h2>
          <p className={hint}>No aparecen en Vender. Sus ventas y su inventario se conservan.</p>
          <ul className="flex flex-col gap-3">
            {retired.map(({ item, category }) => (
              <ItemRow key={item.id} item={item} categoryName={category.name} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** An Item as the catalog lists it: its name, what it is in words, its price, and the way into its page. */
function ItemRow({ item, categoryName }: { readonly item: CatalogItem; readonly categoryName?: string }) {
  const facts = [
    categoryName ?? null,
    item.stockTracked ? (item.minimum === null ? "Lleva inventario" : `Mínimo ${item.minimum}`) : "Sin inventario",
  ].filter((fact) => fact !== null);

  return (
    <li>
      <Link to={`${PRODUCTOS}/${item.id}`} className="block rounded-2xl">
        <Card size="sm" className="transition-colors hover:bg-muted/60 active:bg-muted">
          <CardContent className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="max-w-full min-w-0 text-xl font-semibold wrap-anywhere">{item.name}</span>
                {item.retired ? <Badge variant="secondary">Retirado</Badge> : null}
              </span>
              <span className="flex max-w-full min-w-0 flex-wrap items-baseline gap-x-3">
                <span className="max-w-full min-w-0 font-heading text-xl font-semibold wrap-anywhere tabular-nums">
                  {formatMoney(item.price)}
                </span>{" "}
                <span className={`min-w-0 wrap-anywhere ${hint}`}>{facts.join(" · ")}</span>
              </span>
            </span>
            <ChevronDrawing className="size-5 shrink-0" />
          </CardContent>
        </Card>
      </Link>
    </li>
  );
}

/** The step that adds an Item. It stays after each one, ready for the next. */
function NewItem({
  categories,
  heading,
  refusal,
  recorded,
  formKey,
}: {
  readonly categories: ReadonlyArray<CatalogCategory>;
  readonly heading: Heading;
  readonly refusal: FormRefusal | undefined;
  readonly recorded: ReactNode;
  readonly formKey: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <BackLink to={PRODUCTOS} label="Productos" />
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} wrap-anywhere outline-none`}>
        Agregar producto
      </h1>
      {recorded}

      {categories.length === 0 ? (
        <>
          <p>Un producto va en una categoría, y todavía no hay ninguna.</p>
          <Link to={CATEGORIES_HREF} className={buttonClasses({ size: "touch" })}>
            Agregar una categoría
          </Link>
        </>
      ) : (
        <Form method="post" key={formKey} className="flex flex-col gap-6">
          <input type="hidden" name="intent" value="add-item" />
          <ItemFields categories={categories} refusal={refusal} />
          <FormError refusal={refusal} />
          <SubmitButton pendingLabel="Agregando…" className={buttonClasses({ size: "touch" })}>
            Agregar producto
          </SubmitButton>
        </Form>
      )}
    </div>
  );
}

/** The step of the Categories: their order on Vender, a new one, and the retired ones. */
function Categories({
  active,
  retired,
  heading,
  refusal,
  unplaced,
  moved,
  recorded,
  formKey,
}: {
  readonly active: ReadonlyArray<CatalogCategory>;
  readonly retired: ReadonlyArray<CatalogCategory>;
  readonly heading: Heading;
  /** What the form that adds a Category was refused for. */
  readonly refusal: FormRefusal | undefined;
  /** What another form of the step was refused for. */
  readonly unplaced: string | null;
  /** The Category that was just moved, and the answer that said so. */
  readonly moved: { readonly id: string; readonly at: string } | null;
  readonly recorded: ReactNode;
  readonly formKey: string;
}) {
  // The button that moved a Category takes the keyboard back by itself
  // (`SubmitButton`), unless the move took the Category to an end of the
  // list, where that button is disabled: then the Category's other button
  // takes it, once the new order is on the page.
  const list = useRef<HTMLOListElement>(null);
  const idle = useNavigation().state === "idle";
  const movedTo = moved ? active.findIndex((category) => category.id === moved.id) : -1;
  const atAnEnd = movedTo === 0 || movedTo === active.length - 1;
  useEffect(() => {
    if (!idle || !atAnEnd) return;
    // A browser may leave a button that became disabled as the active element; nothing can be done from it.
    const focused = document.activeElement;
    const stranded = focused === null || focused === document.body || focused.matches(":disabled");
    if (stranded) list.current?.children[movedTo]?.querySelector<HTMLButtonElement>("button:enabled")?.focus();
  }, [moved?.at, idle]);

  const move = (category: CatalogCategory, direction: "earlier" | "later", label: string, disabled: boolean) => (
    // The list stays where it is: only the order changes.
    <Form method="post" preventScrollReset className="flex-1">
      <input type="hidden" name="intent" value="move-category" />
      <input type="hidden" name="id" value={category.id} />
      <input type="hidden" name="direction" value={direction} />
      <SubmitButton
        disabled={disabled}
        aria-label={`${label} ${category.name}`}
        className={`${buttonClasses({ variant: "outline", size: "touch" })} w-full`}
      >
        {label}
      </SubmitButton>
    </Form>
  );

  return (
    <div className="flex flex-col gap-6">
      <BackLink to={PRODUCTOS} label="Productos" />
      <div className="flex flex-col gap-2">
        <h1 ref={heading} tabIndex={-1} className={`${pageTitle} wrap-anywhere outline-none`}>
          Categorías
        </h1>
        <p className={hint}>Agrupan los productos en Vender, en este orden. Una sin productos no aparece ahí.</p>
      </div>
      {recorded}
      {unplaced ? <Notice tone="error">{unplaced}</Notice> : null}

      {active.length === 0 ? (
        <p className={hint}>Todavía no hay categorías.</p>
      ) : (
        <ol ref={list} aria-label="Categorías" className="flex flex-col gap-3">
          {active.map((category, index) => (
            <li key={category.id} aria-label={category.name}>
              <Card size="sm">
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xl font-semibold wrap-anywhere">{category.name}</span>
                    <span className={hint}>
                      {`${index + 1} de ${active.length} · ${itemsText(activeItems(category).length)}`}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {move(category, "earlier", "Subir", index === 0)}
                    {move(category, "later", "Bajar", index === active.length - 1)}
                  </div>
                  <Link
                    to={categoryHref(category.id)}
                    className="flex min-h-12 items-center justify-between gap-3 border-t pt-2 font-medium"
                  >
                    <span className="min-w-0 wrap-break-word">Cambiar nombre o retirar</span>
                    <ChevronDrawing className="size-5 shrink-0" />
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}

      <section aria-labelledby="nueva-categoria" className="flex flex-col gap-4 border-t pt-6">
        <h2 id="nueva-categoria" className={sectionTitle}>
          Nueva categoría
        </h2>
        <Form method="post" key={formKey} preventScrollReset className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="add-category" />
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Nombre de la categoría</Label>
            <Input id="name" name="name" required maxLength={40} autoComplete="off" {...refusedField(refusal, "name")} />
            <FieldError refusal={refusal} field="name" />
          </div>
          <FormError refusal={refusal} />
          <SubmitButton pendingLabel="Agregando…" className={buttonClasses({ variant: "outline", size: "touch" })}>
            Agregar categoría
          </SubmitButton>
        </Form>
      </section>

      {retired.length > 0 ? (
        <section aria-labelledby="categorias-retiradas" className="flex flex-col gap-3 border-t pt-6">
          <h2 id="categorias-retiradas" className={sectionTitle}>
            Categorías retiradas
          </h2>
          <ul className="flex flex-col gap-3">
            {retired.map((category) => (
              <li key={category.id}>
                <Link to={categoryHref(category.id)} className="block rounded-2xl">
                  <Card size="sm" className="transition-colors hover:bg-muted/60 active:bg-muted">
                    <CardContent className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="max-w-full min-w-0 text-xl font-semibold wrap-anywhere">{category.name}</span>
                        <Badge variant="secondary">Retirada</Badge>
                      </span>
                      <ChevronDrawing className="size-5 shrink-0" />
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** The step of one Category: its name, and retiring or restoring it. */
function Category({
  category,
  heading,
  renameRefusal,
  stateRefusal,
  recorded,
}: {
  readonly category: CatalogCategory;
  readonly heading: Heading;
  readonly renameRefusal: FormRefusal | undefined;
  /** What retiring or restoring it was refused for. */
  readonly stateRefusal: string | null;
  readonly recorded: ReactNode;
}) {
  const inUse = activeItems(category).length;

  return (
    <div className="flex flex-col gap-6">
      <BackLink to={CATEGORIES_HREF} label="Categorías" />
      <div className="flex flex-col gap-2">
        <h1 ref={heading} tabIndex={-1} className={`${pageTitle} wrap-anywhere outline-none`}>
          {category.name}
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge variant={category.retired ? "secondary" : "outline"}>
            {category.retired ? "Categoría retirada" : "Categoría"}
          </Badge>
          <span className={hint}>{itemsText(inUse)} en Vender</span>
        </p>
      </div>
      {recorded}

      {/* Keyed by what is stored, so the field shows it after saving. */}
      <Form key={category.name} method="post" className="flex flex-col gap-4">
        <input type="hidden" name="intent" value="rename-category" />
        <input type="hidden" name="id" value={category.id} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Nombre de la categoría</Label>
          <Input
            id="name"
            name="name"
            required
            maxLength={40}
            defaultValue={category.name}
            autoComplete="off"
            {...refusedField(renameRefusal, "name")}
          />
          <FieldError refusal={renameRefusal} field="name" />
        </div>
        <FormError refusal={renameRefusal} />
        <SubmitButton pendingLabel="Guardando…" className={buttonClasses({ size: "touch" })}>
          Guardar nombre
        </SubmitButton>
      </Form>

      <section aria-labelledby="estado" className="flex flex-col gap-3 border-t pt-6">
        <h2 id="estado" className={sectionTitle}>
          {category.retired ? "Restaurar categoría" : "Retirar categoría"}
        </h2>
        {stateRefusal ? <Notice tone="error">{stateRefusal}</Notice> : null}
        {category.retired ? (
          <>
            <p>
              Está retirada: no se le pueden agregar productos y los suyos no se pueden restaurar. Al restaurarla
              vuelve al lugar que tenía en el orden.
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value="restore-category" />
              <input type="hidden" name="id" value={category.id} />
              <SubmitButton
                pendingLabel="Restaurando…"
                className={`${buttonClasses({ variant: "outline", size: "touch" })} w-full`}
              >
                Restaurar categoría
              </SubmitButton>
            </Form>
          </>
        ) : inUse > 0 ? (
          <p>
            {`Tiene ${inUse === 1 ? "1 producto activo" : `${inUse} productos activos`}. Para retirarla, primero retira ${inUse === 1 ? "ese producto o cámbialo" : "esos productos o cámbialos"} de categoría.`}
          </p>
        ) : (
          <>
            <p>Al retirarla ya no se le pueden agregar productos. Nada se borra, y se puede restaurar después.</p>
            <Form method="post">
              <input type="hidden" name="intent" value="retire-category" />
              <input type="hidden" name="id" value={category.id} />
              <SubmitButton
                pendingLabel="Retirando…"
                className={`${buttonClasses({ variant: "outline", size: "touch" })} w-full`}
              >
                Retirar categoría
              </SubmitButton>
            </Form>
          </>
        )}
      </section>
    </div>
  );
}
