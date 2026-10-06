-- Ticket 10. Changes to a Bill's Customer or note (spec §5.3, §7.2). A fact:
-- written once and never updated. The Bill's current Customer and note are
-- projections, written only in the batch of the fact that moves them
-- (spec §7.1), and Historial (ticket 18) reads these facts newest first.

CREATE TABLE bill_edits (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES bills (id),
  -- Which of the Bill's two editable fields this fact changed.
  field TEXT NOT NULL CHECK (field IN ('customer', 'note')),
  -- The Customer's id, or the note as it was; NULL when there was none.
  previous_value TEXT,
  -- The Customer's id, or the note as it became; NULL when it was cleared.
  new_value TEXT,
  edited_by TEXT NOT NULL REFERENCES users (id),
  edited_at INTEGER NOT NULL
) STRICT;

-- The edits of one Bill, oldest first.
CREATE INDEX bill_edits_by_bill ON bill_edits (bill_id, edited_at);
-- Historial by time, newest first (spec §7.4).
CREATE INDEX bill_edits_by_time ON bill_edits (edited_at);
