import { useId } from "react";

import { hint } from "~/components/styles";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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
          className="grid-cols-1 @[20rem]:grid-cols-2"
        >
          {PAYMENT_METHODS.map((method) => (
            // The whole card is the target; the one that is on has a heavier
            // edge and words as well as the filled mark.
            <Label
              key={method}
              className="min-h-14 min-w-0 cursor-pointer gap-3 rounded-2xl border border-input wrap-anywhere bg-background px-4 py-3 has-data-checked:border-foreground has-data-checked:bg-muted has-data-checked:font-semibold has-data-checked:ring-1 has-data-checked:ring-foreground"
            >
              <RadioGroupItem value={method} />
              {paymentMethodLabel[method]}
            </Label>
          ))}
        </RadioGroup>
      </div>

      {value.partial ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-amount`}>Monto a cobrar</Label>
          <Input
            id={`${id}-amount`}
            inputMode="decimal"
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
          <Input
            id={`${id}-handed`}
            inputMode="decimal"
            autoComplete="off"
            value={value.handedText}
            onChange={(event) => onChange({ ...value, handedText: event.target.value })}
            aria-invalid={reading.handedProblem ? true : undefined}
            aria-describedby={`${id}-change`}
          />
          {/* Announced when it changes, without taking the keyboard from the field. */}
          <p id={`${id}-change`} aria-live="polite" className={reading.handedProblem ? "font-medium text-destructive" : hint}>
            {reading.change !== null ? (
              <>
                Cambio:{" "}
                <b className="font-heading text-2xl font-semibold text-foreground tabular-nums">{formatMoney(reading.change)}</b>
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
