import { Badge } from "~/components/ui/badge";
import { type BillState, billStateLabel } from "~/shared/bill-state";

/** How each state is drawn. Its word says which it is; the fill only helps. */
const variantOf = { open: "outline", partial: "secondary", paid: "default", voided: "destructive" } as const;

/**
 * A Bill's state, as every list and Cuenta show it: Abierta, Pago parcial,
 * Pagada or Cancelada, in words (UI redesign §7).
 *
 *     <BillStateBadge state={bill.state} />
 */
export function BillStateBadge({ state }: { readonly state: BillState }) {
  return <Badge variant={variantOf[state]}>{billStateLabel[state]}</Badge>;
}
