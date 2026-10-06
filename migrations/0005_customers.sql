-- Ticket 05. Customers (spec §5.2, §7.2).

-- Entity. `normalized_name` is `name` with case and accents ignored
-- (app/shared/normalize-name.ts); names are compared and searched by it.
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL CHECK (normalized_name <> ''),
  note TEXT,
  -- NULL while the Customer is active.
  retired_at INTEGER,
  added_by TEXT NOT NULL REFERENCES users (id),
  added_at INTEGER NOT NULL
) STRICT;

-- Search by normalized-name prefix (spec §7.4), retired Customers included,
-- in the order it is shown.
CREATE INDEX customers_by_normalized_name ON customers (normalized_name, added_at);

-- No two active Customers share a name. It also serves the prefix search that
-- leaves retired Customers out.
CREATE UNIQUE INDEX customers_active_by_normalized_name ON customers (normalized_name)
  WHERE retired_at IS NULL;
