const test = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const { ZipFile } = require("yazl");
const gtfsModule = require("../src/validation/gtfs");
const gtfsImport = require("../src/gtfsImport");
const pool = require("../src/db");
const app = require("../src/index");
const { listPublishedFares } = require("../src/publishedFares");
const fareChanges = require("../src/fareChanges");
const riderCategories = require("../src/riderCategories");

function mockAgencyLookup(t) {
  t.mock.method(pool, "query", async () => ({
    rowCount: 1,
    rows: [{ agency_id: "ttc", agency_name: "Toronto Transit Commission" }],
  }));
}

test("POST /api/admin/import - valid GTFS upload is staged for review", async (t) => {
  mockAgencyLookup(t);
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
  assert.strictEqual(importMock.mock.callCount(), 0);
});

test("POST /api/admin/import - no agency chosen", async () => {
  const response = await request(app)
    .post("/api/admin/import")
    .attach("file", Buffer.from("fake zip data"), "feed.zip");

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.code, "AGENCY_MISMATCH");
});

function mockFareReviewDatabase(t) {
  const agencyId = "miway";
  const uploadedAt = "2026-11-20T18:00:00.000Z";
  const publishedFare = {
    fare_id: "miway_adult", agency_id: agencyId, price: "3.10", currency_type: "CAD",
    payment_method: 0, transfers: null, transfer_duration: 7200,
  };
  const pendingFare = {
    fare_id: publishedFare.fare_id, old_price: publishedFare.price, new_price: "3.50",
    currency_type: "CAD", transfer_duration: 7200, changed_type: "Price changed",
  };
  let status = "waiting";
  const statusWrites = [];
  const comparisonSource = "FROM compare_fares($1) cf LEFT JOIN fare_change_statuses fcs "
    + "ON fcs.agency_id = $1 AND fcs.fare_id = cf.fare_id";

  const query = t.mock.method(pool, "query", async (sql, parameters = []) => {
    const statement = sql.trim().replace(/\s+/g, " ");
    if (statement === "SELECT agency_id, uploaded_at FROM pending_import WHERE id = 1") {
      assert.deepStrictEqual(parameters, []);
      return { rowCount: 1, rows: [{ agency_id: agencyId, uploaded_at: uploadedAt }] };
    }
    if (statement === "SELECT 1 FROM compare_fares($1) WHERE fare_id = $2") {
      assert.deepStrictEqual(parameters, [agencyId, pendingFare.fare_id]);
      return { rowCount: 1, rows: [{}] };
    }
    if (statement === "INSERT INTO fare_change_statuses (agency_id, fare_id, status, updated_at) "
      + "VALUES ($1, $2, $3, NOW()) ON CONFLICT (agency_id, fare_id) "
      + "DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()") {
      assert.deepStrictEqual(parameters.slice(0, 2), [agencyId, pendingFare.fare_id]);
      status = parameters[2];
      statusWrites.push([...parameters]);
      return { rowCount: 1, rows: [] };
    }
    if (statement === "SELECT COUNT(*)::int AS total_count, "
      + "COUNT(*) FILTER (WHERE COALESCE(fcs.status, 'waiting') = 'approved')::int AS approved_count "
      + comparisonSource) {
      assert.deepStrictEqual(parameters, [agencyId]);
      return { rowCount: 1, rows: [{ total_count: 1, approved_count: status === "approved" ? 1 : 0 }] };
    }
    if (statement.startsWith("SELECT cf.fare_id,") && statement.endsWith(comparisonSource + " ORDER BY cf.fare_id")) {
      assert.deepStrictEqual(parameters, [agencyId]);
      return { rowCount: 1, rows: [{ ...pendingFare, status }] };
    }
    if (/^SELECT [\w, ]+ FROM fares WHERE agency_id = \$1 ORDER BY fare_id$/i.test(statement)) {
      assert.deepStrictEqual(parameters, [agencyId]);
      return { rowCount: 1, rows: [{ ...publishedFare }] };
    }
    assert.fail(`Unexpected query during fare review: ${statement}`);
  });
  const connect = t.mock.method(pool, "connect", async () => {
    assert.fail("Unexpected database client during fare review");
  });
  return { agencyId, uploadedAt, publishedFare, pendingFare, query, connect, statusWrites };
}

test("reviewing a pending fare displays the new price without changing the published fare read", async (t) => {
  const { agencyId, uploadedAt, publishedFare, pendingFare, query, connect, statusWrites } = mockFareReviewDatabase(t);
  const beforeReview = await listPublishedFares(agencyId);
  const response = await request(app).get("/api/admin/fare-changes");
  const afterReview = await listPublishedFares(agencyId);

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(response.body, {
    agencyId, uploadedAt, count: 1, changes: [{ ...pendingFare, agency_id: agencyId, status: "waiting" }],
  });
  assert.deepStrictEqual(beforeReview, [publishedFare]);
  assert.deepStrictEqual(afterReview, [publishedFare]);
  assert.strictEqual(query.mock.callCount(), 4);
  assert.strictEqual(connect.mock.callCount(), 0);
  assert.deepStrictEqual(statusWrites, []);
});

test("approving and undoing a pending fare leave the published price unchanged", async (t) => {
  const { agencyId, publishedFare, pendingFare, statusWrites } = mockFareReviewDatabase(t);
  const fareId = pendingFare.fare_id;
  const statusUrl = `/api/admin/fare-changes/${fareId}/status`;
  assert.deepStrictEqual(await listPublishedFares(agencyId), [publishedFare]);

  const approved = await request(app).patch(statusUrl).send({ status: "approved" }).expect(200);
  assert.deepStrictEqual(approved.body, { fare_id: fareId, agency_id: agencyId, status: "approved", allApproved: true });
  const approvedReview = await request(app).get("/api/admin/fare-changes").expect(200);
  assert.deepStrictEqual(approvedReview.body.changes, [{ ...pendingFare, agency_id: agencyId, status: "approved" }]);
  assert.deepStrictEqual(await listPublishedFares(agencyId), [publishedFare]);

  const undone = await request(app).patch(statusUrl).send({ status: "waiting" }).expect(200);
  assert.deepStrictEqual(undone.body, { fare_id: fareId, agency_id: agencyId, status: "waiting", allApproved: false });
  const undoneReview = await request(app).get("/api/admin/fare-changes").expect(200);
  assert.deepStrictEqual(undoneReview.body.changes, [{ ...pendingFare, agency_id: agencyId, status: "waiting" }]);
  assert.deepStrictEqual(await listPublishedFares(agencyId), [publishedFare]);
  assert.deepStrictEqual(statusWrites, [[agencyId, fareId, "approved"], [agencyId, fareId, "waiting"]]);
});

test("POST /api/admin/fare-changes/publish - no approved changes", async (t) => {
  t.mock.method(fareChanges, "publishFareChanges", async () => {
    throw new Error("No approved changes to publish");
  });

  const response = await request(app).post("/api/admin/fare-changes/publish");

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.code, "NO_APPROVED_CHANGES");
});

test("POST /api/admin/fare-changes/publish - successfully publishes changes", async (t) => {
  t.mock.method(fareChanges, "publishFareChanges", async () => ({
    agencyId: "ttc",
    published_count: 5
  }));

  const response = await request(app).post("/api/admin/fare-changes/publish");

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(response.body, { agencyId: "ttc", published_count: 5 });
});

test("GET /api/rider-categories - returns categories, discounts, and proof requirements", async (t) => {
  const sampleCategories = [
    {
      category_id: 1,
      category_name: "Senior",
      proof_required: "Government ID / Senior fare card",
      discounts: { ttc: 25, gotransit: 40 },
    },
  ];
  t.mock.method(riderCategories, "listRiderCategories", async () => sampleCategories);

  const response = await request(app).get("/api/rider-categories");

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(response.body, sampleCategories);
});