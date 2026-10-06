-- Ticket 02. Sign-in by one-time code, and sessions (spec §3.5, §7.2).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'worker')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT;

-- Operational. The code itself is never stored: `code_hash` is its SHA-256.
CREATE TABLE sign_in_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  code_hash TEXT NOT NULL UNIQUE,
  -- NULL when the developer issued it from the command line.
  issued_by TEXT REFERENCES users (id),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
) STRICT;

CREATE INDEX sign_in_codes_by_user ON sign_in_codes (user_id);

-- Operational. The cookie's token is never stored: `token_hash` is its SHA-256.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;

CREATE INDEX sessions_by_user ON sessions (user_id);

-- Operational. One row per failed code entry; the sign-in limit counts the
-- rows of the last 10 minutes, and older rows are deleted as new ones arrive.
CREATE TABLE sign_in_failures (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL
) STRICT;

CREATE INDEX sign_in_failures_by_at ON sign_in_failures (at);
