# 32 — A used key must not answer a changed form as its repeat

Status: resolved
Blocked by: none
Spec: [`../spec.md`](../spec.md) §3.4

## What to build

Ticket 28 makes one key identify one rendered form, so a double tap or a retry records once. But the key is looked up before anything else is compared (`recordedAnswer` in `app/backend/submissions.ts`), so a form sent with a used key is answered as the first one was, whatever it now carries.

The path that reaches it: with JavaScript off, browser Back can restore an already-sent document (Chrome's bfcache holds `no-store` pages), and that document still has its used hidden `submissionKey` (`app/routes/home.tsx:393`). A genuinely different selection sent from it is answered with the stored answer: the old flash, nothing written, no error. Ticket 28's own Answer records this: "the browser's Back after a recorded sale can show the earlier document with its old key, and a sale sent from there is taken for a repeat. Nothing here prevents that."

Every keyed form has the same exposure when its document is restored: Vender (`app/routes/home.tsx`), Cuenta (`app/routes/bill.tsx`), Cliente/Abonar (`app/routes/customer.tsx`), Inventario (`app/routes/inventario.tsx`) and Conteo (`app/routes/conteo.tsx`).

Make a key identify a rendered form **and what it carried**. The same key with the same content stays a repeat: answer with the first answer, write nothing. The same key with different content is a form nothing was recorded for: record it (or refuse it visibly), and never answer it silently as the earlier one.

## Acceptance criteria

- [ ] With JavaScript off, after a recorded sale: Back, change the selection, send. The changed sale is recorded and acknowledged; no earlier answer is shown for it.
- [ ] The unchanged form sent twice (a double tap, or a retry after a lost response) still records once and is answered as the first one was.
- [ ] Two sends with one key that both pass the first read still write one fact, not two: `notYetRecorded` and the `submissions` primary key keep holding, as `app/backend/submissions.ts` describes.
- [ ] The Abonar, the Adjustment, the Count and the Cuenta forms get the same treatment, or the Answer says for each why it does not need it.
- [ ] A test covers the Back path through the routes; an e2e with JavaScript off if practical.

Constraints a later reader should keep in mind:

- `submissions` is never pruned and keys are bounded (`KEY_LIMIT`, 64 characters). A content digest must not grow the stored key past that.
- The stored answer is what a repeat is answered with, so the digest has to be stored beside it (a migration), and the lookup and `notYetRecorded` must match on the same pair.
- Rows written before the migration have no digest. Decide what a form sent with one of those keys means, and say so in the Answer.

## Comments

- 2026-10-06: Opened from the two-axis review of tickets 26–31 (Spec axis). The reviewer named it the defect the code cannot currently prevent, with no test covering it; ticket 28's Answer acknowledges it.
- 2026-10-06: Resolved. See the Answer.

## Answer

A key now identifies a rendered form **and what it carried**. `submissions` gained a `digest` column and its primary key is `(submitted_by, form, key, digest)`:

- each operation computes the digest of its own input: `submissionOf(form, by, key, content)` in `app/backend/submissions.ts` hashes one fixed-order JSON array of what the form carried with `sha256Hex` (`app/shared/sha256.ts`, the hash `hashSecret` already used);
- `recordedAnswer` looks a repeat up by all four columns, and `notYetRecorded` and `submissionStatement` match and write the same four. The digest is its own column, so the 64-character `KEY_LIMIT` on the key is untouched.

**The same key with the same content** is exactly the repeat ticket 28 promised: answered with the stored answer, nothing written. **The same key with different content** finds no stored answer and proceeds as a new submission: the operation records it, or one of its own rules refuses it visibly. The revision rules a restored document meets are the same any submission meets:

| Form | A changed form sent with a used key |
| --- | --- |
| Vender (selection) | recorded, as a new Bill with its own Lines, and acknowledged with its own message |
| Inventario (adjustment) | recorded |
| Conteo (count) | recorded; the second Count expects what the first one left |
| Cuenta (payment) | refused `BillChanged`: the first Payment moved the revision the restored document carries |
| Cliente (Abonar) | refused `CustomerBillsChanged` for the same reason |

What each digest holds is the fields its operation records, after the same normalization the operation uses (trimmed note, `|| null`): a selection's merged items (so `[{A,1},{A,1}]` and `[{A,2}]` are one content), Customer, note, target Bill and the Cobrar payment; a payment's Bill, expected revision, amount and method; an Abonar's Customer, amount, method and every bill/revision; an Adjustment's item, reason, units and note; a Count's lines and note.

**Rows written before the migration** are copied with an empty digest, which no real digest can be (every SHA-256 is 64 hex characters), so a form sent with one of those keys matches no stored answer and is recorded as if its key were new. That is the deliberate choice: matching on the key alone is the defect, and the only submission that loses its repeat is one in flight across the deploy.

The routes needed no change: the loader still returns `submissionKey: newId()`, the hidden field still carries it, and the server alone decides what a repeat is. Tests: `tests/submissions.test.ts` (each of the five operations: a changed form recorded or visibly refused under a used key, and the first content still its repeat; a pre-migration row matches nothing), `tests/submissions-routes.test.ts` (the same through the Worker for Vender, Cuenta, Abonar, Inventario and Conteo), and `e2e/one-submission.spec.ts` (a document holding a used key, before JavaScript has loaded, sends a changed Adjustment: recorded, Stock at 18).

Acceptance criterion 1's browser path — Back, change the selection, send, on Vender — cannot be driven with JavaScript off: Vender's selection is made by its Item tiles, which are JavaScript buttons, so a JS-off browser can only send an empty one. The route test in `tests/submissions-routes.test.ts` is that acceptance criterion: the same key with a changed selection is recorded and acknowledged with its own message, and the unchanged form is still one sale. The JS-off e2e uses Inventario, whose Producto, Motivo and Unidades controls are native. Playwright's Chromium refetches the app's `no-store` pages on Back instead of holding them in its bfcache, so that spec serves the recorded document for the one Back navigation; the shape is the real one — a used key in the document and a form that now carries something else.

Two things a later reader should keep:

- `submissionOf` is now an Effect (it hashes); the five call sites `yield*` it. `hashSecret` (`~/shared/secret`) shares the SHA-256 through the new `~/shared/sha256`; its behavior is unchanged.
- A Line statement of `recordSelection` binds up to 92 parameters with 20 Lines, a target Bill and the key/digest, still under D1's 100. `submissions` rows still accumulate and are never pruned.
