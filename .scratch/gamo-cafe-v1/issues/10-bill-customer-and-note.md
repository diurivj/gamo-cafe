# 10 — Set or change a Bill's Customer or note

Status: ready-for-agent
Blocked by: 08
Spec: [`../spec.md`](../spec.md) §5.3, §4.1, §6.1 (Cuenta), §7.2 (`bill_edits`), §7.3 (4 and Concurrency), §2.1

## What to build

On **Cuenta**, set or change the Bill's Customer (picker from ticket 05) or its note (up to 80 characters).

- Any User while the Bill has no Payment; Admins only afterwards. Removed Payments do not count once ticket 11 lands — express "has a Payment" through the Bill's paid projection or an equivalent that ticket 11 keeps true.
- Each change is a `bill_edits` fact (field, previous value, new value, by, at) written in one batch with the Bill's current-Customer / current-note projection, conditional on the Bill's revision.
- A retired Customer cannot be chosen.

## Acceptance criteria

- [ ] A Worker can change Customer and note on a Bill with no Payment, and is refused on a Bill with a Payment; an Admin can do both.
- [ ] Every change leaves a `bill_edits` record with previous and new value, author and time.
- [ ] A note longer than 80 characters is refused.
- [ ] A stale submission changes nothing.
- [ ] Linking a Bill to a Customer makes it appear among that Customer's Open Bills and in what they owe.
