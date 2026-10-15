import type { ComponentProps } from "react";

import { Input } from "./ui/input";

/**
 * A field for an amount of money: an `Input` with a "$" at its start, so it
 * reads as pesos before anything is typed, and the phone's keyboard of
 * numbers with a point. The "$" is only a drawing: what is typed is the
 * amount ("18.50"), and `parsePesos` takes it with or without one. Its label
 * is the screen's, as for any field.
 *
 *     <Label htmlFor="price">Precio</Label>
 *     <MoneyInput id="price" name="price" defaultValue={typed} />
 */
export function MoneyInput({ className = "", ...props }: Omit<ComponentProps<typeof Input>, "type" | "inputMode">) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-4.5 -translate-y-1/2 text-lg text-muted-foreground"
      >
        $
      </span>
      <Input inputMode="decimal" {...props} className={`pl-9 figures ${className}`} />
    </div>
  );
}
