import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";

import type { action, loader } from "~/routes/resources/customer-picker";
import { normalizeName } from "~/shared/normalize-name";

/** Where the picker's resource route lives (app/routes.ts). */
const PICKER_PATH = "/clientes/selector";

export interface PickedCustomer {
  readonly id: string;
  readonly name: string;
}

export interface CustomerPickerProps {
  /** The form field that carries the chosen Customer's id; `""` when none is chosen. */
  readonly name?: string;
  /** The Customer already chosen when the screen opens. */
  readonly defaultValue?: PickedCustomer | null;
  /** The visible label. */
  readonly label?: string;
  /** Told about every choice, for a screen that keeps it in its own state. */
  readonly onChange?: (customer: PickedCustomer | null) => void;
}

/**
 * Chooses a Customer for a Bill: search as the name is typed, matches first,
 * and "add new" when no active Customer has the name (spec §5.2, §6.1).
 *
 * It is a form field. Put it inside any route's `<Form>` and read the chosen
 * id in that route's action:
 *
 *     <Form method="post">
 *       <CustomerPicker name="customerId" defaultValue={bill.customer} />
 *     </Form>
 *
 *     const customerId = String(form.get("customerId") ?? "") || null;
 *
 * It talks to its own resource route, so the host route needs no loader or
 * action for it, and it renders no `<form>` of its own, so it can sit inside
 * one. Retired Customers are never offered. The host's action still has to
 * check the id it receives.
 */
export function CustomerPicker({
  name = "customerId",
  defaultValue = null,
  label = "Cliente",
  onChange,
}: CustomerPickerProps) {
  const id = useId();
  const search = useFetcher<typeof loader>();
  const add = useFetcher<typeof action>();
  const [picked, setPicked] = useState<PickedCustomer | null>(defaultValue);
  const [typed, setTyped] = useState("");
  // The name last sent to be added, so its refusal is shown only while it is still what is typed.
  const [sent, setSent] = useState<string | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  function choose(customer: PickedCustomer | null) {
    setPicked(customer);
    setTyped("");
    setSent(null);
    onChangeRef.current?.(customer);
  }

  // The Customer just added is the one chosen.
  const added = add.data && "customer" in add.data ? add.data.customer : null;
  useEffect(() => {
    if (added) choose({ id: added.id, name: added.name });
    // Keyed by the id: each answer is acted on once, when it arrives.
  }, [added?.id]);

  const wanted = normalizeName(typed);
  // An answer counts only if it is for what is typed now.
  const answered = search.data?.q;
  const matches = wanted !== "" && answered === wanted ? search.data!.customers : null;

  // One search in flight at a time: when it lands and is not for what is typed
  // by then, ask again. Loads started together can land in any order, so
  // asking on every keystroke would let an older answer be the last one.
  const searching = search.state !== "idle";
  const load = search.load;
  useEffect(() => {
    if (picked || wanted === "" || searching || answered === wanted) return;
    void load(`${PICKER_PATH}?q=${encodeURIComponent(wanted)}`);
  }, [picked, wanted, searching, answered, load]);

  const taken = matches?.some((customer) => normalizeName(customer.name) === wanted) ?? false;
  const adding = add.state !== "idle";
  const refusal = add.data && "error" in add.data && sent === typed && !adding ? add.data.error : null;

  if (picked) {
    return (
      <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-2">
        <span id={`${id}-label`} className="font-medium">
          {label}
        </span>
        <input type="hidden" name={name} value={picked.id} />
        <div className="flex items-center justify-between gap-3 rounded-xl border border-stone-300 bg-white py-2 pl-4 pr-2">
          <span className="min-w-0 truncate text-lg font-medium">
            {picked.name}
          </span>
          <button
            type="button"
            onClick={() => choose(null)}
            className="shrink-0 rounded-lg border border-stone-300 px-4 py-2 font-medium"
          >
            Quitar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input type="hidden" name={name} value="" />
      <input
        id={id}
        type="search"
        value={typed}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={80}
        placeholder="Buscar o agregar cliente"
        aria-describedby={refusal ? `${id}-error` : undefined}
        onChange={(event) => setTyped(event.target.value)}
        // Enter would send the form the picker sits in.
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
        className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg"
      />

      {wanted !== "" ? (
        <ul aria-label="Coincidencias" className="flex flex-col gap-2">
          {matches?.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                onClick={() => choose({ id: customer.id, name: customer.name })}
                className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-left"
              >
                <span className="block truncate text-lg font-medium">{customer.name}</span>
                {customer.note ? <span className="block truncate text-stone-600">{customer.note}</span> : null}
              </button>
            </li>
          ))}
          {matches === null ? <li className="px-1 text-stone-600">Buscando…</li> : null}
          {matches !== null && !taken ? (
            <li>
              <button
                type="button"
                disabled={adding}
                onClick={() => {
                  setSent(typed);
                  void add.submit({ name: typed }, { method: "post", action: PICKER_PATH });
                }}
                className="w-full rounded-xl border border-dashed border-stone-400 px-4 py-3 text-left text-lg font-medium disabled:opacity-60"
              >
                {adding ? "Agregando…" : `Agregar «${typed.trim()}»`}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}

      {refusal ? (
        <p id={`${id}-error`} role="alert" className="text-red-700">
          {refusal}
        </p>
      ) : null}
    </div>
  );
}
