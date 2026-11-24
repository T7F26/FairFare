"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../src/db");
const { publishFareChanges } = require("../src/fareChanges");

// Unit tests for Publish Approved Changes (#35).
// The database is mocked, so these tests check what publishFareChanges does
// with the results it gets back, not the SQL function itself.
function mockPublish(t, { pending, publishedCount = 0, failOn } = {}) {
  const calls = [];
  const query = t.mock.method(pool, "query", async (sql, parameters = []) => {
    const normalized = sql.trim().replace(/\s+/g, " ");
    calls.push({ sql: normalized, parameters });
    if (failOn && normalized.includes(failOn)) throw new Error("Fixture database unavailable");
    if (normalized.includes("FROM pending_import")) {
      return pending ? { rowCount: 1, rows: [pending] } : { rowCount: 0, rows: [] };
    }
    if (normalized.includes("publish_changes($1)")) {
      return { rowCount: 1, rows: [{ published_count: publishedCount }] };
    }
    assert.fail(`Unexpected SQL: ${normalized}`);
  });
  return { calls, query };
}

test("publishing with no pending upload gives a NO_PENDING_IMPORT error", async (t) => {
  mockPublish(t);
  await assert.rejects(publishFareChanges(), (err) => {
    assert.equal(err.message, "No pending GTFS import found.");
    assert.equal(err.statusCode, 404);
    assert.equal(err.code, "NO_PENDING_IMPORT");
    return true;
  });
});

test("nothing is published when there is no pending upload", async (t) => {
  const { calls } = mockPublish(t);
  await assert.rejects(publishFareChanges());
  assert.equal(calls.length, 1);
  assert.ok(!calls.some((c) => c.sql.includes("publish_changes")));
});

test("publishing uses the agency of the pending upload", async (t) => {
  const { calls } = mockPublish(t, { pending: { agency_id: "miway", uploaded_at: null }, publishedCount: 2 });
  await publishFareChanges();
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /SELECT publish_changes\(\$1\) AS published_count/);
  assert.deepEqual(calls[1].parameters, ["miway"]);
});

test("the result has the agency and the number of changes published", async (t) => {
  mockPublish(t, { pending: { agency_id: "miway", uploaded_at: null }, publishedCount: 2 });
  const result = await publishFareChanges();
  assert.deepEqual(result, { agencyId: "miway", published_count: 2 });
});

test("publishing is done once per click (publish_changes called one time)", async (t) => {
  const { calls } = mockPublish(t, { pending: { agency_id: "ttc", uploaded_at: null }, publishedCount: 1 });
  await publishFareChanges();
  assert.equal(calls.filter((c) => c.sql.includes("publish_changes")).length, 1);
});

test("a database error while checking the pending upload is passed on", async (t) => {
  mockPublish(t, { failOn: "FROM pending_import" });
  await assert.rejects(publishFareChanges(), /Fixture database unavailable/);
});

test("a database error while publishing is passed on", async (t) => {
  mockPublish(t, { pending: { agency_id: "miway", uploaded_at: null }, failOn: "publish_changes" });
  await assert.rejects(publishFareChanges(), /Fixture database unavailable/);
});

// To add once #33 (endpoint + zero-approved check) and #32 (Publish button) are merged:
test.todo("publishing with no approved changes returns an error instead of publishing");
test.todo("POST publish endpoint returns the number of changes published");
