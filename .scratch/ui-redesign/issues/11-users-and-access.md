# 11: Manage Users and access

**What to build:** An Admin can add a User, provide their sign-in code, understand and change roles/status, and revoke sessions through a readable Usuarios experience. Connect code issuance to the redesigned Entrar journey while retaining every access safeguard.

**Blocked by:** 01 — Sign in and navigate the redesigned app.

**Status:** ready-for-agent

**Spec:** [UI redesign](../spec.md) §§2.4, 4, 6–10.

- [ ] Usuarios clearly identifies each User, role and active state with readable text. Add User and code issuance are discoverable without confusing a staff User with a Customer.
- [ ] Issued codes are readable, understandable and usable by the recipient through Entrar, with their one-time/expiration meaning explained. Preserve the existing code format, expiry, storage and session model.
- [ ] Role changes, activation/deactivation and signing out everywhere state their actual consequences. Deactivation still revokes access; harmless changes may use existing reversible optimism but confirmation/error wording must remain truthful.
- [ ] Preserve the last-active-Admin rule, including concurrent requests, and server enforcement of every Admin action. A Worker cannot obtain these controls or sensitive data through direct requests.
- [ ] Role changes or session revocation on another phone are reflected on the affected User's next request according to existing behavior, without leaving a misleading navigation/access state.
- [ ] Pending feedback is immediate and local. Server refusal restores authoritative state and explains the next action; success Notices/code display remain associated with the submitting action rather than another tab.
- [ ] Browser tests follow Admin add/issue code → recipient sign-in and exercise role/status/session changes, expired/used codes and last-Admin refusal. Existing authentication/rate-limit guarantees remain tested.
- [ ] Cover empty/loading/error states, long User names, readable codes, keyboard/focus, 320 px layout, enlarged text and screen-reader naming. Salir and destructive access actions are not confused with ordinary primary task actions.
- [ ] Run focused tests and project verification. Use test Users only; do not issue production credentials, publish codes or alter live sessions.
