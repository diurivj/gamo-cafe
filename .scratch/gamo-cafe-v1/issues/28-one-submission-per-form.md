# 28 — Record one submission per rendered form

Status: resolved
Blocked by: 27
Spec: [`../spec.md`](../spec.md) §3.4, §7.3

## What to build

A double tap, or a retry after a response lost on a bad connection, records a second Bill or Payment today: the submit button is disabled only once JavaScript knows the form is pending.

- Forms that create a Bill, a Payment, an Adjustment or a Count carry a hidden key made when the form is rendered (`newId()`), and a new one after each recorded submission.
- The operation records the key with its fact in the same batch, under a uniqueness rule in SQL, so a second submission with the same key writes nothing. That needs a migration; choose between a key column on the facts and one small table of used keys, and say why in the ticket's answer.
- A repeated submission answers as the first one did: the same redirect and the same message, not an error.
- The rebuild of projections (ticket 19) is unaffected: a key is a fact about the submission, not a projection.

## Acceptance criteria

- [x] Two identical submissions of a Vender form with the same key record one Bill, one set of Lines, one Payment and one Stock movement, tested on the operation and through the Worker.
- [x] The same holds for Abonar, an Adjustment and a Count.
- [x] Two concurrent submissions with the same key record one, tested the way `takePayment`'s race is.
- [x] A new form after a recorded sale carries a new key, so the next sale of the same Items is recorded.

## Answer

Five operations now record one submission per key: `recordSelection`, `takePayment`, `takeCustomerPayment`, `recordAdjustment` and `recordCount`. Each takes an optional `submissionKey`. The shared part is `app/backend/submissions.ts`, and the README has a section on it ("One submission per form").

**The migration is one table of used keys, `submissions` (`migrations/0028_submissions.sql`), not a key column on the facts.** The reasons:

- A submission is not one fact. A selection writes several Lines and sometimes a Bill and a Payment; an Abonar writes one Payment per Bill. A key column would have to go on five fact tables, and could be unique on none of `lines` or `payments`.
- The repeat has to be answered as the first was. The table holds the operation's answer as JSON (`result`), so the action builds the same redirect and message from it. A column on the facts would mean reading the Bill again, and its figures may have moved since.
- The facts and their indexes stay as they were, so the rebuild, the seed and every list query are untouched. `submissions` is a fact about the submission, written once; the rebuild neither reads nor writes it.

The primary key is `(submitted_by, form, key)`. A key is scoped to the User and to the kind of form, so one User's key never answers another's request, nor a form of another kind.

**How a batch records the key.** The `submissions` row is the last statement of the batch, conditional on the batch's own fact existing. Every other statement carries `NOT EXISTS (… this key …)` in the condition the batch already shared. Two requests that arrive together run one batch after the other, the second writes nothing, and it then reads the first one's answer. The primary key is the rule underneath: a batch that tried to write a taken key would fail whole. No test reaches that failure, because the condition always stops the batch first.

Each operation looks for the key before it checks any rule. The first submission moved what the rules read, so a second `takePayment` would otherwise be told the Bill changed.

**Where the key is made.** The page's loader returns `submissionKey: newId()` and the form sends it in a hidden field. Conteo's confirming form is rendered by the review action, so that action makes its key. I did not make the key in the component, as ticket 27's answer suggested: a key made during render differs between the server and the browser, and a form that failed to remount would keep its key and have its next sale taken for a repeat.

Things a later reader should know:

- **Tickets 30 and 31:** the loader running again after a recorded form is what gives the next form a new key. A route that skips that revalidation with `shouldRevalidate` sends the old key again, and the next sale is answered "recorded" without being recorded. Vender, Cuenta, a Customer's page and Inventario must revalidate after their own form. `e2e/one-submission.spec.ts` sells the same Item twice in a row and would catch it on Vender and Cuenta.
- A page shown again without its loader running carries a used key. With JavaScript every navigation runs the loader. Without it, the browser's Back after a recorded sale can show the earlier document with its old key, and a sale sent from there is taken for a repeat. Nothing here prevents that.
- The key identifies the rendered form, not what it holds. A second submission with the same key and different fields is answered as the first and records nothing.
- A refused submission writes no key, so the corrected form is recorded when sent again.
- A request without a key is recorded as before; the operation gives it a key of its own, which leaves a row no repeat will ever match. The forms always send one, so this is tests and hand-made requests.
- `submissions` gains one row per recorded form and nothing removes them.
- Cuenta's **Cobrar** is covered too, although the criteria name only Vender, Abonar, an Adjustment and a Count. A Worker whose full Payment arrives twice is sent to Cuentas abiertas both times.
- `adjustmentStatements` and `countStatements` in `~/backend/stock` take an optional `when` condition, as `changeStock` already did.
- A Line statement of `recordSelection` now binds up to 91 parameters with 20 Lines, a target Bill and the key (D1's limit is 100).

Tests: `tests/submissions.test.ts` (each operation: sent twice, sent at the same moment, a new key, another User, a refusal), `tests/submissions-routes.test.ts` (each form through the Worker, and two Vender requests at once) and `e2e/one-submission.spec.ts` (a double tap in the browser on Vender and on Cuenta).

## Comments

- 2026-10-06: Opened from the decision to follow form best practices throughout. No rule in the spec covered duplicate submissions before §3.4 gained one.
- 2026-10-06: Resolved; see the Answer.
