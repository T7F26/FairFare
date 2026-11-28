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

  // Allow only reads and approval status writes, so any publication query fails the test.
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
    {
      category_id: 2,
      category_name: "Post-Secondary Student",
      proof_required: "Valid student ID",
      discounts: { gotransit: 40 },
    },
    {
      category_id: 3,
      category_name: "Adult",
      proof_required: null,
      discounts: {},
    },
  ];
  t.mock.method(riderCategories, "listRiderCategories", async () => sampleCategories);

  const response = await request(app).get("/api/rider-categories");

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(response.body, sampleCategories);
  // Agencies with no discount are omitted so the UI shows "-"
  assert.strictEqual(response.body[1].discounts.ttc, undefined);
  assert.deepStrictEqual(response.body[2].discounts, {});
});

test("GET /api/rider-categories - returns 500 when loading rider categories fails", async (t) => {
  t.mock.method(riderCategories, "listRiderCategories", async () => {
    throw new Error("Database error");
  });

  const response = await request(app).get("/api/rider-categories");

  assert.strictEqual(response.status, 500);
  assert.deepStrictEqual(response.body, {
    code: "RIDER_CATEGORIES_FAILED",
    message: "Could not load rider categories.",
  });
});

const discountUpdatePath = "/api/admin/rider-categories/17/discounts/ttc";
const existingDiscount = { discount_id: 81 };

function discountTransactionStart(categoryId, agencyId) {
  return [
    ["BEGIN ISOLATION LEVEL READ COMMITTED"],
    ["PAIR LOCK", [categoryId, agencyId]],
    ["TABLE LOCK"],
    ["TARGET", [categoryId, agencyId]],
  ];
}

function mockDiscountDatabase(t, {
  matches = [existingDiscount],
  storedValue,
  failAt,
  auditAvailable = true,
  targetExists = true,
  testWritesEnabled = true,
} = {}) {
  const flag = "FAIRFARE_ENABLE_TEST_DISCOUNT_WRITES";
  const previousFlag = process.env[flag];
  if (testWritesEnabled) process.env[flag] = "true";
  else delete process.env[flag];
  t.after(() => {
    if (previousFlag === undefined) delete process.env[flag];
    else process.env[flag] = previousFlag;
  });

  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      const statement = sql.trim().replace(/\s+/g, " ");

      if (["BEGIN ISOLATION LEVEL READ COMMITTED", "COMMIT", "ROLLBACK"].includes(statement)) {
        calls.push([statement]);
        return { rows: [] };
      }
      if (statement === "SELECT pg_advisory_xact_lock(hashtextextended('rider-discount:' || $1::text || ':' || $2::text, 0))") {
        calls.push(["PAIR LOCK", parameters]);
        return { rows: [] };
      }
      if (statement === "LOCK TABLE agency_discounts IN ROW EXCLUSIVE MODE") {
        calls.push(["TABLE LOCK"]);
        return { rows: [] };
      }
      if (statement.startsWith("SELECT rc.category_name, EXISTS")) {
        assert.match(statement, /pg_trigger/);
        assert.match(statement, /trg_discount_change/);
        assert.match(statement, /FROM rider_categories rc JOIN agencies a ON a\.agency_id = \$2 WHERE rc\.category_id = \$1 FOR KEY SHARE OF rc, a$/);
        calls.push(["TARGET", parameters]);
        return { rows: targetExists ? [{ category_name: "Senior", audit_ready: auditAvailable }] : [] };
      }
      if (statement === "SELECT discount_id FROM agency_discounts WHERE category_id = $1 AND agency_id = $2 ORDER BY discount_id LIMIT 2 FOR UPDATE") {
        calls.push(["MATCHES", parameters]);
        return { rowCount: matches.length, rows: matches };
      }
      if (statement.startsWith("UPDATE ")) {
        assert.strictEqual(statement,
          "UPDATE agency_discounts SET discount_percentage = $3 " +
          "WHERE category_id = $1 AND agency_id = $2 AND discount_id = $4 RETURNING discount_percentage");
        calls.push(["UPDATE", parameters]);
        if (failAt === "UPDATE") throw new Error("private update failure");
        return { rowCount: 1, rows: [{ discount_percentage: storedValue ?? String(parameters[2]) }] };
      }
      if (statement === "INSERT INTO agency_discounts (category_id, agency_id, discount_percentage) VALUES ($1, $2, $3) RETURNING discount_percentage") {
        calls.push(["INSERT", parameters]);
        if (failAt === "INSERT") throw new Error("private insert failure");
        return { rowCount: 1, rows: [{ discount_percentage: storedValue ?? String(parameters[2]) }] };
      }
      assert.fail(`Unexpected discount query: ${statement}`);
    },
    release() { calls.push(["RELEASE"]); },
  };

  const connect = t.mock.method(pool, "connect", async () => client);
  const poolQuery = t.mock.method(pool, "query", async () => {
    assert.fail("Discount changes must use the transaction client");
  });
  return { calls, connect, poolQuery };
}

for (const [percentage, storedValue, expected] of [
  [35, "35.00", 35],
  [0, "0.00", 0],
  [100, "100.00", 100],
  [35.125, "35.13", 35.13],
]) {
  test(`PATCH rider discount - saves ${percentage}% without a request user when test writes are enabled`, async (t) => {
    const { calls, connect } = mockDiscountDatabase(t, { storedValue });

    const response = await request(app).patch(discountUpdatePath).send({ discount_percentage: percentage });

    const discount = {
      category_id: 17,
      category_name: "Senior",
      agency_id: "ttc",
      discount_percentage: expected,
    };
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(response.body, { ...discount, message: "Senior updated" });
    assert.strictEqual(connect.mock.callCount(), 1);
    assert.deepStrictEqual(calls, [
      ...discountTransactionStart(17, "ttc"),
      ["MATCHES", [17, "ttc"]],
      ["UPDATE", [17, "ttc", percentage, existingDiscount.discount_id]],
      ["COMMIT"],
      ["RELEASE"],
    ]);
  });
}

test("PATCH rider discount - rejects invalid percentages and identifiers before any queries or audit", async (t) => {
  const { calls, connect, poolQuery } = mockDiscountDatabase(t);
  const cases = [
    [discountUpdatePath, { discount_percentage: -0.01 }, "NEGATIVE_FARE"],
    [discountUpdatePath, { discount_percentage: 100.01 }, "INVALID_FARE"],
    [discountUpdatePath, { discount_percentage: "35" }, "INVALID_FARE"],
    [discountUpdatePath, { discount_percentage: null }, "INVALID_FARE"],
    [discountUpdatePath, {}, "INVALID_FARE"],
    ["/api/admin/rider-categories/1.5/discounts/ttc", { discount_percentage: 35 }, "INVALID_CATEGORY_ID"],
    ["/api/admin/rider-categories/2147483648/discounts/ttc", { discount_percentage: 35 }, "INVALID_CATEGORY_ID"],
    ["/api/admin/rider-categories/17/discounts/not%20valid", { discount_percentage: 35 }, "INVALID_AGENCY_ID"],
  ];

  for (const [path, body, code] of cases) {
    const response = await request(app).patch(path).send(body);
    assert.strictEqual(response.status, 400, code);
    assert.strictEqual(response.body.code, code);
    if (code === "NEGATIVE_FARE") assert.strictEqual(response.body.message, "Discount can't be negative");
  }

  assert.strictEqual(connect.mock.callCount(), 0);
  assert.strictEqual(poolQuery.mock.callCount(), 0);
  assert.deepStrictEqual(calls, []);
});

test("PATCH rider discount - creates a missing combination and returns the stored discount", async (t) => {
  const { calls } = mockDiscountDatabase(t, { matches: [] });
  const response = await request(app).patch(discountUpdatePath).send({ discount_percentage: 0 });

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(response.body, {
    category_id: 17,
    category_name: "Senior",
    agency_id: "ttc",
    discount_percentage: 0,
    message: "Senior updated",
  });
  assert.deepStrictEqual(calls, [
    ...discountTransactionStart(17, "ttc"), ["MATCHES", [17, "ttc"]],
    ["INSERT", [17, "ttc", 0]], ["COMMIT"], ["RELEASE"],
  ]);
});

test("PATCH rider discount - rejects missing categories or agencies without inserting", async (t) => {
  const { calls } = mockDiscountDatabase(t, { targetExists: false });
  const paths = [
    ["/api/admin/rider-categories/999/discounts/ttc", [999, "ttc"]],
    ["/api/admin/rider-categories/17/discounts/unknown_agency", [17, "unknown_agency"]],
  ];

  for (const [path, parameters] of paths) {
    const response = await request(app).patch(path).send({ discount_percentage: 35 });
    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.code, "DISCOUNT_TARGET_NOT_FOUND");
    assert.deepStrictEqual(calls.splice(0), [...discountTransactionStart(...parameters), ["ROLLBACK"], ["RELEASE"]]);
  }
});

test("PATCH rider discount - rejects duplicate matches without updating or auditing", async (t) => {
  const { calls } = mockDiscountDatabase(t, {
    matches: [existingDiscount, { discount_id: 82 }],
  });

  const response = await request(app).patch(discountUpdatePath).send({ discount_percentage: 35 });

  assert.strictEqual(response.status, 409);
  assert.strictEqual(response.body.code, "DISCOUNT_CONFLICT");
  assert.deepStrictEqual(calls, [
    ...discountTransactionStart(17, "ttc"), ["MATCHES", [17, "ttc"]], ["ROLLBACK"], ["RELEASE"],
  ]);
});

test("PATCH rider discount - rejects writes by default before database access", async (t) => {
  const { calls, connect, poolQuery } = mockDiscountDatabase(t, { testWritesEnabled: false });
  const response = await request(app).patch(discountUpdatePath).send({ discount_percentage: 35 });

  assert.strictEqual(response.status, 503);
  assert.deepStrictEqual(response.body, {
    code: "DISCOUNT_TEST_WRITES_DISABLED",
    message: "Discount editing is disabled outside the test deployment.",
  });
  assert.strictEqual(connect.mock.callCount(), 0);
  assert.strictEqual(poolQuery.mock.callCount(), 0);
  assert.deepStrictEqual(calls, []);
});

test("PATCH rider discount - leaves discounts unchanged when the database audit trigger is unavailable", async (t) => {
  const { calls } = mockDiscountDatabase(t, { auditAvailable: false });

  const response = await request(app).patch(discountUpdatePath).send({ discount_percentage: 35 });

  assert.strictEqual(response.status, 503);
  assert.strictEqual(response.body.code, "DISCOUNT_AUDIT_UNAVAILABLE");
  assert.deepStrictEqual(calls, [...discountTransactionStart(17, "ttc"), ["ROLLBACK"], ["RELEASE"]]);
});

for (const failAt of ["UPDATE", "INSERT"]) {
  test(`PATCH rider discount - rolls back if ${failAt.toLowerCase()} fails`, async (t) => {
    const { calls } = mockDiscountDatabase(t, { failAt, matches: failAt === "INSERT" ? [] : [existingDiscount] });

    const response = await request(app).patch(discountUpdatePath).send({ discount_percentage: 35 });

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.code, "DISCOUNT_UPDATE_FAILED");
    assert.doesNotMatch(response.body.message, /private/);
    const writeParams = [17, "ttc", 35];
    if (failAt === "UPDATE") writeParams.push(existingDiscount.discount_id);
    assert.deepStrictEqual(calls, [
      ...discountTransactionStart(17, "ttc"), ["MATCHES", [17, "ttc"]],
      [failAt, writeParams], ["ROLLBACK"], ["RELEASE"],
    ]);
  });
}
