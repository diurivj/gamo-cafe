# 17 — Por cobrar (Admin)

Status: ready-for-agent
Blocked by: 09, 11
Spec: [`../spec.md`](../spec.md) §5.3, §5.9 (Owed), §6.2 (Por cobrar), §10.2, §4.1

## What to build

**Por cobrar** (Admin only): each Customer with what they owe and the Day of their oldest Open Bill, then the Open Bills with no Customer, flagged when from an earlier Day. Overall Owed at the top. Rows link to the Customer page or to Cuenta.

## Acceptance criteria

- [ ] A Bill with no Customer left Open is flagged the next Day (test clock) and not on its own Day.
- [ ] A Customer's owed figure equals the sum still owed on their Open Bills; Paid and Voided Bills count for nothing.
- [ ] Rows read are proportional to Open Bills, not to history.
- [ ] Workers are refused.
