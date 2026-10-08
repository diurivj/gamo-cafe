import { hint } from "~/components/styles";
import { Badge } from "~/components/ui/badge";
import type { CountLine } from "~/shared/count";
import { discrepancyText } from "~/shared/discrepancy";

/**
 * One line of a Count as Conteo and Diferencias show it: the Item, the Stock
 * expected when it was read, the units found and the Discrepancy in words
 * (spec §5.8): Faltante, Sobrante or Sin diferencia.
 *
 *     <ul className="flex flex-col divide-y">
 *       {lines.map((line) => <CountLineItem key={line.itemId} line={line} />)}
 *     </ul>
 */
export function CountLineItem({ line }: { readonly line: CountLine }) {
  return (
    <li aria-label={line.itemName} className="flex flex-col gap-1 py-3">
      <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span className="max-w-full min-w-0 text-xl font-semibold wrap-anywhere">{line.itemName}</span>
        <Badge
          data-figure="discrepancy"
          variant={line.difference < 0 ? "destructive" : line.difference > 0 ? "outline" : "secondary"}
        >
          {discrepancyText(line.difference)}
        </Badge>
      </span>
      <span className="flex flex-wrap gap-x-4 tabular-nums">
        <span data-figure="expected">
          <span className={hint}>Esperado: </span>
          <span className="font-medium wrap-anywhere">{line.expected}</span>
        </span>
        <span data-figure="found">
          <span className={hint}>Contado: </span>
          <span className="font-medium wrap-anywhere">{line.found}</span>
        </span>
      </span>
    </li>
  );
}
