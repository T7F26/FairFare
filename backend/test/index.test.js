const test = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const { ZipFile } = require("yazl");
const gtfsModule = require("../src/validation/gtfs");
const gtfsImport = require("../src/gtfsImport");
const pool = require("../src/db");
const app = require("../src/index");

// The route checks the agencies table first, so fake that query
function mockAgencyLookup(t) {
  t.mock.method(pool, "query", async () => ({
    rowCount: 1,
    rows: [{ agency_id: "ttc", agency_name: "Toronto Transit Commission" }],
  }));
}

test("POST /api/admin/import - valid GTFS upload is staged for review", async (t) => {
  mockAgencyLookup(t);
  // Exercise the real validator and importer without connecting to PostgreSQL.
  const queries = [];
  t.mock.method(pool, "connect", async () => ({
    async query(sql) { queries.push(sql.trim()); },
    release() {},
  }));

  const zip = new ZipFile();
  for (const [name, content] of Object.entries({
    "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nttc,TTC,https://example.test,America/Toronto\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nS1,First Stop,43.59,-79.64\nS2,Second Stop,43.68,-79.62\n",
    "routes.txt": "route_id,agency_id,route_short_name,route_type\nR1,ttc,7,3\n",
    "trips.txt": "route_id,service_id,trip_id\nR1,WK,T1\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,08:00:00,08:00:00,S1,1\nT1,08:20:00,08:20:00,S2,2\n",
    "calendar_dates.txt": "service_id,date,exception_type\nWK,20261119,1\n",
  })) {
    zip.addBuffer(Buffer.from(content), name);
  }
  zip.end();
  const chunks = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk);

  const response = await request(app)
    .post("/api/admin/import")
    .field("agency", "TTC")
    .attach("file", Buffer.concat(chunks), "feed.zip");

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.valid, true);
  assert.strictEqual(response.body.status, "pending_review");
  assert.strictEqual(response.body.recordsImported, 7);
  assert.strictEqual(response.body.recordCounts["stops.txt"], 2);
  assert.ok(queries.some((sql) => sql.startsWith("INSERT INTO stage_stops")));
  assert.ok(queries.every((sql) => !sql.includes("process_gtfs_records")));
  assert.strictEqual(queries.at(-1), "COMMIT");
});

test("POST /api/admin/import - validation failure", async (t) => {
  mockAgencyLookup(t);
  t.mock.method(gtfsModule, "validateGtfsUpload", async () => {
    const error = new Error("Invalid");
    error.code = "INVALID_GTFS";
    error.toJSON = () => ({ code: "INVALID_GTFS", message: "Invalid GTFS" });
    throw error;
  });
  const importMock = t.mock.method(gtfsImport, "importGtfs", async () => ({}));

  const response = await request(app)
    .post("/api/admin/import")
    .field("agency", "TTC")
    .attach("file", Buffer.from("fake zip data"), "feed.zip");

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.code, "INVALID_GTFS");
  // Nothing is written to the database when validation fails
  assert.strictEqual(importMock.mock.callCount(), 0);
});

test("POST /api/admin/import - no agency chosen", async () => {
  const response = await request(app)
    .post("/api/admin/import")
    .attach("file", Buffer.from("fake zip data"), "feed.zip");

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.code, "AGENCY_MISMATCH");
});
