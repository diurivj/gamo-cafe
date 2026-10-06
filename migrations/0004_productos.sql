-- Ticket 04. Categories and Items (spec §5.1), and the two Stock records that
-- an Item's starting Stock needs (spec §5.8, §7.2). Tickets 06, 12 and 13
-- build on `adjustments` and `stock_levels`.

-- Entity. Retired, never deleted.
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Order on the Sell screen, lowest first.
  position INTEGER NOT NULL,
  retired_at INTEGER
) STRICT;

-- Entity. Retired, never deleted.
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- `normalizeName(name)`: lower case, no accents, single spaces.
  normalized_name TEXT NOT NULL,
  -- Centavos.
  price INTEGER NOT NULL CHECK (price > 0),
  category_id TEXT NOT NULL REFERENCES categories (id),
  stock_tracked INTEGER NOT NULL DEFAULT 1 CHECK (stock_tracked IN (0, 1)),
  minimum INTEGER CHECK (minimum >= 0),
  retired_at INTEGER
) STRICT;

-- Active Item names are unique ignoring case and accents; a retired Item's
-- name is free. Also serves the name order of active Items.
CREATE UNIQUE INDEX items_active_name ON items (normalized_name) WHERE retired_at IS NULL;
CREATE INDEX items_by_category ON items (category_id);

-- Fact. Units are always positive: Restock adds them to Stock, Waste and
-- Internal use subtract them.
CREATE TABLE adjustments (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items (id),
  reason TEXT NOT NULL CHECK (reason IN ('restock', 'waste', 'internal_use')),
  units INTEGER NOT NULL CHECK (units >= 1),
  note TEXT,
  recorded_by TEXT NOT NULL REFERENCES users (id),
  recorded_at INTEGER NOT NULL,
  day TEXT NOT NULL
) STRICT;

CREATE INDEX adjustments_by_item ON adjustments (item_id, recorded_at);
CREATE INDEX adjustments_by_time ON adjustments (recorded_at);

-- Projection. Written only in the batch of the fact that changes it. An Item
-- with no row has a Stock of zero.
CREATE TABLE stock_levels (
  item_id TEXT PRIMARY KEY REFERENCES items (id),
  units INTEGER NOT NULL,
  last_counted_at INTEGER
) STRICT;
