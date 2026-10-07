import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";

interface Props {
  readonly open: boolean;
  /** What is being asked. */
  readonly title: string;
  /** What happens if the User goes on. */
  readonly description: string;
  /** The action that goes on, by its effect: "Vaciar", never "Sí". */
  readonly confirm: string;
  /** The way out that changes nothing. Escape does the same. */
  readonly cancel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Asks before something is lost (UI redesign §7.2): discarding unfinished
 * work, leaving a form that is on its way. A shadcn `AlertDialog`, opened by
 * the screen's own state:
 *
 *     <ConfirmDialog open={asking} title="¿Vaciar la selección?" description="…"
 *       confirm="Vaciar" cancel="Conservar" onConfirm={clear} onCancel={() => setAsking(false)} />
 *
 * Not for an ordinary, reversible edit, and not for a normal sale: the review
 * step is that confirmation.
 */
export function ConfirmDialog({ open, title, description, confirm, cancel, onConfirm, onCancel }: Props) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirm}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
