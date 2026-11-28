"use strict";

const { randomUUID } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const request = require("supertest");
const app = require("../src/index");
const appPool = require("../src/db");
const { updateRiderDiscount } = require("../src/riderCategories");

const testDatabaseUrl = process.env.FAIRFARE_DISCOUNT_TEST_DATABASE_URL;

test("test-site discount saves need no login, serialize inserts, and audit as CURRENT_USER", {
  skip: !testDatabaseUrl && "Set FAIRFARE_DISCOUNT_TEST_DATABASE_URL for an isolated PostgreSQL test database.",
}, async (t) => {
  const url = new URL(testDatabaseUrl);
  assert.ok(
    ["postgres:", "postgresql:"].includes(url.protocol) &&
    url.hostname === "127.0.0.1" && url.port && !url.search && !url.hash &&
    /^\/fairfare_discount_test_[a-z0-9_]+$/.test(url.pathname),
    "Use a dedicated fairfare_discount_test_* database on a loopback PostgreSQL instance."
  );

  const previousTestWrites = process.env.FAIRFARE_ENABLE_TEST_DISCOUNT_WRITES;
  process.env.FAIRFARE_ENABLE_TEST_DISCOUNT_WRITES = "true";
  t.after(() => {
    if (previousTestWrites === undefined) delete process.env.FAIRFARE_ENABLE_TEST_DISCOUNT_WRITES;
    else process.env.FAIRFARE_ENABLE_TEST_DISCOUNT_WRITES = previousTestWrites;
  });

  const schema = `discount_test_${randomUUID().replaceAll("-", "")}`;
  const connection = { connectionString: testDatabaseUrl, connectionTimeoutMillis: 5000 };
  const controlPool = new Pool(connection);
  const isolatedPool = new Pool({ ...connection, options: `-c search_path=${schema}` });
  let schemaCreated = false;
  t.after(async () => {
    try {
      await isolatedPool.end();
      // Drop only this run's randomly named schema in the dedicated database.
      if (schemaCreated) await controlPool.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await controlPool.end();
    }
  });
  await controlPool.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  t.mock.method(appPool, "connect", () => isolatedPool.connect());

  for (const file of ["agencies.sql", "initialsetup.sql", "edit_discount_log.sql"]) {
    const sql = await readFile(path.join(__dirname, "..", "scripts", file), "utf8");
    await isolatedPool.query(sql);
  }

  const { rows: [category] } = await isolatedPool.query(
    "INSERT INTO rider_categories (category_name) VALUES ($1) RETURNING category_id",
    ["Test discount category"]
  );
  const id = category.category_id;
  const { rows: [actor] } = await isolatedPool.query("SELECT CURRENT_USER AS database_user");
  await isolatedPool.query(
    "INSERT INTO agency_discounts (category_id, agency_id, discount_percentage) VALUES ($1, $2, $3)",
    [id, "miway", 17.14]
  );

  async function readDiscounts() {
    const { rows } = await isolatedPool.query(
      "SELECT agency_id, discount_percentage FROM agency_discounts WHERE category_id = $1 ORDER BY agency_id",
      [id]
    );
    return rows;
  }

  async function readTtcAudit() {
    const { rows } = await isolatedPool.query(
      `SELECT old_discount, new_discount, changed_by FROM discount_change_log
       WHERE category_id = $1 AND agency_id = 'ttc' ORDER BY log_id`,
      [id]
    );
    return rows;
  }

  const urlPath = `/api/admin/rider-categories/${id}/discounts/ttc`;
  const results = await Promise.all([35.125, 100].map((value) =>
    request(app).patch(urlPath).send({ discount_percentage: value }).expect(200)
  ));
  assert.deepEqual(results.map((result) => result.body.discount_percentage), [35.13, 100]);

  const audit = await readTtcAudit();
  assert.equal(audit.length, 2);
  assert.equal(audit[0].old_discount, null);
  assert.equal(audit[1].old_discount, audit[0].new_discount);
  assert.deepEqual(audit.map((row) => row.new_discount).sort(), ["100.00", "35.13"]);
  for (const row of audit) assert.equal(row.changed_by, actor.database_user);

  const discounts = await readDiscounts();
  assert.deepEqual(discounts, [
    { agency_id: "miway", discount_percentage: "17.14" },
    { agency_id: "ttc", discount_percentage: audit[1].new_discount },
  ]);

  await updateRiderDiscount(id, "ttc", Number(audit[1].new_discount));
  assert.deepEqual(await readTtcAudit(), audit);

  // Force the trigger's INSERT to fail and verify the discount rolls back with it.
  await isolatedPool.query("ALTER TABLE discount_change_log ADD CHECK (new_discount <> 99)");
  await assert.rejects(() => updateRiderDiscount(id, "ttc", 99), { code: "23514" });
  assert.deepEqual(await readDiscounts(), discounts);
  assert.deepEqual(await readTtcAudit(), audit);
});
