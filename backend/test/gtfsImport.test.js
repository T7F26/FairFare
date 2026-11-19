"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../src/db");
const { importGtfs } = require("../src/gtfsImport");

const STAGE_TABLES = [
  "stage_stops", "stage_routes", "stage_trips", "stage_stop_times",
  "stage_fares", "stage_fare_rules", "stage_shapes", "stage_calendar",
  "stage_calendar_dates",
];

function validatedFeed(label) {
  return {
    valid: true,
    agencyCheck: { status: "matched" },
    tables: {
      "stops.txt": [
        { stop_id: "S1", stop_name: `${label} Central`, stop_lat: "43.59", stop_lon: "-79.64", zone_id: "Z1" },
        { stop_id: "S2", stop_name: `${label} Park`, stop_lat: "43.68", stop_lon: "-79.62" },
      ],
      "routes.txt": [{ route_id: "R1", agency_id: "LOCAL", route_short_name: label, route_type: "3" }],
      "trips.txt": [{ route_id: "R1", service_id: "WK", trip_id: "T1", trip_headsign: label }],
      "stop_times.txt": [
        { trip_id: "T1", arrival_time: "08:00:00", departure_time: "08:00:00", stop_id: "S1", stop_sequence: "1" },
        { trip_id: "T1", arrival_time: "08:20:00", departure_time: "08:20:00", stop_id: "S2", stop_sequence: "2" },
      ],
      "calendar.txt": [{
        service_id: "WK", monday: "1", tuesday: "1", wednesday: "1", thursday: "1",
        friday: "1", saturday: "0", sunday: "0", start_date: "20260101", end_date: "20261231",
      }],
      "calendar_dates.txt": [{ service_id: "WK", date: "20261119", exception_type: "1" }],
    },
  };
}

function mockStagingDatabase(t, seed = {}) {
  // This fake checks the caller's SQL boundary and transaction order, not PostgreSQL itself.
  let committed = Object.fromEntries(STAGE_TABLES.map((table) => [table, structuredClone(seed[table] || [])]));
  let nextFailure;
  const events = [];
  const clients = [];
  const directQuery = t.mock.method(pool, "query", async () => {
    assert.fail("All staging queries must use the transaction's connected client");
  });
  const connect = t.mock.method(pool, "connect", async () => {
    let transaction = null;
    let locked = false;
    const client = {
      releases: 0,
      async query(sql, parameters = []) {
        const normalized = sql.trim().replace(/\s+/g, " ");
        if (normalized === "BEGIN") {
          assert.equal(transaction, null);
          transaction = structuredClone(committed);
          events.push("BEGIN");
          return { rows: [] };
        }
        assert.notEqual(transaction, null, "A staging operation must be inside a transaction");
        if (normalized === "SELECT pg_advisory_xact_lock($1, $2)") {
          assert.deepEqual(parameters, [16421, 16]);
          assert.equal(locked, false);
          locked = true;
          events.push("LOCK");
          return { rows: [] };
        }
        if (normalized === "ROLLBACK") {
          transaction = null;
          locked = false;
          events.push("ROLLBACK");
          return { rows: [] };
        }
        assert.equal(locked, true, "Acquire the shared staging lock before changing rows");
        if (normalized === "COMMIT") {
          committed = transaction;
          transaction = null;
          locked = false;
          events.push("COMMIT");
          return { rows: [] };
        }
        const truncate = normalized.match(/^TRUNCATE (.+)$/i);
        if (truncate) {
          const tables = truncate[1].split(",").map((table) => table.trim());
          assert.deepEqual([...tables].sort(), [...STAGE_TABLES].sort());
          for (const table of tables) transaction[table] = [];
          events.push("TRUNCATE");
          return { rows: [] };
        }
        const insertion = normalized.match(/^INSERT INTO (stage_[a-z_]+) \(([^)]+)\) VALUES (.+)$/i);
        // Anything else, including a live-table write or publishing function, fails this test.
        assert.ok(insertion, `Unexpected SQL at the staging-only boundary: ${normalized}`);
        const [, table, columnList] = insertion;
        assert.ok(STAGE_TABLES.includes(table));
        const columns = columnList.split(",").map((column) => column.trim());
        assert.ok(parameters.length > 0 && parameters.length % columns.length === 0);
        const placeholders = [...normalized.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
        assert.deepEqual(placeholders, parameters.map((_, index) => index + 1));
        events.push(`INSERT ${table}`);
        if (nextFailure?.table === table) {
          const error = nextFailure.error;
          nextFailure = undefined;
          throw error;
        }
        for (let offset = 0; offset < parameters.length; offset += columns.length) {
          transaction[table].push(Object.fromEntries(columns.map((column, index) => [column, parameters[offset + index]])));
        }
        return { rows: [], rowCount: parameters.length / columns.length };
      },
      release() {
        assert.equal(transaction, null, "Finish or roll back the transaction before releasing");
        client.releases += 1;
        events.push("RELEASE");
      },
    };
    clients.push(client);
    return client;
  });
  return {
    events, clients, connect, directQuery,
    rows: () => structuredClone(committed),
    failNextInsert(table, error) { nextFailure = { table, error }; },
  };
}

test("a successful upload commits pending rows without publishing or clearing them afterward", async (t) => {
  const database = mockStagingDatabase(t, {
    stage_stops: [{ stop_id: "OLD" }],
    stage_fares: [{ fare_id: "OLD_FARE" }],
    stage_fare_rules: [{ fare_id: "OLD_FARE" }],
    stage_shapes: [{ shape_id: "OLD_SHAPE" }],
  });

  const result = await importGtfs(validatedFeed("First"), "test_agency_alpha");

  assert.deepEqual(result, {
    status: "pending_review",
    recordsImported: 8,
    recordCounts: {
      "stops.txt": 2, "routes.txt": 1, "trips.txt": 1,
      "stop_times.txt": 2, "calendar.txt": 1, "calendar_dates.txt": 1,
    },
  });
  assert.deepEqual(database.events, [
    "BEGIN", "LOCK", "TRUNCATE", "INSERT stage_stops", "INSERT stage_routes",
    "INSERT stage_trips", "INSERT stage_stop_times", "INSERT stage_calendar",
    "INSERT stage_calendar_dates", "COMMIT", "RELEASE",
  ]);
  const rows = database.rows();
  assert.equal(rows.stage_stops.length, 2);
  assert.equal(rows.stage_stops[0].stop_name, "First Central");
  assert.equal(rows.stage_stops[1].zone_id, null);
  assert.equal(rows.stage_calendar_dates.length, 1);
  assert.deepEqual(rows.stage_fares, []);
  assert.deepEqual(rows.stage_fare_rules, []);
  assert.deepEqual(rows.stage_shapes, []);
  assert.equal(database.clients[0].releases, 1);
  assert.equal(database.directQuery.mock.callCount(), 0);
});

test("a second successful upload for the same agency replaces the previous global staging rows", async (t) => {
  const database = mockStagingDatabase(t);
  await importGtfs(validatedFeed("First"), "test_agency_alpha");
  await importGtfs(validatedFeed("Second"), "test_agency_alpha");

  const rows = database.rows();
  assert.equal(rows.stage_stops.length, 2);
  assert.equal(rows.stage_stops[0].stop_name, "Second Central");
  assert.equal(rows.stage_routes.length, 1);
  assert.equal(rows.stage_routes[0].route_short_name, "Second");
  assert.equal(database.events.filter((event) => event === "TRUNCATE").length, 2);
  assert.equal(database.events.filter((event) => event === "COMMIT").length, 2);
  assert.deepEqual(database.clients.map((client) => client.releases), [1, 1]);
});

test("a successful upload for another agency also replaces the one shared staging dataset", async (t) => {
  const database = mockStagingDatabase(t);
  await importGtfs(validatedFeed("Alpha"), "test_agency_alpha");
  const nextFeed = validatedFeed("Beta");
  delete nextFeed.tables["calendar_dates.txt"];
  const result = await importGtfs(nextFeed, "test_agency_beta");

  // Existing tables have no per-agency pending slot; this documents their shared scope.
  const rows = database.rows();
  assert.equal(rows.stage_stops.length, 2);
  assert.equal(rows.stage_stops[0].stop_name, "Beta Central");
  assert.equal(rows.stage_routes.length, 1);
  assert.equal(rows.stage_routes[0].route_short_name, "Beta");
  assert.deepEqual(rows.stage_calendar_dates, []);
  assert.equal(result.recordCounts["calendar_dates.txt"], 0);
  assert.equal(result.status, "pending_review");
  assert.deepEqual(database.clients.map((client) => client.releases), [1, 1]);
});

test("failure after a staging insert rolls back and preserves the previous successful upload", async (t) => {
  const database = mockStagingDatabase(t);
  await importGtfs(validatedFeed("Previous"), "test_agency_alpha");
  const previousRows = database.rows();
  const previousEventCount = database.events.length;
  const failure = new Error("Fixture staging insert failed");
  database.failNextInsert("stage_routes", failure);

  await assert.rejects(importGtfs(validatedFeed("Rejected"), "test_agency_beta"), (error) => error === failure);

  assert.deepEqual(database.rows(), previousRows);
  assert.deepEqual(database.events.slice(previousEventCount), [
    "BEGIN", "LOCK", "TRUNCATE", "INSERT stage_stops", "INSERT stage_routes", "ROLLBACK", "RELEASE",
  ]);
  assert.deepEqual(database.clients.map((client) => client.releases), [1, 1]);
});

test("invalid input or an unverified agency is rejected before acquiring a database connection", async (t) => {
  const database = mockStagingDatabase(t);
  for (const [input, agencyId, message] of [
    [undefined, "test_agency_alpha", /must be validated/],
    [{ ...validatedFeed("Invalid"), valid: false }, "test_agency_alpha", /must be validated/],
    [{ valid: true, agencyCheck: { status: "matched" } }, "test_agency_alpha", /must be validated/],
    [{ ...validatedFeed("Unverified"), agencyCheck: { status: "skipped" } }, "test_agency_alpha", /must be verified/],
    [validatedFeed("Invalid agency"), "invalid-agency", /Invalid agency prefix/],
  ]) {
    await assert.rejects(importGtfs(input, agencyId), message);
  }
  assert.equal(database.connect.mock.callCount(), 0);
  assert.equal(database.directQuery.mock.callCount(), 0);
  assert.deepEqual(database.events, []);
});
