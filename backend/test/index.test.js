const test = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
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

test("POST /api/admin/import - success", async (t) => {
  mockAgencyLookup(t);
  t.mock.method(gtfsModule, "validateGtfsUpload", async () => ({
    valid: true,
    tables: {},
    agencyCheck: { status: "matched" },
  }));
  t.mock.method(gtfsImport, "importGtfs", async () => ({
    recordsImported: 5,
    recordCounts: { "stops.txt": 5 },
  }));

  const response = await request(app)
    .post("/api/admin/import")
    .field("agency", "TTC")
    .attach("file", Buffer.from("fake zip data"), "feed.zip");

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.valid, true);
  assert.strictEqual(response.body.recordsImported, 5);
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
