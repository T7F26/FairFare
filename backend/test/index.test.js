const test = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const gtfsModule = require("../src/validation/gtfs");
const app = require("../src/index");

test("POST /api/admin/import - success", async (t) => {
  // Mock the success response
  t.mock.method(gtfsModule, "validateGtfsUpload", async () => ({
    valid: true,
    recordCounts: { "stops.txt": 5 }
  }));

  const response = await request(app)
    .post("/api/admin/import")
    .field("agency", "TTC")
    .attach("file", Buffer.from("fake zip data"), "feed.zip");

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.valid, true);
});

test("POST /api/admin/import - validation failure", async (t) => {
  // Mock the failure response
  t.mock.method(gtfsModule, "validateGtfsUpload", async () => {
    const error = new Error("Invalid");
    error.code = "INVALID_GTFS";
    error.toJSON = () => ({ code: "INVALID_GTFS", message: "Invalid GTFS" });
    throw error;
  });

  const response = await request(app)
    .post("/api/admin/import")
    .field("agency", "TTC")
    .attach("file", Buffer.from("fake zip data"), "feed.zip");

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.code, "INVALID_GTFS");
});