"use strict";

const pool = require("./db");

async function listPublishedFares(agencyId) {
  if (typeof agencyId !== "string" || !/^[a-z][a-z0-9_]{0,99}$/.test(agencyId)) {
    throw new TypeError("A valid agency ID is required");
  }

  // Rider fare reads use the live table, including when it has no rows for this agency.
  const result = await pool.query(
    `SELECT fare_id, price, currency_type, payment_method, transfers, transfer_duration, agency_id
     FROM fares
     WHERE agency_id = $1
     ORDER BY fare_id`,
    [agencyId]
  );

  return result.rows;
}

module.exports = { listPublishedFares };
