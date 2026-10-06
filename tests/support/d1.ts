import { env } from "cloudflare:workers";

/**
 * What one request through the Worker asked of D1: the counting D1 is swapped
 * into the binding while `send` runs (`env.DB` is configurable in the Workers
 * pool), so the counts are every statement the request made, the session's
 * included.
 *
 *     const { response, body, statements } = await measured(() => beto.fetch("/"));
 */
export async function measured(send: () => Promise<Response>) {
  const original = env.DB;
  const descriptor = Object.getOwnPropertyDescriptor(env, "DB");
  const { counter, d1 } = countingD1(original);
  Object.defineProperty(env, "DB", { value: d1, configurable: true });
  try {
    const response = await send();
    const body = await response.text();
    return { response, body, ...counter };
  } finally {
    Object.defineProperty(env, "DB", descriptor ?? { value: original, configurable: true });
  }
}

/**
 * A D1 binding with counts of what an operation asked of it. `prepare` counts
 * a statement and records the widest parameter list; `all`, `run` and `batch`
 * add the rows D1 reports reading and writing. Used by the reads and writes
 * that must stay bounded by their page, and under D1's limits (spec §2.4).
 */
export function countingD1(d1: D1Database) {
  const counter = { statements: 0, rowsRead: 0, rowsWritten: 0, maxParams: 0 };
  const unwrap = new WeakMap<object, D1PreparedStatement>();

  const measured = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapper = new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "all") {
          return async () => {
            const result = await target.all();
            counter.rowsRead += result.meta.rows_read;
            counter.rowsWritten += result.meta.rows_written ?? 0;
            return result;
          };
        }
        if (property === "run") {
          return async () => {
            const result = await target.run();
            counter.rowsRead += result.meta.rows_read;
            counter.rowsWritten += result.meta.rows_written ?? 0;
            return result;
          };
        }
        if (property === "bind") {
          return (...params: ReadonlyArray<string | number | null>) => {
            counter.maxParams = Math.max(counter.maxParams, params.length);
            return measured(target.bind(...params));
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    unwrap.set(wrapper, statement);
    return wrapper;
  };

  return {
    counter,
    d1: new Proxy(d1, {
      get(target, property, receiver) {
        if (property === "prepare") {
          return (sql: string) => {
            counter.statements += 1;
            return measured(target.prepare(sql));
          };
        }
        if (property === "batch") {
          return async (statements: ReadonlyArray<D1PreparedStatement>) => {
            const results = await target.batch(statements.map((statement) => unwrap.get(statement) ?? statement));
            for (const result of results) {
              counter.rowsRead += result.meta.rows_read;
              counter.rowsWritten += result.meta.rows_written ?? 0;
            }
            return results;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database,
  };
}
