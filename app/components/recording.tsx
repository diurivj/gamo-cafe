import { Fragment, type ReactNode, type RefObject, useEffect, useState } from "react";
import { Link, useBlocker } from "react-router";

import { Notice } from "~/components/notice";
import { amount as amountClasses, figureRow, hint, pageTitle } from "~/components/styles";
import { Button, buttonClasses } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

/**
 * What the screens that record with `sendForRecord` share (UI redesign §6):
 * Cuenta's Payment and corrections, and Abonar. Each keeps its own state
 * (`~/shared/bill-payment`, `~/shared/correction`, `~/shared/customer-payment`)
 * and shows it with these:
 *
 *     <Pending recording={…} title="Registrando pago de $20.00…" unknown="…" ended="…" …>
 *       <SentRows rows={[["Pago", "$20.00 · Efectivo"]]} />
 *     </Pending>
 *
 *     const guard = useLeaveGuard(phase === "recording" || phase === "unknown");
 *     <ConfirmDialog open={guard.asking} … onConfirm={guard.leave} onCancel={guard.stay} />
 */

type Heading = RefObject<HTMLHeadingElement | null>;

/** What was sent, for as long as it is on screen: "Pago", "$20.00 · Efectivo". */
export function SentRows({ rows }: { readonly rows: ReadonlyArray<readonly [label: string, value: string]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt className={hint}>{label}</dt>
          <dd className="min-w-0 font-medium wrap-break-word">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/**
 * Something on its way, or of which nobody knows the outcome: frozen, with
 * only safe ways on. It never says recorded, and never says failed.
 */
export function Pending({
  recording,
  title,
  unknown,
  ended,
  sessionEnded,
  check,
  heading,
  onRetry,
  children,
}: {
  readonly recording: boolean;
  /** What is on its way: "Registrando pago de $20.00…". */
  readonly title: string;
  /** What is said when no answer came. */
  readonly unknown: string;
  /** What is said when the session ended before an answer came. */
  readonly ended: string;
  readonly sessionEnded: boolean;
  /** Where a User can look for themselves, when there is such a place. */
  readonly check: { readonly to: string; readonly label: string } | null;
  readonly heading: Heading;
  readonly onRetry: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6" aria-busy={recording}>
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
        {recording ? title : "No sabemos si se registró"}
      </h1>
      {recording ? (
        <Notice tone="info">Espera la confirmación.</Notice>
      ) : (
        <>
          <Notice tone="info">{sessionEnded ? ended : unknown}</Notice>
          <div className="flex flex-col gap-3">
            {sessionEnded ? (
              // A document load: the way out of a session that ended.
              <a href="/entrar" className={buttonClasses({ size: "touch" })}>
                Entrar de nuevo
              </a>
            ) : (
              <Button type="button" size="touch" onClick={onRetry}>
                Volver a intentar
              </Button>
            )}
            {check ? (
              <Link to={check.to} className={buttonClasses({ variant: "outline", size: "touch" })}>
                {check.label}
              </Link>
            ) : null}
          </div>
        </>
      )}
      {children}
    </div>
  );
}

/** The cash to hand back, kept in sight with a confirmed Payment (UI redesign §5.4). */
export function Change({ amount }: { readonly amount: string }) {
  return (
    <Card size="sm" role="region" aria-label="Cambio">
      <CardContent className={figureRow}>
        <span className="text-xl font-medium">Cambio</span>{" "}
        <span className={`font-heading text-4xl font-semibold ${amountClasses}`}>{amount}</span>
      </CardContent>
    </Card>
  );
}

/**
 * Whether the screen's data was read again since `shown` became true: a
 * result on screen gives way to the record as it is now. What the loader had
 * read when the result arrived, however old or new, is not that.
 */
export function useReadAgainSince(shown: boolean, data: unknown): boolean {
  const [readThen, setReadThen] = useState<unknown>(null);
  useEffect(() => {
    setReadThen(shown ? data : null);
  }, [shown]);
  return shown && readThen !== null && readThen !== data;
}

/**
 * Keeps what is on its way from being left by accident (UI redesign §6.2):
 * in-app navigation waits for an answer to `asking`, and the browser is asked
 * to warn before the page is closed or reloaded — a phone often does not.
 * `within` is the path of a screen whose steps are its own addresses.
 */
export function useLeaveGuard(unfinished: boolean, { within }: { readonly within?: string } = {}) {
  // A screen whose steps are addresses of one path is not left by moving between them.
  const blocker = useBlocker(({ nextLocation }) => unfinished && nextLocation.pathname !== within);
  const blocked = blocker.state === "blocked";
  // Answered while the question was on screen: there is nothing left to ask
  // about, and the answer is what the User has to see.
  useEffect(() => {
    if (blocked && !unfinished) blocker.reset();
  }, [blocked, unfinished]);
  useEffect(() => {
    if (!unfinished) return;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [unfinished]);

  return {
    /** Whether the User tried to leave and has not answered yet. */
    asking: blocked && unfinished,
    leave: () => blocker.proceed?.(),
    stay: () => {
      if (blocker.state === "blocked") blocker.reset();
    },
  };
}
