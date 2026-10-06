-- Ticket 06. Bills and their Lines (spec §5.3, §5.4, §7.2). The projections a
-- Bill carries keep the lists and the routing rule cheap (spec §2.4); tickets
-- 08, 11 and 19 build on both tables.

-- Fact with projections. The facts are the Day it was opened, the User who
-- opened it and the instant; the rest are projections, written only in the
-- batch of the fact that moves them (spec §7.1).
CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  -- The Day the Bill was opened. A Line added later carries its own Day.
  day TEXT NOT NULL,
  opened_by TEXT NOT NULL REFERENCES users (id),
  opened_at INTEGER NOT NULL,
  -- The current Customer; NULL for a buyer with no Customer (spec §5.3).
  customer_id TEXT REFERENCES customers (id),
  -- The current note, up to 80 characters (spec §5.3).
  note TEXT CHECK (note IS NULL OR length(note) <= 80),
  -- Centavos of the Lines that have not been removed.
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  -- Centavos of the Payments that have not been removed. Never more than the
  -- total: no Customer has credit in their favor (spec §2.3).
  paid INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0 AND paid <= total),
  -- Derived from the records, never set by hand (spec §5.6).
  state TEXT NOT NULL CHECK (state IN ('open', 'partial', 'paid', 'voided')),
  -- Bumped by every batch that changes the Bill, so a stale submission can be
  -- told apart (spec §7.3).
  revision INTEGER NOT NULL DEFAULT 0
) STRICT;

-- A Customer's Open Bills of a Day, newest first: the routing read of
-- "record a selection" (spec §5.3).
CREATE INDEX bills_by_customer_day ON bills (customer_id, day, opened_at);

-- Open Bills by state, newest first (spec §7.4: Cuentas abiertas).
CREATE INDEX bills_by_state ON bills (state, opened_at);

-- Bills by Day and state, paged (spec §7.4: Día and Cuentas).
CREATE INDEX bills_by_day_state ON bills (day, state, opened_at);

-- Fact. One Item, a whole quantity and the price the Item had at that moment
-- (spec §5.4). A Line belongs to the Day it was added on, not its Bill's.
CREATE TABLE lines (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES bills (id),
  item_id TEXT NOT NULL REFERENCES items (id),
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  unit_price INTEGER NOT NULL CHECK (unit_price > 0),
  -- Whether this Line moved Stock when it was added: a fact about the Line,
  -- so rebuilding Stock (ticket 19) does not have to guess from the Item's
  -- flag today.
  moved_stock INTEGER NOT NULL CHECK (moved_stock IN (0, 1)),
  added_by TEXT NOT NULL REFERENCES users (id),
  added_at INTEGER NOT NULL,
  day TEXT NOT NULL
) STRICT;

-- The Lines of one Bill, in the order they were added (spec §7.4).
CREATE INDEX lines_by_bill ON lines (bill_id, added_at);
-- A Day's Lines, and one author's Lines of a Day (spec §7.4: Día, Mi día).
CREATE INDEX lines_by_day ON lines (day);
CREATE INDEX lines_by_author_day ON lines (added_by, day);
