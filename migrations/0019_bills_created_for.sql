-- Ticket 19. The Customer and note a Bill was created for become facts, so
-- the projections `customer_id` and `note` are derived from the records at
-- all times and the maintenance command can rebuild them (spec §7.1, §7.2):
-- until now a Bill created with a Customer or note held it only in the
-- projection, and a hand-edited value could not be told from the original.
--
-- The Bill's creation row is: `day`, `opened_by`, `opened_at`,
-- `opened_customer_id` and `opened_note`. Its projections are the current
-- Customer and note, which `bill_edits` moves, and the figures.
--
-- Backfill: the value before a field's earliest edit, which is exactly what
-- the field held at creation; when the field was never edited, what it holds
-- now is the creation value.

ALTER TABLE bills ADD COLUMN opened_customer_id TEXT REFERENCES customers (id);
ALTER TABLE bills ADD COLUMN opened_note TEXT;

UPDATE bills SET
  opened_customer_id = CASE
    WHEN EXISTS (SELECT 1 FROM bill_edits e WHERE e.bill_id = bills.id AND e.field = 'customer')
      THEN (SELECT e.previous_value FROM bill_edits e
            WHERE e.bill_id = bills.id AND e.field = 'customer'
            ORDER BY e.edited_at, e.rowid LIMIT 1)
    ELSE customer_id END,
  opened_note = CASE
    WHEN EXISTS (SELECT 1 FROM bill_edits e WHERE e.bill_id = bills.id AND e.field = 'note')
      THEN (SELECT e.previous_value FROM bill_edits e
            WHERE e.bill_id = bills.id AND e.field = 'note'
            ORDER BY e.edited_at, e.rowid LIMIT 1)
    ELSE note END;
