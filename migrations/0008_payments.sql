-- Ticket 08. Payments (spec §2.3, §5.5, §7.2). A Payment is a fact: it is
-- written once and never updated; removing one is a `payment_removals` row
-- (ticket 11). A Bill's `paid` projection is written only in the same batch
-- as the Payment that moves it (spec §7.1).

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES bills (id),
  -- Centavos, greater than zero. Never more than the Bill still owes: the
  -- write itself carries that condition (spec §2.3, §7.3).
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'transfer')),
  -- Set by the Payment that settles several of a Customer's Bills at once, so
  -- a list can show them as one handover (spec §5.5, ticket 09). NULL for a
  -- Payment taken on one Bill.
  handover_reference TEXT,
  received_by TEXT NOT NULL REFERENCES users (id),
  received_at INTEGER NOT NULL,
  -- The Day the Payment was received, not its Bill's (spec §5.9).
  day TEXT NOT NULL
) STRICT;

-- The Payments of one Bill, oldest first (spec §7.4: Cuenta).
CREATE INDEX payments_by_bill ON payments (bill_id, received_at);
-- A Day's Payments (spec §7.4: Día).
CREATE INDEX payments_by_day ON payments (day, received_at);
-- One receiver's Payments of a Day (spec §7.4: Mi día).
CREATE INDEX payments_by_receiver_day ON payments (received_by, day);
