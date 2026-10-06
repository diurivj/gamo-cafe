# 32 — A used key must not answer a changed form as its repeat

Status: ready-for-agent
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
