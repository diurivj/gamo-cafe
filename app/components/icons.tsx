import type { ReactNode } from "react";

import type { CategoryDrawingName } from "~/shared/category-drawing";
import type { NavigationIcon } from "~/shared/navigation";

/**
 * The app's few line drawings. Each one sits beside words that say the same,
 * so it is hidden from a screen reader; its box is fixed, so nothing moves
 * when it paints.
 */
function Drawing({ className = "size-6", children }: { readonly className?: string; readonly children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

const navigation: Readonly<Record<NavigationIcon, ReactNode>> = {
  home: <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1v-8z" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </>
  ),
  bag: (
    <>
      <path d="M6 8h12l1 12H5L6 8z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4" />
    </>
  ),
  box: (
    <>
      <path d="M4 8l8-4 8 4v8l-8 4-8-4V8z" />
      <path d="M4 8l8 4 8-4M12 12v8" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
};

/** The drawing of one of the navigation's destinations, or of a card of Inicio. */
export function NavigationDrawing({ icon, className }: { readonly icon: NavigationIcon; readonly className?: string }) {
  return <Drawing className={className}>{navigation[icon]}</Drawing>;
}

/** Points to where a row leads. */
export function ChevronDrawing({ className }: { readonly className?: string }) {
  return (
    <Drawing className={className}>
      <path d="M9 6l6 6-6 6" />
    </Drawing>
  );
}

/** Points back to the step before. */
export function BackDrawing({ className }: { readonly className?: string }) {
  return (
    <Drawing className={className}>
      <path d="M15 6l-6 6 6 6" />
    </Drawing>
  );
}

/** Says a field opens a list of choices. */
export function UnfoldDrawing({ className }: { readonly className?: string }) {
  return (
    <Drawing className={className}>
      <path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4" />
    </Drawing>
  );
}

/** One more unit, or one less. The button that holds it says of what. */
export function StepDrawing({ by }: { readonly by: 1 | -1 }) {
  return <Drawing>{by === 1 ? <path d="M12 5v14M5 12h14" /> : <path d="M5 12h14" />}</Drawing>;
}

/** The mark of the choice that is on, beside its words. */
export function CheckDrawing({ className }: { readonly className?: string }) {
  return (
    <Drawing className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Drawing>
  );
}

const category: Readonly<Record<CategoryDrawingName, ReactNode>> = {
  cup: (
    <>
      <path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9z" />
      <path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M12 3v3" />
    </>
  ),
  glass: (
    <>
      <path d="M6 4h12l-1.5 16h-9L6 4z" />
      <path d="M6.6 10h10.8" />
    </>
  ),
  bread: (
    <>
      <path d="M5 10.5A3.5 3.5 0 0 1 8.5 7h7a3.5 3.5 0 0 1 2 6.4V18a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-4.6A3.5 3.5 0 0 1 5 10.5z" />
      <path d="M10 11v2M14 11v2" />
    </>
  ),
  plate: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  candy: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M7.8 10.5L3 8v8l4.8-2.5M16.2 10.5L21 8v8l-4.8-2.5" />
    </>
  ),
  snack: (
    <>
      <path d="M7 3h10l-1 3 2 12-1 3H7l-1-3L8 6 7 3z" />
      <path d="M10 11h4" />
    </>
  ),
  fruit: (
    <>
      <path d="M12 8c-3-2-7 0-7 5s3.5 8 7 6c3.5 2 7-1 7-6s-4-7-7-5z" />
      <path d="M12 8c0-2 1-4 3-5" />
    </>
  ),
};

/** The drawing beside a Category's name on Vender (`categoryDrawing` chooses which). */
export function CategoryDrawing({ name, className }: { readonly name: CategoryDrawingName; readonly className?: string }) {
  return <Drawing className={className}>{category[name]}</Drawing>;
}

/** What a `Notice` says it is: recorded, refused, or worth knowing. */
export type Tone = "success" | "error" | "info";

/** What a `Notice` of each tone shows beside its words. */
export function ToneDrawing({ tone }: { readonly tone: Tone }) {
  return (
    <Drawing>
      <circle cx="12" cy="12" r="9" />
      {tone === "success" ? <path d="M8 12.5l3 3 5-6" /> : null}
      {tone === "error" ? <path d="M12 7v6M12 16.5v.5" /> : null}
      {tone === "info" ? <path d="M12 11v6M12 7v.5" /> : null}
    </Drawing>
  );
}
