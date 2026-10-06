-- Ticket 32. A key identifies a rendered form and what it carried.
--
-- Ticket 28 wrote one `submissions` row per (User, kind of form, key) and
-- looked the key up before anything else was compared, so a form sent with a
-- used key was answered as the first one was, whatever it now carried. A
-- document restored by the browser's Back button (which holds a `no-store`
-- page) still carries the used key; a changed form sent from it was answered
-- with the stored answer: the old message, nothing written, no error.
--
-- The primary key gains the digest of what the form carried, so one key is
-- recorded once per content. The same key with the same content is the
-- repeat ticket 28 promised; the same key with different content is a form
-- nothing was recorded for and is recorded (or refused by a rule), never
-- answered silently as the earlier one.
--
-- Rows written before this migration have no digest: they are copied with
-- '' and match no form, since a digest is 64 hex characters. A form sent with
-- one of those keys is therefore recorded as if its key were new. The only
-- submission that loses its repeat is one in flight across the deploy; the
-- alternative — matching on the key alone — is exactly the defect this
-- ticket fixes.

CREATE TABLE submissions_with_digest (
  submitted_by TEXT NOT NULL REFERENCES users (id),
  form TEXT NOT NULL CHECK (form IN ('selection', 'payment', 'handover', 'adjustment', 'count')),
  key TEXT NOT NULL,
  digest TEXT NOT NULL,
  result TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (submitted_by, form, key, digest)
) STRICT, WITHOUT ROWID;

INSERT INTO submissions_with_digest (submitted_by, form, key, digest, result, recorded_at)
  SELECT submitted_by, form, key, '', result, recorded_at FROM submissions;

DROP TABLE submissions;

ALTER TABLE submissions_with_digest RENAME TO submissions;
