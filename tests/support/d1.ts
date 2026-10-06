/**
 * A D1 binding with counts of what an operation asked of it. `prepare` counts
 * a statement; `all`, `run` and `batch` add the rows D1 reports reading. Used
 * by the reads that must stay bounded by their page, whatever the history
 * holds (spec §2.4).
 */
export function countingD1(d1: D1Database) {
  const counter = { statements: 0, rowsRead: 0 };
  const unwrap = new WeakMap<object, D1PreparedStatement>();

  const measured = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapper = new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "all") {
          return async () => {
            const result = await target.all();
            counter.rowsRead += result.meta.rows_read;
            return result;
          };
        }
        if (property === "run") {
          return async () => {
            const result = await target.run();
            counter.rowsRead += result.meta.rows_read;
            return result;
          };
        }
        if (property === "bind") {
          return (...params: ReadonlyArray<string | number | null>) => measured(target.bind(...params));
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
            for (const result of results) counter.rowsRead += result.meta.rows_read;
            return results;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database,
  };
}
