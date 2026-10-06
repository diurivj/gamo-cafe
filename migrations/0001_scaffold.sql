-- Ticket 01. A single known row, read by /healthz to prove that the Worker
-- reaches D1 and that this database has had its migrations applied.
CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

INSERT INTO app_meta (key, value) VALUES ('app', 'gamo-cafe');
