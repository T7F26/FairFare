"use strict";

const test = require("node:test");
const assert = require("node:assert");
const pool = require("../src/db");
const { listRiderCategories } = require("../src/riderCategories");

test("listRiderCategories - lists every category with per-agency discounts and proof required", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        category_id: 1,
        category_name: "Senior",
        proof_required: "Government ID / Senior fare card",
        discounts: { ttc: "25", gotransit: 40 },
      },
      {
        category_id: 2,
        category_name: "Post-Secondary Student",
        proof_required: "Valid student ID",
        discounts: { gotransit: "40" },
      },
    ],
  }));

  const categories = await listRiderCategories();

  assert.deepStrictEqual(categories, [
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
  ]);
  assert.strictEqual(categories[1].discounts.ttc, undefined);
});

test("listRiderCategories - handles categories with no discounts and null proof_required", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        category_id: 3,
        category_name: "Adult",
        proof_required: null,
        discounts: {},
      },
    ],
  }));

  const categories = await listRiderCategories();

  assert.deepStrictEqual(categories, [
    {
      category_id: 3,
      category_name: "Adult",
      proof_required: null,
      discounts: {},
    },
  ]);
});

test("listRiderCategories - propagates database query errors", async (t) => {
  t.mock.method(pool, "query", async () => {
    throw new Error("Database error");
  });

  await assert.rejects(() => listRiderCategories(), /Database error/);
});