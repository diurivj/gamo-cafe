import type { ReactNode } from "react";

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

/** The drawing of one of the navigation's destinations. */
export function NavigationDrawing({ icon }: { readonly icon: NavigationIcon }) {
  return <Drawing>{navigation[icon]}</Drawing>;
}

/** Points to where a row leads. */
export function ChevronDrawing({ className }: { readonly className?: string }) {
  return (
    <Drawing className={className}>
      <path d="M9 6l6 6-6 6" />
    </Drawing>
  );
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
