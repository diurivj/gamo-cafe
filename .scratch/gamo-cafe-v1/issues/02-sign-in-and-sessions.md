# 02 — Sign in with a one-time code, and sessions

Status: ready-for-agent
Blocked by: 01
Spec: [`../spec.md`](../spec.md) §3.5, §4, §6.1 (Entrar), §7.2, §7.3 (7), §8.8, §10.1 · ADR 0004

## What to build

A User with a code issued from the command line opens **Entrar**, types the code and lands signed in; every other route refuses anyone without a valid session.

- Records: `users`, `sign_in_codes`, `sessions`, `sign_in_failures`.
- Codes: 8 characters from an alphabet without look-alikes, shown as two groups of four, single use, expire 10 minutes after issue, stored only as a hash.
- Using a code is one batch: mark it used and create the session. Session token is opaque, in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, stored only as a hash; it ends after 60 days without use and each use extends it.
- Failed entries limited to 10 per 10 minutes across the whole app; beyond that sign-in is refused even with a valid code.
- Non-GET requests whose `Origin` is not the app's own are rejected.
- One place that every loader and action goes through to obtain `CurrentUser` (redirecting to Entrar without a session), and a typed "Admin only" guard for later tickets.
- A command-line script the developer runs (local or production) to create the first Admin and issue a code for a User.
- Sign-out for the current phone, and a signed-in shell with navigation placeholders (Worker vs Admin sections).

## Acceptance criteria

- [ ] All §10.1 criteria except those about Admin user management (ticket 03): single use, 10-minute expiry, eleventh failure refused, no loader or action other than sign-in responds without a valid session.
- [ ] A deactivated User and a revoked session lose access on their next request.
- [ ] Session expiry and extension are tested with a test clock.
- [ ] A cross-origin POST is rejected.
- [ ] Codes and tokens never appear in D1 in clear.
