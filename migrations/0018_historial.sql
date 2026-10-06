-- Ticket 18. Historial pages over the union of the six fact tables, one
-- statement per table, each driven by the table's index on time so a page
-- reads a bounded number of rows whatever the history holds (spec §2.4,
-- §7.4). Tickets 10, 11 and 12 gave five of the tables a `_by_time` index;
-- cancelled Adjustments are a History entry of their own (spec §5.7), so
-- `adjustment_cancellations` needs the same.

CREATE INDEX adjustment_cancellations_by_time ON adjustment_cancellations (cancelled_at);
