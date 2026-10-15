import { useState } from "react";
import { isRouteErrorResponse, useLocation } from "react-router";

import { LockDrawing, SearchDrawing, ToneDrawing } from "~/components/icons";
import { Notice } from "~/components/notice";
import { Change } from "~/components/recording";
import { buttonClasses } from "~/components/ui/button";
import { lastRecorded } from "~/shared/recorded";

import { hint, pageTitle } from "./styles";

/**
 * What Cuenta's loader refuses a Worker with when the Bill is Paid or Voided:
 * a 403 like any other, which this screen words as what happened to the Bill.
 */
export const CLOSED_BILL = { refused: "closed-bill" } as const;

const isClosedBill = (data: unknown) =>
  typeof data === "object" && data !== null && "refused" in data && data.refused === CLOSED_BILL.refused;

/**
 * What the app shows in place of a screen it cannot show (UI redesign §7):
 * what happened, in Spanish, and what to do next. The status stays what the
 * route threw; only the words are ours. The root boundary renders it alone,
 * the shell's inside the navigation.
 *
 * An error that is neither "not allowed" nor "not there" may have interrupted
 * a form on its way, and the page cannot know whether the server recorded it:
 * it says so, and never that nothing was saved. When it took the place of a
 * confirmed result — the read after it failed — it knows, and keeps saying
 * what was recorded (`~/shared/recorded`), with the change to hand over.
 */
export function ErrorScreen({ error }: { readonly error: unknown }) {
  const { pathname, search } = useLocation();
  const status = isRouteErrorResponse(error) ? error.status : null;

  let title = "Algo salió mal";
  let details =
    "No se pudo mostrar esta pantalla. Si estabas registrando algo, puede que sí se haya guardado: revísalo antes de repetirlo.";
  let retry = true;
  // Where a refused screen leads besides Vender.
  let instead: { readonly to: string; readonly label: string } | null = null;
  if (status === 403 && isRouteErrorResponse(error) && isClosedBill(error.data)) {
    title = "Esta cuenta ya no está abierta";
    details = "Se pagó o se canceló. Lo registrado se conserva, y solo un administrador puede abrirla.";
    retry = false;
    instead = { to: "/cuentas-abiertas", label: "Cuentas abiertas" };
  } else if (status === 403) {
    title = "No tienes acceso a esta página";
    details = "Si la necesitas, pídele acceso a un administrador.";
    retry = false;
  } else if (status === 404) {
    title = "No encontramos esta página";
    details = "Revisa la dirección o vuelve a Vender.";
    retry = false;
  }
  // Read once, while this screen takes the result's place: the result forgets itself as it leaves.
  const [recorded] = useState(() => (retry ? lastRecorded() : null));
  if (recorded) {
    details = "Eso quedó registrado: no lo repitas. Lo que no se pudo fue mostrar esta pantalla; vuelve a intentar para verla al día.";
  }
  const stack = import.meta.env.DEV && error instanceof Error ? error.stack : undefined;

  // Plain links: each one loads the document again, which is the way out of
  // whatever state the failure left this one in.
  return (
    <div className="flex flex-col gap-4">
      {/* What kind of answer this is, before its words: only a drawing. */}
      <span className="grid size-16 place-items-center rounded-full bg-muted text-foreground">
        {status === 403 ? (
          <LockDrawing className="size-8" />
        ) : status === 404 ? (
          <SearchDrawing className="size-8" />
        ) : (
          <span className="text-destructive">
            <ToneDrawing tone="error" className="size-8" />
          </span>
        )}
      </span>
      <h1 className={pageTitle}>{title}</h1>
      {recorded ? <Notice tone="success">{`${recorded.title}. ${recorded.details}`}</Notice> : null}
      {/* The cash to hand back is never taken off the screen by a failed read (UI redesign §5.4). */}
      {recorded?.change ? <Change amount={recorded.change} /> : null}
      <p className={hint}>{details}</p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        {retry ? (
          <a href={pathname + search} className={buttonClasses({ size: "touch" })}>
            Volver a intentar
          </a>
        ) : null}
        {instead ? (
          <a href={instead.to} className={buttonClasses({ size: "touch" })}>
            {instead.label}
          </a>
        ) : null}
        <a href="/" className={buttonClasses({ size: "touch", variant: retry || instead ? "outline" : "default" })}>
          Ir a Vender
        </a>
      </div>
      {stack ? (
        <pre className="mt-4 w-full overflow-x-auto rounded-lg bg-muted p-4 text-left text-xs">
          <code>{stack}</code>
        </pre>
      ) : null}
    </div>
  );
}

/** The same, as a whole page: for a failure with no navigation to stand in. */
export function ErrorPage({ error }: { readonly error: unknown }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md animate-enter flex-col justify-center px-5 py-10">
      <ErrorScreen error={error} />
    </main>
  );
}
