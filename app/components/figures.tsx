import type { Figures } from "~/backend/day";
import { formatMoney } from "~/shared/money";
import { paymentMethodLabel } from "~/shared/payment";

import { hint } from "./styles";

interface Props {
  readonly figures: Figures;
  /** For one entry among several (a User's on Día): smaller, and without the explanations. */
  readonly compact?: boolean;
}

// A label and its amount side by side, or the amount under it when both do not fit.
const row = "flex flex-wrap items-baseline justify-between gap-x-3";
// A word wider than a narrow phone with large text ("Transferencia") is hyphenated, not cut.
const label = "max-w-full min-w-0 wrap-anywhere hyphens-auto";

/**
 * Collected and Sold as every screen says them (UI redesign §7.1): the money
 * received first, split into cash and transfer, then the value of what was
 * consumed, apart from it. They are never added up and never called a total.
 *
 *     <FiguresPanel figures={day.total} />
 *     <FiguresPanel figures={user} compact />
 *
 * Each amount carries `data-figure` (`collected`, `cash`, `transfer`,
 * `sold`), so a test reads the figure it names and not an amount that happens
 * to be on the page.
 */
export function FiguresPanel({ figures, compact = false }: Props) {
  // An amount too long for its line breaks where it must: it is never cut and never pushes the page sideways.
  const amount = `max-w-full min-w-0 wrap-anywhere tabular-nums ${compact ? "text-xl" : "text-3xl"}`;

  return (
    <dl className="flex flex-col gap-1">
      <div className={row}>
        <dt className={`${label} font-medium`}>Cobrado</dt>
        <dd data-figure="collected" className={`font-heading ${amount} font-semibold`}>
          {formatMoney(figures.collected)}
        </dd>
        {compact ? null : <dd className={`basis-full ${hint}`}>El dinero que se recibió.</dd>}
      </div>
      <div className={row}>
        <dt className={`${label} ${hint}`}>{paymentMethodLabel.cash}</dt>
        <dd data-figure="cash" className="max-w-full min-w-0 font-medium wrap-anywhere tabular-nums">
          {formatMoney(figures.cash)}
        </dd>
      </div>
      <div className={row}>
        <dt className={`${label} ${hint}`}>{paymentMethodLabel.transfer}</dt>
        <dd data-figure="transfer" className="max-w-full min-w-0 font-medium wrap-anywhere tabular-nums">
          {formatMoney(figures.transfer)}
        </dd>
      </div>

      <div className={`${row} mt-2 border-t pt-3`}>
        <dt className={`${label} font-medium`}>Vendido</dt>
        <dd data-figure="sold" className={`font-heading ${amount} font-semibold`}>
          {formatMoney(figures.sold)}
        </dd>
        {compact ? null : <dd className={`basis-full ${hint}`}>Lo que se consumió, pagado o no.</dd>}
      </div>
    </dl>
  );
}
