import { Link } from "react-router";

import { BackDrawing } from "./icons";
import { buttonClasses } from "./ui/button";

/** The way back from a step or a detail, named after where it leads. */
export function BackLink({ to, label }: { readonly to: string; readonly label: string }) {
  return (
    // Its one word may be wider than a narrow phone with large text: it breaks instead of sticking out.
    <Link to={to} className={`${buttonClasses({ variant: "outline", size: "touch" })} max-w-full shrink self-start`}>
      <BackDrawing className="size-5" />
      <span className="min-w-0 wrap-anywhere">{label}</span>
    </Link>
  );
}
