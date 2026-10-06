-- Ticket 28. One submission per rendered form (spec §3.4).
--
-- A form that creates a Bill, a Payment, an Adjustment or a Count carries a
-- key made when the form was rendered. The operation writes the key here in
-- the same batch as what it records, and the primary key is the rule that a
-- key is recorded once: a double tap, or a retry after a lost response, finds
-- the key taken and writes nothing.
--
-- `result` is what the operation answered, as JSON, so the repeat is answered
-- as the first one was. A row is a fact about the submission, written once
-- and never updated; it is not a projection, and the rebuild of ticket 19
-- neither reads nor writes it.
--
-- A key is scoped to the User and to the kind of form, so one User's key
-- never answers another's request, nor a form of another kind.

CREATE TABLE submissions (
  submitted_by TEXT NOT NULL REFERENCES users (id),
  form TEXT NOT NULL CHECK (form IN ('selection', 'payment', 'handover', 'adjustment', 'count')),
  key TEXT NOT NULL,
  result TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (submitted_by, form, key)
) STRICT, WITHOUT ROWID;
