-- Ticket 11. Corrections (spec §2.1, §5.7, §7.2, ADR 0002): removing a Line,
-- removing a Payment and voiding a Bill are facts of their own, each written
-- in the same batch as the Bill's projections and Stock. The Line, Payment or
-- Bill they correct is never updated or deleted.
--
-- Each table allows one correction per record (UNIQUE), which is the backstop
-- behind the conditional write: a second removal can never move Stock twice.

-- Fact. The Admin's reason when the Bill had a Payment; NULL when it did not,
-- where any User may remove the Line and no reason is needed (spec §5.7).
CREATE TABLE line_removals (
  id TEXT PRIMARY KEY,
  line_id TEXT NOT NULL UNIQUE REFERENCES lines (id),
  reason TEXT,
  removed_by TEXT NOT NULL REFERENCES users (id),
  removed_at INTEGER NOT NULL
) STRICT;

CREATE INDEX line_removals_by_time ON line_removals (removed_at);

-- Fact. Always an Admin, always with a reason (spec §5.7).
CREATE TABLE payment_removals (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE REFERENCES payments (id),
  reason TEXT NOT NULL,
  removed_by TEXT NOT NULL REFERENCES users (id),
  removed_at INTEGER NOT NULL
) STRICT;

CREATE INDEX payment_removals_by_time ON payment_removals (removed_at);

-- Fact. Always an Admin, always with a reason; a Bill is voided once and never
-- restored (spec §5.7).
CREATE TABLE bill_voids (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL UNIQUE REFERENCES bills (id),
  reason TEXT NOT NULL,
  voided_by TEXT NOT NULL REFERENCES users (id),
  voided_at INTEGER NOT NULL
) STRICT;

CREATE INDEX bill_voids_by_time ON bill_voids (voided_at);
