# 07: Review all Bills and outstanding debts

**What to build:** An Admin finds Bills across their states and understands current outstanding debts through redesigned Cuentas and Por cobrar. Preserve the difference between historical Bill filtering and debt that is still owed now. These screens can link to existing Bill/Customer details while those redesigns proceed independently.

**Blocked by:** 01 — Sign in and navigate the redesigned app.

**Status:** ready-for-agent

**Spec:** [UI redesign](../spec.md) §§4, 7–10.

- [ ] Cuentas clearly identifies itself as the Admin all-Bills screen, distinct from Cuentas abiertas. Preserve date/state/Customer filters and readable state, identity, date and amount information.
- [ ] Paid, Open, Partially paid and Voided states have understandable text, not color-only indicators. Detail links preserve existing permissions and meaningful return navigation.
- [ ] Por cobrar shows current overall Owed and each Customer's Owed and oldest Open Day. Never imply the values describe a historical selected Day or equal a report's Vendido minus Cobrado.
- [ ] Anonymous Open Bills remain visible, with identifiable notes/dates and explicit warnings for Bills from an earlier Day. Do not require attaching a Customer to preserve or collect them.
- [ ] Customer and Bill links lead toward existing collection capabilities without adding new payment operations or requiring a redesign of linked detail screens in this ticket.
- [ ] Preserve bounded queries, cursor paging on growing lists, accessible Cargar más, filter/scroll restoration and focus behavior. Searches/filters must retain their existing scope, not operate only on already loaded results.
- [ ] Both screens have helpful empty/loading/error states and readable long names/amounts without page-level horizontal scrolling. Apply the shared visual and accessibility standards rather than wrapping the old dense UI in new colors.
- [ ] End-to-end tests cover filtered Bills in every state, Customer/anonymous debts and older-Day warnings, pagination and navigation back. Verify Workers cannot access these screens or their data; include keyboard, narrow-screen and enlarged-text checks.
- [ ] Run focused tests and project verification; do not fetch all history or change debt calculations to simplify presentation.
