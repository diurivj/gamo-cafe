import { useId, useState } from "react";

import { changeFor, type Centavos, formatMoney, parsePesos } from "~/shared/money";
import { PAYMENT_METHODS, paymentMethodLabel, type PaymentMethod } from "~/shared/payment";

const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg";

/**
 * The fields of taking a Payment (spec §5.5, §6.1): the method, an amount that
 * defaults to the selection's total (**Cobrar** on Vender) or to what the Bill
 * still owes (Cuenta) and may be less, and, for cash, the amount handed over
 * with the change it makes.
 *
 * The amount handed over is not stored, so its field carries no name and the
 * change is only shown. The amount field is named `amount` and the method
 * `method`; the form's action reads them.
 */
export function PaymentFields({
  defaultAmount,
  initialAmount = "",
  initialMethod = "cash",
  amountHint,
}: {
  /** Centavos an empty amount field pays. */
  readonly defaultAmount: Centavos;
  /** What the amount field starts with. Empty means an empty field is the default. */
  readonly initialAmount?: string;
  /** The method it starts with. */
  readonly initialMethod?: PaymentMethod;
  readonly amountHint: string;
}) {
  const [method, setMethod] = useState<PaymentMethod>(initialMethod);
  const [amountText, setAmountText] = useState(initialAmount);
  const [handedText, setHandedText] = useState("");
  const amountId = useId();
  const amountHintId = useId();
  const handedId = useId();

  const amount = amountText.trim() === "" ? defaultAmount : parsePesos(amountText);
  const handedOver = handedText.trim() === "" ? undefined : parsePesos(handedText);
  const change = amount === undefined || handedOver === undefined ? undefined : changeFor(handedOver, amount);

  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Método</legend>
        <div className="grid grid-cols-2 gap-2">
          {PAYMENT_METHODS.map((value) => (
            <label
              key={value}
              className="flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-3"
            >
              <input
                type="radio"
                name="method"
                value={value}
                checked={method === value}
                onChange={() => setMethod(value)}
              />
              <span>{paymentMethodLabel[value]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor={amountId} className="font-medium">
          Monto
        </label>
        <input
          id={amountId}
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          value={amountText}
          onChange={(event) => setAmountText(event.target.value)}
          placeholder={formatMoney(defaultAmount)}
          aria-describedby={amountHintId}
          className={field}
        />
        <span id={amountHintId} className="text-sm text-stone-600">
          {amountHint}
        </span>
      </div>

      {method === "cash" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={handedId} className="font-medium">
            Efectivo entregado (opcional)
          </label>
          <input
            id={handedId}
            inputMode="decimal"
            autoComplete="off"
            value={handedText}
            onChange={(event) => setHandedText(event.target.value)}
            className={field}
          />
          {change !== undefined ? (
            <span aria-live="polite" className={change < 0 ? "text-sm text-red-700" : "text-sm text-stone-600"}>
              {change < 0 ? "Lo entregado no alcanza para el pago." : `Cambio: ${formatMoney(change)}`}
            </span>
          ) : handedText.trim() === "" ? (
            <span className="text-sm text-stone-600">Para mostrar el cambio.</span>
          ) : (
            <span className="text-sm text-red-700">Escribe un monto válido.</span>
          )}
        </div>
      ) : null}
    </>
  );
}
