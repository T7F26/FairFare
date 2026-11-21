"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../src/db");
const { listFareChanges } = require("../src/fareChanges");

function mockQueries(t, { pending, changes = [], failOn } = {}) {
  const calls = [];
  const query = t.mock.method(pool, "query", async (sql, parameters = []) => {
    const normalized = sql.trim().replace(/\s+/g, " ");
    calls.push({ sql: normalized, parameters });
    if (failOn && normalized.includes(failOn)) throw new Error("Fixture database unavailable");
    if (normalized.includes("FROM pending_import")) {
      return pending ? { rowCount: 1, rows: [pending] } : { rowCount: 0, rows: [] };
    }
    if (normalized.includes("FROM compare_fares($1)")) {
      return { rowCount: changes.length, rows: changes };
    }
    assert.fail(`Unexpected SQL: ${normalized}`);
  });
  return { calls, query };
}

test("no pending upload returns an empty list without comparing fares", async (t) => {
  const { calls } = mockQueries(t);
  const result = await listFareChanges();
  assert.deepEqual(result, { agencyId: null, uploadedAt: null, count: 0, changes: [] });
  assert.equal(calls.length, 1);
});

test("fare changes for the pending agency are returned in the Review Updates format", async (t) => {
  const uploadedAt = "2026-11-20T18:00:00.000Z";
  const { calls } = mockQueries(t, {
    pending: { agency_id: "miway", uploaded_at: uploadedAt },
    changes: [
      { fare_id: "miway_A", new_price: "3.50", old_price: "3.10", currency_type: "CAD", transfer_duration: "7200", changed_type: "Price changed" },
      { fare_id: "miway_B", new_price: null, old_price: "2.00", currency_type: null, transfer_duration: null, changed_type: "Fare removed" },
      { fare_id: "miway_C", new_price: "4.00", old_price: null, currency_type: "CAD", transfer_duration: null, changed_type: "New fare" },
    ],
  });
  const result = await listFareChanges();
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /FROM compare_fares\(\$1\)/);
  assert.deepEqual(calls[1].parameters, ["miway"]);
  assert.equal(result.agencyId, "miway");
  assert.equal(result.uploadedAt, uploadedAt);
  assert.equal(result.changes.length, 3);
  assert.equal(result.count, 3);
  assert.deepEqual(result.changes[0], {
    fare_id: "miway_A", agency_id: "miway", old_price: "3.10", new_price: "3.50",
    currency_type: "CAD", transfer_duration: "7200", changed_type: "Price changed",
    status: "waiting",
  });
  assert.equal(result.changes[1].new_price, null);
  assert.equal(result.changes[1].changed_type, "Fare removed");
  assert.equal(result.changes[1].status, "waiting");
  assert.equal(result.changes[2].old_price, null);
  assert.equal(result.changes[2].changed_type, "New fare");
  assert.equal(result.changes[2].status, "waiting");
});

test("a pending upload with no fare changes returns an empty list", async (t) => {
  mockQueries(t, { pending: { agency_id: "ttc", uploaded_at: "2026-11-20T18:00:00.000Z" } });
  const result = await listFareChanges();
  assert.equal(result.agencyId, "ttc");
  assert.deepEqual(result.changes, []);
  assert.equal(result.count, 0);
});

test("database errors are passed on to the caller", async (t) => {
  mockQueries(t, { pending: { agency_id: "miway", uploaded_at: null }, failOn: "compare_fares" });
  await assert.rejects(listFareChanges(), /Fixture database unavailable/);
});