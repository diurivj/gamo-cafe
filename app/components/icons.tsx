import type { ReactNode } from "react";

import type { CategoryDrawingName } from "~/shared/category-drawing";
import type { NavigationIcon } from "~/shared/navigation";

/**
 * The app's few line drawings. Each one sits beside words that say the same,
 * so it is hidden from a screen reader; its box is fixed, so nothing moves
 * when it paints. One pen for all of them: a 1.75 stroke on a 24 grid.
 */
function Drawing({ className = "size-6", children }: { readonly className?: string; readonly children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
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
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5z" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </>
  ),
  bag: (
    <>
      <path d="M5.5 8h13l-.9 11.1a1 1 0 0 1-1 .9H7.4a1 1 0 0 1-1-.9L5.5 8z" />
      <path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M4 10h16M8.5 3v4M15.5 3v4" />
      <path d="M8.5 14h.01M12 14h.01M15.5 14h.01M8.5 17h.01M12 17h.01" />
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
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  stack: (
    <>
      <rect x="4" y="9" width="16" height="11" rx="2" />
      <path d="M6.5 6h11M9 3h6" />
    </>
  ),
  wallet: (
    <>
      <path d="M19 7V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a1 1 0 0 0 1-1v-3" />
      <path d="M4 7.5h15a1 1 0 0 1 1 1V16h-4a2.75 2.75 0 0 1 0-5.5h4" />
    </>
  ),
  scale: (
    <>
      <path d="M12 4v16M8 20h8M5 7h14" />
      <path d="M5 7l-2.5 6a2.5 2.5 0 0 0 5 0L5 7zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0L19 7z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 11.6V4.5a1 1 0 0 1 1-1h7.1a1 1 0 0 1 .7.3l8.2 8.2a1 1 0 0 1 0 1.4l-7.1 7.1a1 1 0 0 1-1.4 0l-8.2-8.2a1 1 0 0 1-.3-.7z" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  badge: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M9.5 3v4h5V3" />
      <circle cx="12" cy="12" r="2.25" />
      <path d="M8 17.5a4 4 0 0 1 8 0" />
    </>
  ),
};

/** The drawing of one of the navigation's destinations, of a card of Inicio, or of a link of Más. */
export function NavigationDrawing({ icon, className }: { readonly icon: NavigationIcon; readonly className?: string }) {
  return <Drawing className={className}>{navigation[icon]}</Drawing>;
}

/** Points to where a row leads. */
export function ChevronDrawing({ className }: { readonly className?: string }) {
  return (
    <Drawing className={className}>
      <path d="M9.5 6l6 6-6 6" />
    </Drawing>
  );
}

/** Points on, beside the words of a way forward. */
export function ArrowDrawing({ className }: { readonly className?: string }) {
  return (
    <Drawing className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Drawing>
  );
}

/** Points back to the step before. */
export function BackDrawing({ className }: { readonly className?: string }) {
  return (
    <Drawing className={className}>
      <path d="M14.5 6l-6 6 6 6" />
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

/** Says a field finds what is typed in it. */
export function SearchDrawing({ className }: { readonly className?: string }) {
  return (
    <Drawing className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </Drawing>
  );
}

/** One more unit, or one less. The button that holds it says of what. */
export function StepDrawing({ by, className }: { readonly by: 1 | -1; readonly className?: string }) {
  return <Drawing className={className}>{by === 1 ? <path d="M12 5v14M5 12h14" /> : <path d="M5 12h14" />}</Drawing>;
}

/** The mark of the choice that is on, beside its words. */
export function CheckDrawing({ className }: { readonly className?: string }) {
  return (
    <Drawing className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Drawing>
  );
}

/** What a User may not open, over the screen that says so. */
export function LockDrawing({ className }: { readonly className?: string }) {
  return (
    <Drawing className={className}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" />
    </Drawing>
  );
}

/** The way out of the app, beside Salir. */
export function LeaveDrawing({ className }: { readonly className?: string }) {
  return (
    <Drawing className={className}>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M9 8l-4 4 4 4M5 12h10" />
    </Drawing>
  );
}

/** Cash, beside Efectivo. */
export function CashDrawing({ className }: { readonly className?: string }) {
  return (
    <Drawing className={className}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5M18 9.5v5" />
    </Drawing>
  );
}

/** A transfer, beside Transferencia: money going from one phone to another. */
export function TransferDrawing({ className }: { readonly className?: string }) {
  return (
    <Drawing className={className}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10 6.5h4M9.5 12.5h5M12.5 10.5l2 2-2 2M11 17.5h2" />
    </Drawing>
  );
}

/**
 * The mark of a result that was recorded: a circle and a check that draws
 * itself when it arrives (`animate-draw`). A User who asked for less motion
 * sees it drawn at once.
 */
export function RecordedDrawing({ className = "size-12" }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      <circle cx="24" cy="24" r="21" className="opacity-25" />
      <path
        d="M14.5 24.5l6.5 6.5 13-14"
        pathLength={1}
        strokeDasharray="1"
        className="animate-draw"
      />
    </svg>
  );
}

const category: Readonly<Record<CategoryDrawingName, ReactNode>> = {
  cup: (
    <>
      <path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9z" />
      <path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5c-.8 1 .8 1.5 0 2.5M12.5 3.5c-.8 1 .8 1.5 0 2.5" />
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
export function ToneDrawing({ tone, className }: { readonly tone: Tone; readonly className?: string }) {
  return (
    <Drawing className={className}>
      <circle cx="12" cy="12" r="9" />
      {tone === "success" ? <path d="M8 12.5l3 3 5-6" /> : null}
      {tone === "error" ? <path d="M12 7v6M12 16.5v.5" /> : null}
      {tone === "info" ? <path d="M12 11v6M12 7v.5" /> : null}
    </Drawing>
  );
}
