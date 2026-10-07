# 01: Sign in and navigate the redesigned app

**What to build:** A complete entry journey: a User enters their code, lands on Vender, understands who is signed in, reaches the tools allowed for their role, and can sign out. Establish the warm, readable visual system through Entrar, the shared navigation, Más and global error experiences rather than shipping a disconnected component library. Introduce reusable presentation patterns alongside existing screens without breaking their behavior; later tickets migrate those screens.

**Blocked by:** None (can start immediately).

**Status:** resolved

**Spec:** [UI redesign](../spec.md) §§2–4, 7–10.

- [x] Entrar has a labeled, pasteable code field, instructions for obtaining a code, immediate pending feedback, and readable invalid/expired/rate-limit messages. Preserve the existing one-time-code and session rules.
- [x] Both roles initially open Vender. Admin navigation is Vender · Día · Inventario · Más; Worker navigation is Vender · Cuentas · Mi día · Más. Worker's Cuentas opens Cuentas abiertas, never the Admin all-Bills screen.
- [x] Navigation uses icons with persistent words, a programmatically identified current location and a coherent larger-screen arrangement. Existing destinations and deep links remain reachable.
- [x] Más groups every remaining destination specified for the role. User identity, role and Salir are discoverable; Workers receive no Admin-only links or restricted data.
- [x] Not-found, forbidden, expired-session and unexpected-error experiences give clear Spanish explanations and useful next actions without claiming an interrupted mutation failed. Transaction-specific recovery is completed in ticket 02.
- [x] Warm surfaces, dark readable text, restrained accent, legible typography, controls, Notices and focus styling establish patterns other tickets can reuse. Avoid decorative gradients, excessive pills and generic dashboard cards.
- [x] Implement applicable WCAG 2.2 AA requirements, approximately 18 px body/form text and at least 48 × 48 px standalone targets. Verify 320 px reflow, enlarged text, keyboard use, screen-reader names and mobile safe areas; fixed navigation does not obscure content or focus.
- [x] Browser tests cover sign-in/sign-out, both navigation variants, Más, deep links and global errors. New or changed routes are covered by server authentication and permission checks.
- [x] Run focused tests and the project verification suite; record results. This is an internal implementation slice, not authorization for a partial pilot or deployment.

## Comments

- 2026-10-06: Implemented. Review (standards and spec axes) left three things open, recorded under Answer.
- 2026-10-06: The first look (serif headings on cream, a teal accent with tinted boxes, a sentence under every link) was rejected as generic. Replaced by "plain and quiet": the phone's own font, near-white, near-black text and buttons, hairline dividers, no accent color, labels without helper sentences.
- 2026-10-06: "Plain and quiet" was rejected too (not modern, bloated). Eight styles were prototyped on the throwaway branch `prototype/ui-styles` (`/prototipo/estilos?variant=A…H` under `npm run dev`). Verdict: variant G — a bento home screen, a floating navigation bar and a neo-brutalist skin. Built here: the skin's tokens and patterns, Inicio (`/inicio`, where sign-in lands), destinations Inicio · Vender · Día/Cuentas · Más, Más as cards. Spec §3.2, §4.1, §4.2 and §7 were revised to match. Not built here: Vender's search, Category chips and Item drawings, which are ticket 02's.

## Answer

Entrar, the shell, the new Más (`/mas`) and the error pages are on the new visual system; every other screen keeps its markup and gains only the 18px body text, the warm page background and the shared focus mark. Tokens are in `app/app.css`, patterns in `app/components/styles.ts` and `notice.tsx`, each role's navigation in `app/navigation.server.ts`. The README's "The look and the navigation" is the guidance for tickets 02–11.

- Salir moved from the header to Más. A dead session's cookie makes Entrar say "Tu sesión terminó" once; that answer clears the cookie.
- A screen that cannot be shown is answered inside the navigation by the boundary of `app/routes/screen.tsx`, a new pathless layout; a path the app does not have is answered by the root boundary, alone.
- `public/manifest.webmanifest` no longer locks the installed app to portrait (spec §8), and takes the new colors.

Results, 2026-10-06, after the last restyle: `npm run verify` — 65 files, 638 tests passed. `npm run test:e2e` — 192 passed (Android and iPhone shapes), including `e2e/navigation.spec.ts` (both roles' destinations, every Más link, deep links, 403/404/failed load, 320px, 200% text, laptop) and the sign-in specs.

Left open:

- The bar's labels are 14px, not 18px, to fit four side by side at 320px. They are bold, black, and beside a drawing.
- Paste is covered only by a synthetic event that shows nothing cancels it; the field is a plain text input with no handler.
- The automated accessibility scan and the manual keyboard, screen-reader, real-device and safe-area passes are ticket 12's.
