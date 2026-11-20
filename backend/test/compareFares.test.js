"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../src/db");
const { listFareChanges } = require("../src/fareChanges");

function mockDb(t, { pending, changes = [], failOn } = {}) {
  const calls = [];
  t.mock.method(pool, "query", async (sql, parameters = []) => {
    const normalized = sql.trim().replace(/\s+/g, " ");
    calls.push({ sql: normalized, parameters });

    if (failOn && normalized.includes(failOn)) {
      throw new Error("Database query failed");
    }

    if (normalized.includes("FROM pending_import")) {
      return pending
        ? { rowCount: 1, rows: [pending] }
        : { rowCount: 0, rows: [] };
    }

    if (normalized.includes("FROM compare_fares($1)")) {
      return { rowCount: changes.length, rows: changes };
    }

    assert.fail(`Unexpected SQL query: ${normalized}`);
  });
  return calls;
}

test("listFareChanges returns expected fare comparison rows for an agency", async (t) => {
  const uploadedAt = "2026-11-20T18:00:00.000Z";
  const calls = mockDb(t, {
    pending: { agency_id: "ttc", uploaded_at: uploadedAt },
    changes: [
      {
        fare_id: "TTC_101",
        new_price: "3.35",
        old_price: "3.25",
        currency_type: "CAD",
        transfer_duration: "7200",
        changed_type: "Price changed",
      },
    ],
  });

  const result = await listFareChanges();

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].parameters, ["ttc"]);
  assert.equal(result.agencyId, "ttc");
  assert.equal(result.uploadedAt, uploadedAt);
  assert.equal(result.count, 1);
  assert.deepEqual(result.changes[0], {
    fare_id: "TTC_101",
    agency_id: "ttc",
    old_price: "3.25",
    new_price: "3.35",
    currency_type: "CAD",
    transfer_duration: "7200",
    changed_type: "Price changed",
  });
});

test("listFareChanges returns no rows when there are no fare changes", async (t) => {
  const uploadedAt = "2026-11-20T18:00:00.000Z";
  mockDb(t, {
    pending: { agency_id: "ttc", uploaded_at: uploadedAt },
    changes: [],
  });

  const result = await listFareChanges();

  assert.equal(result.agencyId, "ttc");
  assert.equal(result.uploadedAt, uploadedAt);
  assert.equal(result.count, 0);
  assert.deepEqual(result.changes, []);
});

test("listFareChanges returns new and removed fare rows", async (t) => {
  const uploadedAt = "2026-11-20T18:00:00.000Z";
  mockDb(t, {
    pending: { agency_id: "ttc", uploaded_at: uploadedAt },
    changes: [
      {
        fare_id: "TTC_201",
        new_price: "3.35",
        old_price: null,
        currency_type: "CAD",
        transfer_duration: "7200",
        changed_type: "New fare",
      },
      {
        fare_id: "TTC_202",
        new_price: null,
        old_price: "3.25",
        currency_type: "CAD",
        transfer_duration: "7200",
        changed_type: "Fare removed",
      },
    ],
  });

  const result = await listFareChanges();

  assert.equal(result.count, 2);
  assert.equal(result.changes[0].changed_type, "New fare");
  assert.equal(result.changes[0].old_price, null);
  assert.equal(result.changes[1].changed_type, "Fare removed");
  assert.equal(result.changes[1].new_price, null);
});

test("listFareChanges returns empty response when there is no pending import", async (t) => {
  const calls = mockDb(t, { pending: null });

  const result = await listFareChanges();

  assert.equal(calls.length, 1);
  assert.deepEqual(result, {
    agencyId: null,
    uploadedAt: null,
    count: 0,
    changes: [],
  });
});

test("listFareChanges propagates database errors from compare_fares", async (t) => {
  mockDb(t, {
    pending: { agency_id: "ttc", uploaded_at: "2026-11-20T18:00:00.000Z" },
    failOn: "compare_fares",
  });

  await assert.rejects(() => listFareChanges(), /Database query failed/);
});