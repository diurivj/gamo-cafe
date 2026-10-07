import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from "react";
import { useNavigation } from "react-router";

interface Props extends Omit<ComponentProps<"button">, "type"> {
  /** For a button inside a `<fetcher.Form>`: that fetcher. Leave it out inside a `<Form>`. */
  readonly fetcher?: { readonly state: "idle" | "submitting" | "loading" };
  /** What the button says while it is pending. It keeps its own words otherwise. */
  readonly pendingLabel?: ReactNode;
}

/**
 * The button that submits a form. Every submit button of the app is this one,
 * so every tap is acknowledged at once (spec §3.4):
 *
 *     <Form method="post">
 *       <SubmitButton name="intent" value="pagar" className={primaryButton}>Cobrar</SubmitButton>
 *     </Form>
 *
 * The button that was tapped is pending from the tap until the page has the
 * answer: `aria-busy`, disabled and pulsing. Every other submit button is
 * disabled while a form is on its way, so nothing is sent twice. It shows
 * that the form is on its way and never what the form will record.
 *
 * Inside a `<Form>` it follows the navigation by itself. Inside a
 * `<fetcher.Form>`, pass `fetcher={fetcher}`. The form must be sent by the
 * router, which every `<Form>` and `<fetcher.Form>` is: a form whose own
 * `onSubmit` cancels the submission and sends nothing would leave the button
 * pending. `tests/submit-controls.test.ts` fails on any submit button
 * written by hand. Vender has none: its sale is not a form (see the README).
 */
export function SubmitButton({ fetcher, pendingLabel, disabled, className = "", children, ...rest }: Props) {
  const button = useRef<HTMLButtonElement>(null);
  const navigating = useNavigation().state !== "idle";
  const onItsWay = fetcher ? fetcher.state !== "idle" : navigating;
  // Whether this button sent the form that is on its way. It is set in the
  // same turn as the tap; the router's own state follows a moment later.
  const [tapped, setTapped] = useState(false);

  useEffect(() => {
    // On the window, so it runs after the router has read the form: a button
    // disabled any earlier would be left out of what is sent, and its `name`
    // and `value` say which form this is. The router cancels the browser's
    // own submission of a form it sends.
    const sent = (event: SubmitEvent) => {
      if (event.submitter === button.current) setTapped(event.defaultPrevented);
    };
    window.addEventListener("submit", sent);
    return () => window.removeEventListener("submit", sent);
  }, []);
  // Answered: the next form on its way is not this button's unless it is tapped again.
  useEffect(() => {
    if (!onItsWay) setTapped(false);
  }, [onItsWay]);

  return (
    <button
      {...rest}
      ref={button}
      type="submit"
      aria-busy={tapped || undefined}
      disabled={disabled || onItsWay || navigating || tapped}
      className={`${className} aria-busy:animate-pulse`}
    >
      {tapped && pendingLabel !== undefined ? pendingLabel : children}
    </button>
  );
}
