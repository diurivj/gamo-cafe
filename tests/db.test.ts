import { Effect, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { Db, statement } from "~/backend/db";

import { runTest } from "./support/effect";

const AppMeta = Schema.Struct({ key: Schema.String, value: Schema.String });
const Note = Schema.Struct({ id: Schema.String, units: Schema.Int });

// A scratch table for this file only; the app's own tables come from migrations.
beforeAll(() =>
  runTest(
    Db.use((db) =>
      db.run("CREATE TABLE IF NOT EXISTS scratch_notes (id TEXT PRIMARY KEY, units INTEGER NOT NULL) STRICT"),
    ),
  ),
);

describe("Db", () => {
  it("reads a row that a migration wrote to local D1", () =>
    runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        const row = yield* db.first(AppMeta, "SELECT key, value FROM app_meta WHERE key = ?", "app");
        expect(row).toEqual({ key: "app", value: "gamo-cafe" });
      }),
    ));

  it("gives undefined when no row matches", () =>
    runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        const row = yield* db.first(AppMeta, "SELECT key, value FROM app_meta WHERE key = ?", "missing");
        expect(row).toBeUndefined();
      }),
    ));

  it("reports how many rows a statement changed, and reads them all back in order", () =>
    runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        const inserted = yield* db.run(
          "INSERT INTO scratch_notes (id, units) VALUES (?, ?), (?, ?)",
          "all-b", 2, "all-a", 1,
        );
        expect(inserted.changes).toBe(2);

        const rows = yield* db.all(Note, "SELECT id, units FROM scratch_notes WHERE id LIKE ? ORDER BY id", "all-%");
        expect(rows).toEqual([
          { id: "all-a", units: 1 },
          { id: "all-b", units: 2 },
        ]);

        const updated = yield* db.run("UPDATE scratch_notes SET units = 9 WHERE id = ?", "no-such-id");
        expect(updated.changes).toBe(0);
      }),
    ));

  it("stores every statement of a batch and reports each one's changes", () =>
    runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        const results = yield* db.batch([
          statement("INSERT INTO scratch_notes (id, units) VALUES (?, ?)", "batch-a", 1),
          statement("UPDATE scratch_notes SET units = units + 1 WHERE id = ?", "batch-a"),
          statement("UPDATE scratch_notes SET units = 0 WHERE id = ? AND units = ?", "batch-a", 99),
        ]);
        expect(results.map((result) => result.changes)).toEqual([1, 1, 0]);

        const row = yield* db.first(Note, "SELECT id, units FROM scratch_notes WHERE id = ?", "batch-a");
        expect(row).toEqual({ id: "batch-a", units: 2 });
      }),
    ));

  it("stores nothing from a batch when one of its statements fails", () =>
    runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        const error = yield* Effect.flip(
          db.batch([
            statement("INSERT INTO scratch_notes (id, units) VALUES (?, ?)", "atomic-a", 1),
            // Violates the primary key, so the first insert must be undone too.
            statement("INSERT INTO scratch_notes (id, units) VALUES (?, ?)", "atomic-a", 2),
          ]),
        );
        expect(error._tag).toBe("DbError");

        const rows = yield* db.all(Note, "SELECT id, units FROM scratch_notes WHERE id = ?", "atomic-a");
        expect(rows).toEqual([]);
      }),
    ));

  it("fails with a DbError, not an exception, when D1 refuses the SQL", () =>
    runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        const error = yield* Effect.flip(db.run("INSERT INTO no_such_table (id) VALUES (?)", "x"));
        expect(error._tag).toBe("DbError");
      }),
    ));

  it("fails with a DbError when a row does not match its schema", () =>
    runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        const Wrong = Schema.Struct({ key: Schema.String, value: Schema.Int });
        const error = yield* Effect.flip(db.first(Wrong, "SELECT key, value FROM app_meta WHERE key = ?", "app"));
        expect(error._tag).toBe("DbError");
      }),
    ));

  it("enforces foreign keys", () =>
    runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        yield* db.run(
          "CREATE TABLE IF NOT EXISTS scratch_children (id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES scratch_notes (id)) STRICT",
        );
        const error = yield* Effect.flip(
          db.run("INSERT INTO scratch_children (id, note_id) VALUES (?, ?)", "child", "no-such-note"),
        );
        expect(error._tag).toBe("DbError");
      }),
    ));
});
