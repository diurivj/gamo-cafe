import { Context, Data, Effect, Layer, Schema } from "effect";

/**
 * D1 behind a small service (spec §3.2, ADR 0006). SQL is written by hand;
 * every row that comes back is decoded with a `Schema`; every failure is a
 * `DbError` in the error channel.
 *
 * D1 has no interactive transactions. An operation that must be all-or-nothing
 * (spec §7.3) builds its statements with `statement()` and sends them as one
 * `batch`: either every statement is stored or none is.
 */

/** What may be bound to a `?` placeholder. */
export type Param = string | number | null;

/** One SQL statement and its bound parameters, for `Db.batch`. */
export interface Statement {
  readonly sql: string;
  readonly params: ReadonlyArray<Param>;
}

export function statement(sql: string, ...params: ReadonlyArray<Param>): Statement {
  return { sql, params };
}

/**
 * A SQL condition and its parameters, for the statements of one batch to
 * share. A D1 batch cannot branch, so when the first statement's condition
 * fails the later ones have to fail it too: an operation that must write
 * everything or nothing repeats the same condition in every statement.
 */
export interface Condition {
  readonly sql: string;
  readonly params: ReadonlyArray<Param>;
}

/** How many rows a write inserted, updated or deleted. */
export interface WriteResult {
  readonly changes: number;
}

/** D1 refused or failed a statement, or a row did not match its schema. */
export class DbError extends Data.TaggedError("DbError")<{
  readonly cause: unknown;
}> {}

export class Db extends Context.Service<Db, {
  /** The first row, decoded, or `undefined` when no row matches. */
  first<A>(
    schema: Schema.Decoder<A>,
    sql: string,
    ...params: ReadonlyArray<Param>
  ): Effect.Effect<A | undefined, DbError>;
  /** Every row, decoded. */
  all<A>(
    schema: Schema.Decoder<A>,
    sql: string,
    ...params: ReadonlyArray<Param>
  ): Effect.Effect<ReadonlyArray<A>, DbError>;
  /** One write. */
  run(sql: string, ...params: ReadonlyArray<Param>): Effect.Effect<WriteResult, DbError>;
  /**
   * Several statements as one atomic unit, with one result per statement. A
   * batch cannot branch: express a condition in SQL (`WHERE revision = ?`) and
   * read `changes` afterwards to learn whether it held.
   */
  batch(statements: ReadonlyArray<Statement>): Effect.Effect<ReadonlyArray<WriteResult>, DbError>;
}>()("gamo-cafe/backend/Db") {
  /** `Db` over a D1 binding. */
  static readonly layer = (d1: D1Database): Layer.Layer<Db> => Layer.succeed(Db, make(d1));
}

function make(d1: D1Database): Db["Service"] {
  const prepare = (sql: string, params: ReadonlyArray<Param>) => d1.prepare(sql).bind(...params);

  const query = <T>(f: () => Promise<T>) =>
    Effect.tryPromise({ try: f, catch: (cause) => new DbError({ cause }) });

  const decodeRows = <A>(schema: Schema.Decoder<A>, rows: ReadonlyArray<unknown>) =>
    Effect.mapError(
      Schema.decodeUnknownEffect(Schema.Array(schema))(rows),
      (cause) => new DbError({ cause }),
    );

  const all: Db["Service"]["all"] = (schema, sql, ...params) =>
    Effect.flatMap(
      query(() => prepare(sql, params).all()),
      (result) => decodeRows(schema, result.results),
    );

  return Db.of({
    all,
    first: (schema, sql, ...params) => Effect.map(all(schema, sql, ...params), (rows) => rows[0]),
    run: (sql, ...params) =>
      Effect.map(
        query(() => prepare(sql, params).run()),
        (result) => ({ changes: result.meta.changes }),
      ),
    batch: (statements) =>
      Effect.map(
        query(() => d1.batch(statements.map(({ sql, params }) => prepare(sql, params)))),
        (results) => results.map((result) => ({ changes: result.meta.changes })),
      ),
  });
}
