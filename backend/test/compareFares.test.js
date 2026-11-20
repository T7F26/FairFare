"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("compare_fares returns expected fare comparison rows for an agency", async () => {
  const sampleRows = [
    {
      fare_id: "TTC_101",
      new_price: 3.35,
      old_price: 3.25,
      currency_type: "CAD",
      transfer_duration: "7200",
      changed_type: "Price changed",
    },
  ];

  const mockQuery = async (sql, params) => {
    assert.ok(sql.includes("compare_fares"));
    assert.deepEqual(params, ["TTC"]);
    return { rows: sampleRows };
  };

  const result = await mockQuery("SELECT * FROM compare_fares($1);", ["TTC"]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].changed_type, "Price changed");
});

test("compare_fares returns no rows when there are no fare changes", async () => {
  const mockQuery = async (sql, params) => {
    assert.ok(sql.includes("compare_fares"));
    assert.deepEqual(params, ["TTC"]);
    return { rows: [] };
  };

  const result = await mockQuery("SELECT * FROM compare_fares($1);", ["TTC"]);
  assert.equal(result.rows.length, 0);
});

test("compare_fares returns new and removed fare rows", async () => {
  const rows = [
    {
      fare_id: "TTC_201",
      new_price: 3.35,
      old_price: null,
      currency_type: "CAD",
      transfer_duration: "7200",
      changed_type: "New fare",
    },
    {
      fare_id: "TTC_202",
      new_price: null,
      old_price: 3.25,
      currency_type: "CAD",
      transfer_duration: "7200",
      changed_type: "Fare removed",
    },
  ];

  const mockQuery = async (sql, params) => {
    assert.ok(sql.includes("compare_fares"));
    assert.deepEqual(params, ["TTC"]);
    return { rows };
  };

  const result = await mockQuery("SELECT * FROM compare_fares($1);", ["TTC"]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].changed_type, "New fare");
  assert.equal(result.rows[1].changed_type, "Fare removed");
});