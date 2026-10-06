# 03 — Usuarios: Admins manage Users and sign-in codes

Status: ready-for-agent
Blocked by: 02
Spec: [`../spec.md`](../spec.md) §3.5, §4.1, §6.2 (Usuarios), §8.8, §10.1

## What to build

On **Usuarios**, an Admin adds a User with a name and role and is shown a one-time code; can issue a new code for an existing User, sign a User out of every phone, deactivate or reactivate, and change role.

- Deactivating signs the User out everywhere.
- The last active Admin cannot be deactivated or made a Worker.
- Users are never deleted.
- Workers cannot reach the screen or its actions (server-enforced).

## Acceptance criteria

- [ ] An Admin adds a User, and the code shown signs that User in on a fresh browser (Playwright, flow §8.8).
- [ ] A User signed out everywhere, and a deactivated User, lose access on their next request.
- [ ] The last active Admin cannot be deactivated or made a Worker, including when two requests race.
- [ ] A Worker calling any Usuarios loader or action is refused.
