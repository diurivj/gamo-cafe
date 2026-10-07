import { useEffect, useId, useRef, useState } from "react";

import { Notice } from "~/components/notice";
import { hint } from "~/components/styles";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { loader } from "~/routes/resources/customer-picker";
import { normalizeName } from "~/shared/normalize-name";

/** Where the picker's resource route lives (app/routes.ts). */
const PICKER_PATH = "/clientes/selector";

/** What that route answers a search and an addition with. */
type Found = Awaited<ReturnType<typeof loader>>;
type Added = { readonly customer: PickedCustomer } | { readonly error: string };

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
 * It talks to its own resource route with the browser's own `fetch`, so the
 * host route needs no loader or action for it, and a search that gets no
 * answer says so here instead of replacing the screen it sits on and
 * whatever that screen holds unsent. It renders no `<form>` of its own, so it can sit inside
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
  const [picked, setPicked] = useState<PickedCustomer | null>(defaultValue);
  const [typed, setTyped] = useState("");
  // The last search that was answered, and whether one is on its way.
  const [found, setFound] = useState<Found | null>(null);
  const [searching, setSearching] = useState(false);
  // What was typed when a search got no answer: asked again only when told to.
  const [unanswered, setUnanswered] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Why the name last sent to be added was not, shown while it is still what is typed.
  const [refused, setRefused] = useState<{ readonly name: string; readonly error: string } | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  function choose(customer: PickedCustomer | null) {
    setPicked(customer);
    setTyped("");
    setRefused(null);
    onChangeRef.current?.(customer);
  }

  const wanted = normalizeName(typed);
  // An answer counts only if it is for what is typed now.
  const matches = wanted !== "" && found?.q === wanted ? found.customers : null;

  // One search in flight at a time: when it lands and is not for what is typed
  // by then, ask again. Searches started together can land in any order, so
  // asking on every keystroke would let an older answer be the last one.
  useEffect(() => {
    if (picked || wanted === "" || searching || found?.q === wanted || unanswered === wanted) return;
    setSearching(true);
    fetch(`${PICKER_PATH}?q=${encodeURIComponent(wanted)}`)
      .then((response) => (response.ok ? (response.json() as Promise<Found>) : Promise.reject(response)))
      .then(setFound, () => setUnanswered(wanted))
      .finally(() => setSearching(false));
  }, [picked, wanted, searching, found, unanswered]);

  async function add() {
    const name = typed;
    setAdding(true);
    setRefused(null);
    try {
      const response = await fetch(PICKER_PATH, { method: "POST", body: new URLSearchParams({ name }) });
      const answer = (await response.json()) as Added;
      // The Customer just added is the one chosen.
      if ("customer" in answer) choose({ id: answer.customer.id, name: answer.customer.name });
      else setRefused({ name, error: answer.error });
    } catch {
      setRefused({ name, error: "No se pudo agregar. Revisa la conexión e intenta de nuevo." });
    } finally {
      setAdding(false);
    }
  }

  const taken = matches?.some((customer) => normalizeName(customer.name) === wanted) ?? false;
  const refusal = refused && refused.name === typed && !adding ? refused.error : null;

  if (picked) {
    return (
      <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-2">
        <span id={`${id}-label`} className="text-lg font-medium">
          {label}
        </span>
        <input type="hidden" name={name} value={picked.id} />
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-input bg-background py-1 pr-1 pl-5">
          <span className="min-w-0 text-lg font-medium wrap-break-word">{picked.name}</span>
          <Button type="button" variant="outline" size="touch" onClick={() => choose(null)} className="shrink-0 px-4">
            Quitar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <input type="hidden" name={name} value="" />
      <Input
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
      />

      {wanted !== "" ? (
        <ul aria-label="Coincidencias" className="flex flex-col gap-2">
          {matches?.map((customer) => (
            <li key={customer.id}>
              <Button
                type="button"
                variant="outline"
                size="touch"
                onClick={() => choose({ id: customer.id, name: customer.name })}
                className="w-full flex-col items-start gap-0 text-left"
              >
                <span className="font-medium wrap-break-word">{customer.name}</span>
                {customer.note ? <span className="text-muted-foreground wrap-break-word">{customer.note}</span> : null}
              </Button>
            </li>
          ))}
          {matches === null && unanswered !== wanted ? <li className={`px-1 ${hint}`}>Buscando…</li> : null}
          {matches === null && unanswered === wanted ? (
            <li className="flex flex-col gap-2">
              <Notice tone="error">No se pudo buscar. Revisa la conexión.</Notice>
              <Button type="button" variant="outline" size="touch" onClick={() => setUnanswered(null)}>
                Buscar de nuevo
              </Button>
            </li>
          ) : null}
          {matches !== null && !taken ? (
            <li>
              <Button
                type="button"
                variant="outline"
                size="touch"
                disabled={adding}
                onClick={() => void add()}
                className="w-full justify-start border-dashed text-left"
              >
                {adding ? "Agregando…" : `Agregar «${typed.trim()}»`}
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}

      {refusal ? (
        <Notice tone="error" id={`${id}-error`}>
          {refusal}
        </Notice>
      ) : null}
    </div>
  );
}
