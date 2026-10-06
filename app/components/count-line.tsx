import type { CountLine } from "~/backend/counts";
import { discrepancyText } from "~/shared/discrepancy";

/**
 * One line of a Count as Conteo's review and Diferencias show it: the Item,
 * the Stock expected when it was read, the units found and the Discrepancy
 * (spec §5.8). A type-only import of the backend, so no Effect reaches the
 * browser.
 */
export function CountLineItem({ line }: { line: CountLine }) {
  return (
    <li aria-label={line.itemName} className="py-3">
      <p className="min-w-0 break-words font-medium">{line.itemName}</p>
      <p className="text-stone-600">
        {`Esperado: ${line.expected} · Contado: ${line.found} · ${discrepancyText(line.difference)}`}
      </p>
    </li>
  );
}
