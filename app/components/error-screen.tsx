import { isRouteErrorResponse, useLocation } from "react-router";

import { buttonClasses } from "~/components/ui/button";

import { hint, pageTitle } from "./styles";

/**
 * What the app shows in place of a screen it cannot show (UI redesign §7):
 * what happened, in Spanish, and what to do next. The status stays what the
 * route threw; only the words are ours. The root boundary renders it alone,
 * the shell's inside the navigation.
 *
 * An error that is neither "not allowed" nor "not there" may have interrupted
 * a form on its way, and the page cannot know whether the server recorded it:
 * it says so, and never that nothing was saved.
 */
export function ErrorScreen({ error }: { readonly error: unknown }) {
  const { pathname, search } = useLocation();
  const status = isRouteErrorResponse(error) ? error.status : null;

  let title = "Algo salió mal";
  let details =
    "No se pudo mostrar esta pantalla. Si estabas registrando algo, puede que sí se haya guardado: revísalo antes de repetirlo.";
  let retry = true;
  if (status === 403) {
    title = "No tienes acceso a esta página";
    details = "Si la necesitas, pídele acceso a un administrador.";
    retry = false;
  } else if (status === 404) {
    title = "No encontramos esta página";
    details = "Revisa la dirección o vuelve a Vender.";
    retry = false;
  }
  const stack = import.meta.env.DEV && error instanceof Error ? error.stack : undefined;

  // Plain links: each one loads the document again, which is the way out of
  // whatever state the failure left this one in.
  return (
    <div className="flex flex-col gap-4">
      <h1 className={pageTitle}>{title}</h1>
      <p className={hint}>{details}</p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        {retry ? (
          <a href={pathname + search} className={buttonClasses({ size: "touch" })}>
            Volver a intentar
          </a>
        ) : null}
        <a href="/" className={buttonClasses({ size: "touch", variant: retry ? "outline" : "default" })}>
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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <ErrorScreen error={error} />
    </main>
  );
}
