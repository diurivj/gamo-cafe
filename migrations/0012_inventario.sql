-- Ticket 12. Cancelling an Adjustment (spec §5.8, §7.2). The Adjustment stays
-- on record; the cancellation is a fact of its own, carrying who cancelled it,
-- when and why. `UNIQUE` on `adjustment_id` is what makes cancelling happen at
-- most once, and the app's own id lets the same batch reverse the Stock of the
-- cancellation it just wrote, and no other. Ticket 13 adds `counts` and
-- `count_lines`.

CREATE TABLE adjustment_cancellations (
  id TEXT PRIMARY KEY,
  adjustment_id TEXT NOT NULL UNIQUE REFERENCES adjustments (id),
  cancelled_by TEXT NOT NULL REFERENCES users (id),
  cancelled_at INTEGER NOT NULL,
  reason TEXT NOT NULL
) STRICT;
