-- Ticket 13. Counts and their lines (spec §5.8, §7.2). A Count is a physical
-- tally of the units of some stock-tracked Items. Each line records the Stock
-- expected at the moment of confirming and the units found, so the
-- Discrepancy stays readable even as Stock moves afterwards. Facts, inserted
-- once; `stock_levels` is the projection they set (spec §7.1).

CREATE TABLE counts (
  id TEXT PRIMARY KEY,
  note TEXT,
  recorded_by TEXT NOT NULL REFERENCES users (id),
  recorded_at INTEGER NOT NULL,
  day TEXT NOT NULL
) STRICT;

CREATE TABLE count_lines (
  id TEXT PRIMARY KEY,
  count_id TEXT NOT NULL REFERENCES counts (id),
  item_id TEXT NOT NULL REFERENCES items (id),
  units_expected INTEGER NOT NULL,
  units_found INTEGER NOT NULL
) STRICT;

-- Diferencias reads the most recent Counts; lines are read per Count.
CREATE INDEX counts_by_time ON counts (recorded_at);
CREATE INDEX count_lines_by_count ON count_lines (count_id);
