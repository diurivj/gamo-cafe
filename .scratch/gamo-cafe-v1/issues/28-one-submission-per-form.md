# 28 — Record one submission per rendered form

Status: ready-for-agent
Blocked by: 27
Spec: [`../spec.md`](../spec.md) §3.4, §7.3

## What to build

A double tap, or a retry after a response lost on a bad connection, records a second Bill or Payment today: the submit button is disabled only once JavaScript knows the form is pending.

- Forms that create a Bill, a Payment, an Adjustment or a Count carry a hidden key made when the form is rendered (`newId()`), and a new one after each recorded submission.
- The operation records the key with its fact in the same batch, under a uniqueness rule in SQL, so a second submission with the same key writes nothing. That needs a migration; choose between a key column on the facts and one small table of used keys, and say why in the ticket's answer.
- A repeated submission answers as the first one did: the same redirect and the same message, not an error.
- The rebuild of projections (ticket 19) is unaffected: a key is a fact about the submission, not a projection.

## Acceptance criteria

- [ ] Two identical submissions of a Vender form with the same key record one Bill, one set of Lines, one Payment and one Stock movement, tested on the operation and through the Worker.
- [ ] The same holds for Abonar, an Adjustment and a Count.
- [ ] Two concurrent submissions with the same key record one, tested the way `takePayment`'s race is.
- [ ] A new form after a recorded sale carries a new key, so the next sale of the same Items is recorded.

## Comments

- 2026-10-06: Opened from the decision to follow form best practices throughout. No rule in the spec covered duplicate submissions before §3.4 gained one.
