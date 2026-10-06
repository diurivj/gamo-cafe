/**
 * The SQL that `scripts/projections.ts` sends to D1 (ticket 19, spec §7.1):
 * every projection recomputed from the facts it is derived from, so the
 * developer can either see every difference from the live values or rewrite
 * them. Plain strings, no Effect, because Node runs the script as it is — the
 * same shape as ./command-line.ts.
 *
 * The command is one artifact for local and production: the tests in
 * `tests/rebuild.test.ts` send these same strings to a real D1 whose state was
 * built through the operations, so what they prove is what the command runs.
 * No parameters: `wrangler d1 execute` takes SQL text.
 *
 * ## What is a fact here
 *
 * Bills:
 *
 * - `total` is the Lines that still count (spec §5.7): every Line without a
 *   `line_removals` row.
 * - `paid` is the Payments that still count: every Payment without a
 *   `payment_removals` row.
 * - `state` is derived from those two, or `voided` when a `bill_voids` row
 *   exists (spec §5.6). A Bill with no Lines owes nothing and is Paid.
 * - the current Customer and note come from the `bill_edits` facts, newest
 *   last: the last edit of a field wins, `null` included. A field never
 *   edited is still what the Bill was created for — the facts
 *   `opened_customer_id` and `opened_note` of the creation row, which
 *   `recordSelection` writes and nothing moves afterwards (migration 0019).
 *
 * `revision` is not rebuilt: it is a counter, not derived from the facts, and
 * nothing but concurrency reads it (spec §7.3).
 *
 * Stock:
 *
 * - a Line that moved Stock when it was written (`lines.moved_stock`, the fact
 *   ticket 06 records) lowers it by its quantity; the Line's removal and its
 *   Bill's void put those units back, once per Line (spec §5.7), from the
 *   Line's own fact and not the Item's flag today (ticket 04's trap).
 * - an Adjustment moves Stock by its signed units, and cancelling it reverses
 *   that. An Adjustment fact only exists when the Item was stock-tracked when
 *   it was recorded (`adjustmentStatements`), and since ticket 19 its
 *   cancellation reverses the Adjustment's own effect whatever the flag says
 *   today — the same rule as a removed Line's units. Without that rule a
 *   cancellation recorded after tracking was switched off moved nothing, and
 *   no fact recorded it, so no rebuild could reproduce the live value.
 * - a Count sets Stock to the units found, so it is a reset in the replay:
 *   what follows it is added to the found value, what preceded it is
 *   forgotten. `last_counted_at` is the instant of the Item's newest Count.
 * - a Stock row exists exactly when the Item has at least one of those facts;
 *   an Item with no row has a Stock of zero (ticket 04).
 *
 * The replay orders events by `(at, kind, seq)`: the instant the operation
 * recorded, then the kind of fact, then its rowid. Two operations never share
 * an instant in practice (every operation reads the clock), and the kind and
 * rowid break any tie deterministically.
 */

/** The facts of one Bill and the projections derived from them. */
const BILL_FACTS = `
-- The Bill's current figures from the Lines and Payments that still count.
bill_figures AS (
  SELECT b.id AS id, b.opened_customer_id AS created_customer_id, b.opened_note AS created_note,
         COALESCE((SELECT SUM(l.quantity * l.unit_price)
                   FROM lines l LEFT JOIN line_removals r ON r.line_id = l.id
                   WHERE l.bill_id = b.id AND r.id IS NULL), 0) AS total,
         COALESCE((SELECT SUM(p.amount)
                   FROM payments p LEFT JOIN payment_removals r ON r.payment_id = p.id
                   WHERE p.bill_id = b.id AND r.id IS NULL), 0) AS paid
  FROM bills b
),
bill_rebuilt AS (
  SELECT f.id AS id, f.total AS total, f.paid AS paid,
         CASE WHEN EXISTS (SELECT 1 FROM bill_voids v WHERE v.bill_id = f.id) THEN 'voided'
              WHEN f.paid >= f.total THEN 'paid'
              WHEN f.paid > 0 THEN 'partial'
              ELSE 'open' END AS state,
         CASE WHEN EXISTS (SELECT 1 FROM bill_edits e WHERE e.bill_id = f.id AND e.field = 'customer')
              THEN (SELECT e.new_value FROM bill_edits e
                    WHERE e.bill_id = f.id AND e.field = 'customer'
                    ORDER BY e.edited_at DESC, e.rowid DESC LIMIT 1)
              ELSE f.created_customer_id END AS customer_id,
         CASE WHEN EXISTS (SELECT 1 FROM bill_edits e WHERE e.bill_id = f.id AND e.field = 'note')
              THEN (SELECT e.new_value FROM bill_edits e
                    WHERE e.bill_id = f.id AND e.field = 'note'
                    ORDER BY e.edited_at DESC, e.rowid DESC LIMIT 1)
              ELSE f.created_note END AS note
  FROM bill_figures f
)`;

/**
 * Every fact that moved Stock, and the replay that recomputes it. D1 allows at
 * most five terms in one compound SELECT, so the events are built from two
 * sub-unions.
 */
const STOCK_FACTS = `
-- Every fact that moved Stock by a relative amount, in the order it happened:
-- kind 0 a Line added, 1 a Line removed, 2 a Voided Bill, 3 an Adjustment,
-- 4 a cancelled Adjustment.
stock_deltas AS (
  SELECT l.item_id AS item_id, l.added_at AS at, 0 AS kind, l.rowid AS seq,
         -l.quantity AS delta
  FROM lines l WHERE l.moved_stock = 1
  UNION ALL
  SELECT l.item_id, r.removed_at, 1, r.rowid, l.quantity
  FROM line_removals r JOIN lines l ON l.id = r.line_id
  WHERE l.moved_stock = 1
  UNION ALL
  SELECT l.item_id, v.voided_at, 2, v.rowid, l.quantity
  FROM bill_voids v JOIN lines l ON l.bill_id = v.bill_id
  LEFT JOIN line_removals r ON r.line_id = l.id
  WHERE l.moved_stock = 1 AND r.id IS NULL
  UNION ALL
  SELECT a.item_id, a.recorded_at, 3, a.rowid,
         CASE a.reason WHEN 'restock' THEN a.units ELSE -a.units END
  FROM adjustments a
  UNION ALL
  SELECT a.item_id, c.cancelled_at, 4, c.rowid,
         CASE a.reason WHEN 'restock' THEN -a.units ELSE a.units END
  FROM adjustment_cancellations c JOIN adjustments a ON a.id = c.adjustment_id
),
-- The Counts, which are absolute instead: kind 5.
stock_counts AS (
  SELECT cl.item_id AS item_id, c.recorded_at AS at, 5 AS kind, cl.rowid AS seq,
         cl.units_found AS found
  FROM count_lines cl JOIN counts c ON c.id = cl.count_id
),
-- Every event, in the order it happened.
stock_events AS (
  SELECT item_id, at, kind, seq, delta, NULL AS found FROM stock_deltas
  UNION ALL
  SELECT item_id, at, kind, seq, NULL AS delta, found FROM stock_counts
),
-- The Stock a Count replaced, before it, and the Sum of every relative
-- change. A Count is absolute, so the Stock is every delta that ever
-- happened, plus what the newest Count found beyond the deltas before it
-- (the earlier Counts are already represented in those deltas).
stock_replay AS (
  SELECT item_id, at, kind, seq, delta, found,
         COALESCE(SUM(delta) OVER (
           PARTITION BY item_id ORDER BY at, kind, seq
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before
  FROM stock_events
),
stock_totals AS (
  -- COALESCE: an Item whose only facts are Counts has no delta to add.
  SELECT item_id, COALESCE(SUM(delta), 0) AS total_delta FROM stock_events GROUP BY item_id
),
stock_newest_count AS (
  SELECT item_id, found - before AS reset FROM (
    SELECT item_id, found, before,
           ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY at DESC, kind DESC, seq DESC) AS position
    FROM stock_replay WHERE found IS NOT NULL
  ) WHERE position = 1
),
stock_rebuilt AS (
  SELECT t.item_id AS item_id,
         t.total_delta + COALESCE(c.reset, 0) AS units,
         (SELECT MAX(e.at) FROM stock_events e
          WHERE e.item_id = t.item_id AND e.found IS NOT NULL) AS last_counted_at
  FROM stock_totals t LEFT JOIN stock_newest_count c ON c.item_id = t.item_id
)`;

/** One difference between a live projection and the facts. */
export interface ProjectionDifference {
  /** The projection at fault: `bill` or `stock`. */
  readonly projection: string;
  /** The Bill's or the Item's id. */
  readonly id: string;
  /** The column: `total`, `paid`, `state`, `customer_id`, `note`, `units`, `last_counted_at`. */
  readonly field: string;
  readonly live: string | number | null;
  readonly rebuilt: string | number | null;
}

/**
 * Every projection that disagrees with the facts, one row per field, ordered
 * by projection, id and field. An empty result means the live values are what
 * the facts say.
 *
 * Differences are reported where a value disagrees, including a Stock row
 * whose facts do not justify it (its rebuilt value is `null`) and a missing
 * Stock row (its live value is `null`).
 */
export const verifyProjectionsSql = `WITH
${BILL_FACTS},
${STOCK_FACTS}
SELECT projection, id, field, live, rebuilt FROM (
  SELECT * FROM (
    SELECT 'bill' AS projection, b.id AS id, 'total' AS field, b.total AS live, r.total AS rebuilt
    FROM bills b JOIN bill_rebuilt r ON r.id = b.id WHERE b.total IS NOT r.total
    UNION ALL
    SELECT 'bill', b.id, 'paid', b.paid, r.paid
    FROM bills b JOIN bill_rebuilt r ON r.id = b.id WHERE b.paid IS NOT r.paid
    UNION ALL
    SELECT 'bill', b.id, 'state', b.state, r.state
    FROM bills b JOIN bill_rebuilt r ON r.id = b.id WHERE b.state IS NOT r.state
    UNION ALL
    SELECT 'bill', b.id, 'customer_id', b.customer_id, r.customer_id
    FROM bills b JOIN bill_rebuilt r ON r.id = b.id WHERE b.customer_id IS NOT r.customer_id
    UNION ALL
    SELECT 'bill', b.id, 'note', b.note, r.note
    FROM bills b JOIN bill_rebuilt r ON r.id = b.id WHERE b.note IS NOT r.note
  )
  UNION ALL
  SELECT * FROM (
    SELECT 'stock' AS projection, r.item_id AS id, 'units' AS field,
           COALESCE(s.units, 0) AS live, r.units AS rebuilt
    FROM stock_rebuilt r LEFT JOIN stock_levels s ON s.item_id = r.item_id
    WHERE COALESCE(s.units, 0) IS NOT r.units
    UNION ALL
    SELECT 'stock', r.item_id, 'last_counted_at', s.last_counted_at, r.last_counted_at
    FROM stock_rebuilt r LEFT JOIN stock_levels s ON s.item_id = r.item_id
    WHERE s.last_counted_at IS NOT r.last_counted_at
    UNION ALL
    SELECT 'stock', s.item_id, 'units', s.units, NULL
    FROM stock_levels s
    WHERE s.item_id NOT IN (SELECT item_id FROM stock_rebuilt) AND s.units <> 0
    UNION ALL
    SELECT 'stock', s.item_id, 'last_counted_at', s.last_counted_at, NULL
    FROM stock_levels s
    WHERE s.item_id NOT IN (SELECT item_id FROM stock_rebuilt) AND s.last_counted_at IS NOT NULL
  )
) ORDER BY projection, id, field`;

/** One statement of the rebuild, and what it rewrites, for the report. */
export interface RebuildStatement {
  readonly label: string;
  readonly sql: string;
}

/**
 * The rebuild, as `wrangler d1 execute` runs it: one statement each, in this
 * order. Each statement is atomic by itself and rewrites only the rows that
 * disagree, so a second run changes nothing and an interrupted one is
 * finished by the next.
 */
export const rebuildProjectionStatements: ReadonlyArray<RebuildStatement> = [
  {
    label: "Bills",
    sql: `WITH
${BILL_FACTS}
UPDATE bills
SET total = r.total, paid = r.paid, state = r.state, customer_id = r.customer_id, note = r.note
FROM bill_rebuilt r
WHERE bills.id = r.id
  AND (bills.total IS NOT r.total OR bills.paid IS NOT r.paid OR bills.state IS NOT r.state
       OR bills.customer_id IS NOT r.customer_id OR bills.note IS NOT r.note)`,
  },
  {
    label: "Stock",
    sql: `WITH
${STOCK_FACTS}
INSERT INTO stock_levels (item_id, units, last_counted_at)
SELECT r.item_id, r.units, r.last_counted_at
FROM stock_rebuilt r LEFT JOIN stock_levels s ON s.item_id = r.item_id
WHERE COALESCE(s.units, 0) IS NOT r.units OR s.last_counted_at IS NOT r.last_counted_at
ON CONFLICT (item_id) DO UPDATE SET units = excluded.units, last_counted_at = excluded.last_counted_at`,
  },
  {
    label: "Stock rows without facts",
    sql: `WITH
${STOCK_FACTS}
DELETE FROM stock_levels WHERE item_id NOT IN (SELECT item_id FROM stock_rebuilt)`,
  },
];
