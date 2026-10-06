# Stock never blocks a sale and may go negative

When Stock says zero but the Item is on the shelf, usually because a Restock was never recorded, the sale still goes through and Stock goes below zero, flagged for an Admin. The shelf is the truth and the app is the record: refusing a real sale would push it off the app, and an unrecorded sale is the one outcome this app exists to prevent. Negative Stock is a signal that a Restock or a Count is missing, so do not add a guard to "fix" it.
