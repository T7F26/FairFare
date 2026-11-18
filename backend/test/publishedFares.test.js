"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../src/db");
const { listPublishedFares } = require("../src/publishedFares");

test("published fares are selected from the official table with a bound agency ID", async (t) => {
  const fixtures = new Map([
    ["test_agency_alpha", [{
      fare_id: "fixture_alpha_fare", price: "3.40", currency_type: "CAD",
      payment_method: 0, transfers: null, transfer_duration: 7200,
      agency_id: "test_agency_alpha",
    }]],
    ["test_agency_beta", [{
      fare_id: "fixture_beta_fare", price: "0.00", currency_type: "CAD",
      payment_method: 1, transfers: 1, transfer_duration: null,
      agency_id: "test_agency_beta",
    }]],
  ]);
  const query = t.mock.method(pool, "query", async (_sql, parameters) => ({
    rows: fixtures.get(parameters[0]),
  }));

  // Verify the read boundary and parameters, not real database isolation.
  for (const [agencyId, rows] of fixtures) {
    const result = await listPublishedFares(agencyId);
    assert.strictEqual(result, rows);
    assert.equal(typeof result[0].price, "string");

    const [sql, parameters] = query.mock.calls.at(-1).arguments;
    assert.deepEqual(parameters, [agencyId]);
    const normalized = sql.trim().replace(/\s+/g, " ");
    const selection = normalized.match(/^SELECT (.+?) FROM fares WHERE agency_id\s*=\s*\$1 ORDER BY fare_id\s*;?$/i);
    assert.ok(selection, "Read only published fares with the agency filter and stable ordering");
    assert.deepEqual(selection[1].split(",").map((column) => column.trim().toLowerCase()).sort(), [
      "fare_id", "price", "currency_type", "payment_method", "transfers", "transfer_duration", "agency_id",
    ].sort());
  }
  assert.equal(query.mock.callCount(), 2);
});

test("an agency with no published fares returns an empty list without a fallback query", async (t) => {
  const rows = [];
  const query = t.mock.method(pool, "query", async () => ({ rows }));

  assert.strictEqual(await listPublishedFares("test_agency_empty"), rows);
  assert.equal(query.mock.callCount(), 1);
  assert.deepEqual(query.mock.calls[0].arguments[1], ["test_agency_empty"]);
});

test("invalid agency IDs are rejected before querying the database", async (t) => {
  const query = t.mock.method(pool, "query", async () => ({ rows: [] }));
  for (const agencyId of [
    undefined, null, "", "Test_Agency", "test-agency", "test agency",
    "test_agency' OR 1=1 --", "a".repeat(101), 123, {}, [],
  ]) {
    await assert.rejects(listPublishedFares(agencyId), TypeError);
  }
  assert.equal(query.mock.callCount(), 0);
});

test("database failures propagate unchanged without a retry or fallback", async (t) => {
  const failure = new Error("Fixture database unavailable");
  const query = t.mock.method(pool, "query", async () => { throw failure; });

  await assert.rejects(listPublishedFares("test_agency_alpha"), (error) => {
    assert.strictEqual(error, failure);
    return true;
  });
  assert.equal(query.mock.callCount(), 1);
});
