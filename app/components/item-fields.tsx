import { formatMoney } from "~/shared/money";

const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3";

interface Props {
  /** The Categories an Item may be put in. */
  readonly categories: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** The Item being changed; none for a new Item. */
  readonly item?: {
    readonly name: string;
    readonly price: number;
    readonly categoryId: string;
    readonly stockTracked: boolean;
    readonly minimum: number | null;
  };
}

/**
 * The fields an Item has, new or existing, as `parseItemForm` reads them:
 * `name`, `price` in pesos, `categoryId`, `stockTracked` and `minimum`.
 */
export function ItemFields({ categories, item }: Props) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Nombre</span>
        <input name="name" required maxLength={60} defaultValue={item?.name} autoComplete="off" className={field} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">Precio</span>
        <input
          name="price"
          required
          inputMode="decimal"
          placeholder="18.50"
          defaultValue={item ? formatMoney(item.price).replace("$", "") : undefined}
          autoComplete="off"
          className={field}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">Categoría</span>
        <select name="categoryId" required defaultValue={item?.categoryId} className={field}>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-start gap-3 py-1">
        <input
          type="checkbox"
          name="stockTracked"
          defaultChecked={item?.stockTracked ?? true}
          className="mt-1 size-6 shrink-0"
        />
        <span>
          <span className="block font-medium">Lleva inventario</span>
          <span className="block text-sm text-stone-600">
            Desmárcalo para lo que se prepara al momento, como un café o un sándwich.
          </span>
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">Mínimo</span>
        <input
          name="minimum"
          inputMode="numeric"
          defaultValue={item?.minimum ?? undefined}
          autoComplete="off"
          className={field}
        />
        <span className="text-sm text-stone-600">Opcional. Con estas unidades o menos, se marca para resurtir.</span>
      </label>
    </>
  );
}
