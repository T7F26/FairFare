"use strict";
const pool = require("./db");

const VALID_STATUSES = new Set(["approved", "waiting"]);

async function getActivePendingImport() {
  const pending = await pool.query(
    "SELECT agency_id, uploaded_at FROM pending_import WHERE id = 1"
  );
  if (pending.rowCount === 0) {
    return null;
  }
  return {
    agencyId: pending.rows[0].agency_id,
    uploadedAt: pending.rows[0].uploaded_at,
  };
}

// Lists the fare changes for the agency whose upload is waiting in staging.
// Uses compare_fares (backend/scripts/compare_new_fares.sql), the
// pending_import table (backend/scripts/pending_import.sql), and
// fare_change_statuses (backend/scripts/fare_change_statuses.sql).
async function listFareChanges() {
  const pending = await getActivePendingImport();

  if (!pending) {
    return { agencyId: null, uploadedAt: null, count: 0, changes: [] };
  }

  const { agencyId, uploadedAt } = pending;
  const result = await pool.query(
    `SELECT
       cf.fare_id,
       cf.new_price,
       cf.old_price,
       cf.currency_type,
       cf.transfer_duration,
       cf.changed_type,
       COALESCE(fcs.status, 'waiting') AS status
     FROM compare_fares($1) cf
     LEFT JOIN fare_change_statuses fcs
       ON fcs.agency_id = $1 AND fcs.fare_id = cf.fare_id
     ORDER BY cf.fare_id`,
    [agencyId]
  );

  const changes = result.rows.map((row) => ({
    fare_id: row.fare_id,
    agency_id: agencyId,
    old_price: row.old_price,
    new_price: row.new_price,
    currency_type: row.currency_type,
    transfer_duration: row.transfer_duration,
    changed_type: row.changed_type,
    status: row.status || "waiting",
  }));

  return { agencyId, uploadedAt, count: changes.length, changes };
}

async function areAllFareChangesApproved(agencyId) {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total_count,
       COUNT(*) FILTER (WHERE COALESCE(fcs.status, 'waiting') = 'approved')::int AS approved_count
     FROM compare_fares($1) cf
     LEFT JOIN fare_change_statuses fcs
       ON fcs.agency_id = $1 AND fcs.fare_id = cf.fare_id`,
    [agencyId]
  );

  const { total_count: totalCount, approved_count: approvedCount } = result.rows[0];
  return totalCount > 0 && totalCount === approvedCount;
}

async function setFareChangeStatus(fareId, status) {
  const normalizedFareId = String(fareId || "").trim();
  const normalizedStatus = String(status || "").trim().toLowerCase();

  if (!normalizedFareId) {
    const err = new Error("Fare ID is required.");
    err.statusCode = 400;
    err.code = "INVALID_FARE_ID";
    throw err;
  }

  if (!VALID_STATUSES.has(normalizedStatus)) {
    const err = new Error("Status must be 'approved' or 'waiting'.");
    err.statusCode = 400;
    err.code = "INVALID_STATUS";
    throw err;
  }

  const pending = await getActivePendingImport();
  if (!pending) {
    const err = new Error("No pending GTFS import found.");
    err.statusCode = 404;
    err.code = "NO_PENDING_IMPORT";
    throw err;
  }

  const { agencyId } = pending;

  const existsResult = await pool.query(
    "SELECT 1 FROM compare_fares($1) WHERE fare_id = $2",
    [agencyId, normalizedFareId]
  );
  if (existsResult.rowCount === 0) {
    const err = new Error("Fare change not found in current pending import.");
    err.statusCode = 404;
    err.code = "FARE_NOT_FOUND";
    throw err;
  }

  await pool.query(
    `INSERT INTO fare_change_statuses (agency_id, fare_id, status, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (agency_id, fare_id)
     DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
    [agencyId, normalizedFareId, normalizedStatus]
  );

  const allApproved = await areAllFareChangesApproved(agencyId);

  return {
    fare_id: normalizedFareId,
    agency_id: agencyId,
    status: normalizedStatus,
    allApproved,
  };
}
async function publishFareChanges(){
  const pending = await getActivePendingImport();
  if(!pending){
    const err = new Error("No pending GTFS import found.");
    err.statusCode = 404;
    err.code = "NO_PENDING_IMPORT";
    throw err;
  }
  const {agencyId} = pending;
  const result = await pool.query("SELECT publish_changes($1) AS published_count",[agencyId]);
  const published_count = result.rows[0].published_count;
  return { agencyId, published_count };
}

module.exports = { listFareChanges, setFareChangeStatus, publishFareChanges };