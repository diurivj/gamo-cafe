import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * What sticks to the bottom of a screen while the User works above it:
 * Vender's total, Conteo's count. It rests just above the navigation bar and
 * tells the page how tall it stands (`--sticky-room`, read by
 * `scroll-padding-bottom` in `app.css`), so what takes the keyboard's focus
 * stays clear of it however tall large text or a long message makes it.
 *
 *     <StickyBar>
 *       <Card role="region" aria-label="Total">…</Card>
 *     </StickyBar>
 *
 * It sticks only while it and the navigation bar leave half of the screen's
 * height to work in. With text twice as large on a small phone they would
 * not, and it stays where it is written instead: after the list, a scroll away.
 */
/**
 * Brings what has the focus back into the room the bars leave, once they have
 * been laid out again: a bar that grew after a control took the focus — larger
 * text, a longer message — would otherwise stay over it.
 */
export function keepFocusClear() {
  requestAnimationFrame(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.closest("main")) focused.scrollIntoView({ block: "nearest" });
  });
}

export function StickyBar({ children }: { readonly children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  // As tall as the room under the bar: where it rests, whether it sticks or not.
  const under = useRef<HTMLDivElement>(null);
  const [sticks, setSticks] = useState(true);
  useEffect(() => {
    const element = bar.current;
    const below = under.current;
    if (!element || !below) return;
    const page = document.documentElement;
    const tell = () => {
      const taken = element.offsetHeight + below.offsetHeight;
      const fits = taken <= window.innerHeight / 2;
      setSticks(fits);
      page.style.setProperty("--sticky-room", fits ? `${taken + 8}px` : "var(--bar-room)");
      keepFocusClear();
    };
    tell();
    const observer = new ResizeObserver(tell);
    observer.observe(element);
    observer.observe(below);
    window.addEventListener("resize", tell);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", tell);
      page.style.removeProperty("--sticky-room");
    };
  }, []);

  return (
    <>
      <div ref={under} aria-hidden className="pointer-events-none invisible absolute h-(--above-bar) w-0" />
      <div ref={bar} data-sticky-bar className={`${sticks ? "sticky" : "static"} bottom-(--above-bar) z-2`}>
        {children}
      </div>
    </>
  );
}
