# 35 — The command-line script runs its imports as Node needs them

Status: resolved
Blocked by: none
Spec: [`../spec.md`](../spec.md) §3.5

## What to build

Ticket 32 made `hashSecret` share `sha256Hex`: `app/shared/secret.ts` imports `./sha256` without the extension. The command-line scripts run under plain Node (`node scripts/sign-in-code.ts`), which resolves every relative import by its real path: a `~` path and an extensionless `./sha256` both fail. `npm run sign-in-code` has been broken since, local and production, with `ERR_MODULE_NOT_FOUND` — and `tests/command-line.test.ts` cannot see it, because Vitest resolves both forms.

- Give the import its extension.
- Hold the contract with a test over the plain modules `tsconfig.node.json` names and the scripts that are run.

## Acceptance criteria

- [x] `npm run sign-in-code -- --production --new-admin "Diego"` runs again (it created production's first Admin).
- [x] A test fails if a plain module or a script gains a `~` import or a relative import without `.ts`.
- [x] `npm run verify` passes.

## Comments

- 2026-10-06: Found while deploying production for the first time after ticket 34: creating the first Admin failed with `ERR_MODULE_NOT_FOUND`.

## Answer

`app/shared/secret.ts` imports `./sha256.ts`. `tests/node-imports.test.ts` reads the plain modules (`command-line.ts`, `rebuild.ts`, `seed.ts`, `day.ts`, `normalize-name.ts`, `secret.ts`, `sha256.ts`) and the three `scripts/` entries as text, and fails on any `~` import or any relative import that does not end in `.ts`. `tests/command-line.test.ts` keeps the module's behavior; the new test keeps the one thing Vitest cannot see. `npm run verify`: 63 files, 614 tests.
