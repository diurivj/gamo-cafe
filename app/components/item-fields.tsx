import { formatMoney } from "~/shared/money";

import { FieldError, type FormRefusal, refusedField } from "./field-error";
import { MoneyInput } from "./money-input";
import { hint } from "./styles";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

interface Props {
  /** The Categories an Item may be put in. */
  readonly categories: ReadonlyArray<{ readonly id: string; readonly name: string; readonly retired?: boolean }>;
  /** The Item being changed; none for a new Item. */
  readonly item?: {
    readonly name: string;
    readonly price: number;
    readonly categoryId: string;
    readonly stockTracked: boolean;
    readonly minimum: number | null;
  };
  /** What the form was refused for, said on the field it is about. */
  readonly refusal?: FormRefusal;
}

/**
 * The fields an Item has, new or existing, as `parseItemForm` reads them:
 * `name`, `price` in pesos, `categoryId`, `stockTracked` and `minimum`, and
 * for a new Item `startingStock`. Each field's `id` is its `name`.
 *
 * A change to an existing Item says what it does not reach: Lines already
 * recorded keep their price, and Stock already recorded stays as it is.
 */
export function ItemFields({ categories, item, refusal }: Props) {
  return (
    <div className="group/item flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Nombre</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={60}
          defaultValue={item?.name}
          autoComplete="off"
          {...refusedField(refusal, "name")}
        />
        <FieldError refusal={refusal} field="name" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="price">Precio</Label>
        <MoneyInput
          id="price"
          name="price"
          required
          defaultValue={item ? formatMoney(item.price).replace("$", "") : undefined}
          autoComplete="off"
          {...refusedField(refusal, "price", "price-hint")}
        />
        <p id="price-hint" className={hint}>
          {item
            ? "En pesos. Un precio nuevo vale para lo que se venda desde ahora: lo ya vendido conserva el suyo."
            : "En pesos, por ejemplo 18.50."}
        </p>
        <FieldError refusal={refusal} field="price" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="categoryId">Categoría</Label>
        <NativeSelect
          id="categoryId"
          name="categoryId"
          required
          defaultValue={item?.categoryId}
          {...refusedField(refusal, "categoryId")}
        >
          {categories.map((category) => (
            <NativeSelectOption key={category.id} value={category.id}>
              {category.retired ? `${category.name} (retirada)` : category.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldError refusal={refusal} field="categoryId" />
      </div>

      <div className="flex flex-col gap-2">
        {/* The browser's own box, so it is ticked without a script; the label is the 48px target. */}
        <Label htmlFor="stockTracked" className="min-h-12 gap-3">
          <input
            id="stockTracked"
            type="checkbox"
            name="stockTracked"
            defaultChecked={item?.stockTracked ?? true}
            aria-describedby="stockTracked-hint"
            className="size-6 shrink-0 accent-primary"
          />
          Lleva inventario
        </Label>
        <p id="stockTracked-hint" className={hint}>
          {item
            ? "Sus unidades se cuentan en Inventario. Cambiarlo no modifica las existencias ni los movimientos ya registrados."
            : "Sus unidades se cuentan en Inventario. Desmárcalo para lo que se prepara al momento, como un café o un sándwich."}
        </p>
      </div>

      {/* Only for an Item that counts its units, and whenever one of them is what was refused. */}
      <div className="hidden flex-col gap-5 group-has-[#stockTracked:checked]/item:flex has-[[aria-invalid=true]]:flex">
        <div className="flex flex-col gap-2">
          <Label htmlFor="minimum">Mínimo (opcional)</Label>
          <Input
            id="minimum"
            name="minimum"
            inputMode="numeric"
            defaultValue={item?.minimum ?? undefined}
            autoComplete="off"
            {...refusedField(refusal, "minimum", "minimum-hint")}
          />
          <p id="minimum-hint" className={hint}>
            Con estas unidades o menos, Inventario lo marca para reponer.
          </p>
          <FieldError refusal={refusal} field="minimum" />
        </div>

        {item ? null : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="startingStock">Existencias iniciales (opcional)</Label>
            <Input
              id="startingStock"
              name="startingStock"
              inputMode="numeric"
              autoComplete="off"
              {...refusedField(refusal, "startingStock", "startingStock-hint")}
            />
            <p id="startingStock-hint" className={hint}>
              Las unidades que hay hoy. Se registran como una entrada a tu nombre.
            </p>
            <FieldError refusal={refusal} field="startingStock" />
          </div>
        )}
      </div>
    </div>
  );
}
