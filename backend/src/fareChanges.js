"use strict";
// Review Updates: fare changes in the latest pending GTFS import - Issue #23
const pool = require("./db");

// Lists the fare changes for the agency whose upload is waiting in staging.
// Uses compare_fares (backend/scripts/compare_new_fares.sql) and the
// pending_import table (backend/scripts/pending_import.sql).
async function listFareChanges() {
  const pending = await pool.query(
    "SELECT agency_id, uploaded_at FROM pending_import WHERE id = 1"
  );

  // Nothing has been uploaded yet, so there is nothing to review.
  if (pending.rowCount === 0) {
    return { agencyId: null, uploadedAt: null, count: 0, changes: [] };
  }

  const { agency_id: agencyId, uploaded_at: uploadedAt } = pending.rows[0];
  const result = await pool.query(
    `SELECT fare_id, new_price, old_price, currency_type, transfer_duration, changed_type
     FROM compare_fares($1)
     ORDER BY fare_id`,
    [agencyId]
  );

  // Field names match the Review Updates screen (frontend/src/ReviewUpdates.jsx).
  const changes = result.rows.map((row) => ({
    fare_id: row.fare_id,
    agency_id: agencyId,
    old_price: row.old_price,
    new_price: row.new_price,
    currency_type: row.currency_type,
    transfer_duration: row.transfer_duration,
    changed_type: row.changed_type,
  }));

  return { agencyId, uploadedAt, count: changes.length, changes };
}

module.exports = { listFareChanges };
