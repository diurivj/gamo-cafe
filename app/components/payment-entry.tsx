import { useId } from "react";

import { CashDrawing, TransferDrawing } from "~/components/icons";
import { MoneyInput } from "~/components/money-input";
import { amount, hint } from "~/components/styles";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { type Centavos, formatMoney } from "~/shared/money";
import { PAYMENT_METHODS, paymentMethodLabel, type PaymentMethod } from "~/shared/payment";
import { type PaymentDraft, readPaymentDraft } from "~/shared/payment-draft";

interface Props {
  /** The Payment as typed so far; the screen keeps it. */
  readonly value: PaymentDraft;
  readonly onChange: (value: PaymentDraft) => void;
  /** Centavos that pay everything: the selection's total, or what a Bill owes. */
  readonly full: Centavos;
  /** What a part larger than `full` is told (`~/shared/payment-messages`). */
  readonly tooMuch: string;
  /** Whether to say that a part has not been typed yet: after a tap on the action, not before. */
  readonly insist?: boolean;
}

/**
 * How a Payment is entered (UI redesign §5.2): Efectivo or Transferencia,
 * everything by default or a part, and for cash the change for what was
 * handed over. The screen holds the `PaymentDraft` and reads what it pays
 * with `readPaymentDraft`, which is also what this shows:
 *
 *     const [payment, setPayment] = useState(NEW_PAYMENT);
 *     <PaymentEntry value={payment} onChange={setPayment} full={total} tooMuch={paymentMessages.PaymentExceedsSelection} />
 *
 * The cash handed over only computes the change. It is not the Payment's
 * amount and is never sent or stored (spec §5.5).
 */
export function PaymentEntry({ value, onChange, full, tooMuch, insist = false }: Props) {
  const id = useId();
  const reading = readPaymentDraft(value, full, tooMuch);
  // An empty part is only a problem once the User tried to record it.
  const amountProblem = value.amountText.trim() === "" && !insist ? null : reading.amountProblem;

  return (
    <div className="flex flex-col gap-5">
      <div className="@container flex flex-col gap-2">
        <span id={`${id}-method`} className="text-lg font-medium">
          Forma de pago
        </span>
        <RadioGroup
          aria-labelledby={`${id}-method`}
          value={value.method}
          onValueChange={(method) => onChange({ ...value, method: method as PaymentMethod })}
          // Side by side where both fit; one under the other with large text.
          className="grid-cols-1 @[18rem]:grid-cols-2"
        >
          {PAYMENT_METHODS.map((method) => {
            const Drawing = method === "cash" ? CashDrawing : TransferDrawing;
            return (
              // The whole card is the target; the one that is on has a heavier
              // edge and words as well as the filled mark. The drawing sits over
              // the words, so "Transferencia" keeps its line on a narrow phone.
              <Label
                key={method}
                className="min-h-14 min-w-0 cursor-pointer flex-col items-start gap-3 rounded-2xl border border-input bg-card px-4 py-3.5 wrap-anywhere shadow-[0_1px_2px_rgb(31_26_23/0.05)] transition-[background-color,border-color,box-shadow] duration-150 has-data-checked:border-foreground has-data-checked:bg-[color-mix(in_oklch,var(--card),var(--brand)_6%)] has-data-checked:font-semibold has-data-checked:ring-1 has-data-checked:ring-foreground"
              >
                <span className="flex w-full items-center justify-between gap-3">
                  <Drawing className="size-7" />
                  <RadioGroupItem value={method} />
                </span>
                {paymentMethodLabel[method]}
              </Label>
            );
          })}
        </RadioGroup>
      </div>

      {value.partial ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-amount`}>Monto a cobrar</Label>
          <MoneyInput
            id={`${id}-amount`}
            autoComplete="off"
            autoFocus
            value={value.amountText}
            onChange={(event) => onChange({ ...value, amountText: event.target.value })}
            aria-invalid={amountProblem ? true : undefined}
            aria-describedby={`${id}-amount-hint`}
          />
          <p id={`${id}-amount-hint`} role={amountProblem ? "alert" : undefined} className={amountProblem ? "font-medium text-destructive" : hint}>
            {amountProblem ?? `De ${formatMoney(full)}. El resto queda por cobrar.`}
          </p>
          <Button type="button" variant="outline" size="touch" onClick={() => onChange({ ...value, partial: false })}>
            Cobrar todo
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="touch" onClick={() => onChange({ ...value, partial: true })}>
          Cobrar solo una parte
        </Button>
      )}

      {value.method === "cash" ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-handed`}>Efectivo que te entregan (opcional)</Label>
          <MoneyInput
            id={`${id}-handed`}
            autoComplete="off"
            value={value.handedText}
            onChange={(event) => onChange({ ...value, handedText: event.target.value })}
            aria-invalid={reading.handedProblem ? true : undefined}
            aria-describedby={`${id}-change`}
          />
          {/* Announced when it changes, without taking the keyboard from the field. */}
          <p
            id={`${id}-change`}
            aria-live="polite"
            className={
              reading.handedProblem
                ? "font-medium text-destructive"
                : reading.change !== null
                  ? "flex flex-wrap items-baseline justify-between gap-x-3 rounded-2xl bg-success-soft px-4 py-3 font-medium text-success"
                  : hint
            }
          >
            {reading.change !== null ? (
              <>
                Cambio:{" "}
                <b className={`text-[1.75rem] leading-tight font-semibold tracking-[-0.01em] text-foreground ${amount}`}>
                  {formatMoney(reading.change)}
                </b>
              </>
            ) : (
              (reading.handedProblem ?? "Solo para calcular el cambio. No se guarda.")
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
