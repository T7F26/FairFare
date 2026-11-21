"use strict";
const pool = require("./db");

const STAGING = [
  {
    file: "stops.txt",
    table: "stage_stops",
    columns: ["stop_id", "stop_name", "stop_lat", "stop_lon", "zone_id"],
  },
  {
    file: "routes.txt",
    table: "stage_routes",
    columns: [
      "route_id", "agency_id", "route_short_name",
      "route_long_name", "route_type",
    ],
  },
  {
    file: "trips.txt",
    table: "stage_trips",
    columns: [
      "route_id", "service_id", "trip_id",
      "trip_headsign", "shape_id",
    ],
  },
  {
    file: "stop_times.txt",
    table: "stage_stop_times",
    columns: [
      "trip_id", "arrival_time", "departure_time",
      "stop_id", "stop_sequence",
    ],
  },
  {
    file: "calendar.txt",
    table: "stage_calendar",
    columns: [
      "service_id", "monday", "tuesday",
      "wednesday", "thursday", "friday",
      "saturday", "sunday", "start_date", "end_date",
    ],
  },
  {
    file: "calendar_dates.txt",
    table: "stage_calendar_dates",
    columns: ["service_id", "date", "exception_type"],
  },
];

async function loadStage(client, config, rows) {
  const batchSize = 250;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const values = [];
    const placeholders = batch.map((row, index) => {
      const fields = config.columns.map((column, columnIndex) => {
        const value = row[column];
        values.push(value === undefined || value === "" ? null : value);
        return `$${index * config.columns.length + columnIndex + 1}`;
      });
      return `(${fields.join(", ")})`;
    });
    const sql = `
      INSERT INTO ${config.table}
      (${config.columns.join(", ")})
      VALUES ${placeholders.join(", ")}
    `;
    await client.query(sql, values);
  }
}

async function importGtfs(validatedResult, agencyPrefix) {
  if (!validatedResult?.valid || !validatedResult.tables) {
    throw new Error("GTFS data must be validated before importing");
  }
  if (validatedResult.agencyCheck?.status !== "matched") {
    throw new Error("Agency must be verified before importing");
  }
  if (!/^[a-z][a-z0-9_]*$/.test(agencyPrefix || "")) {
    throw new Error("Invalid agency prefix");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [16421, 16]);

    await client.query(`
      TRUNCATE
        stage_stops, stage_routes, stage_trips,
        stage_stop_times, stage_fares, stage_fare_rules,
        stage_shapes, stage_calendar, stage_calendar_dates
    `);

    let recordsImported = 0;
    const recordCounts = {};
    for (const config of STAGING) {
      const rows = validatedResult.tables[config.file] || [];
      await loadStage(client, config, rows);
      recordCounts[config.file] = rows.length;
      recordsImported += rows.length;
    }

    await client.query(
      `INSERT INTO pending_import (id, agency_id, uploaded_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE
       SET agency_id = EXCLUDED.agency_id, uploaded_at = EXCLUDED.uploaded_at`,
      [agencyPrefix]
    );

    await client.query(
      "DELETE FROM fare_change_statuses WHERE agency_id = $1",
      [agencyPrefix]
    );

    await client.query("COMMIT");
    return { status: "pending_review", recordsImported, recordCounts };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { importGtfs };