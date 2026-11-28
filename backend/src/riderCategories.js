"use strict";

const pool = require("./db");
const { validateDiscountPercentage } = require("./validation/fare");

async function listRiderCategories() {
  const result = await pool.query(
    `SELECT
       rc.category_id,
       rc.category_name,
       rc.proof_required,
       COALESCE(
         json_object_agg(ad.agency_id, ad.discount_percentage)
           FILTER (WHERE ad.agency_id IS NOT NULL),
         '{}'::json
       ) AS discounts
     FROM rider_categories rc
     LEFT JOIN agency_discounts ad
       ON ad.category_id = rc.category_id
     GROUP BY rc.category_id, rc.category_name, rc.proof_required
     ORDER BY rc.category_id`
  );

  return result.rows.map((row) => {
    const discounts = {};
    if (row.discounts && typeof row.discounts === "object") {
      for (const [agencyId, pct] of Object.entries(row.discounts)) {
        discounts[agencyId] = pct === null || pct === undefined ? null : Number(pct);
      }
    }

    return {
      category_id: row.category_id,
      category_name: row.category_name,
      proof_required: row.proof_required ?? null,
      discounts,
    };
  });
}

function discountUpdateError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function updateRiderDiscount(categoryId, agencyId, value) {
  const percentage = validateDiscountPercentage(value);
  const id = typeof categoryId === "string" && /^[1-9][0-9]{0,9}$/.test(categoryId)
    ? Number(categoryId)
    : categoryId;

  // rider_categories.category_id is a PostgreSQL integer.
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
    throw discountUpdateError(400, "INVALID_CATEGORY_ID", "A valid rider category ID is required.");
  }
  if (typeof agencyId !== "string" || !/^[a-z][a-z0-9_]{0,99}$/.test(agencyId)) {
    throw discountUpdateError(400, "INVALID_AGENCY_ID", "A valid agency ID is required.");
  }

  const client = await pool.connect();
  let releaseError;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");

    // A missing row cannot be row-locked. Serialize saves for the pair before looking for it.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('rider-discount:' || $1::text || ':' || $2::text, 0))",
      [id, agencyId]
    );

    // Hold the write lock before checking the trigger, so concurrent DDL cannot remove it mid-save.
    await client.query("LOCK TABLE agency_discounts IN ROW EXCLUSIVE MODE");
    const { rows: targets } = await client.query(
      `SELECT rc.category_name, EXISTS (
         SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'agency_discounts'::regclass
           AND tgname = 'trg_discount_change'
           AND tgtype = 21
           AND tgenabled IN ('O', 'A')
       ) AS audit_ready
       FROM rider_categories rc
       JOIN agencies a ON a.agency_id = $2
       WHERE rc.category_id = $1
       FOR KEY SHARE OF rc, a`,
      [id, agencyId]
    );
    if (targets.length === 0) {
      throw discountUpdateError(404, "DISCOUNT_TARGET_NOT_FOUND", "The rider category or agency was not found.");
    }
    // Trigger type 21 is AFTER ROW for INSERT (4) and UPDATE (16), plus the row bit (1).
    if (!targets[0].audit_ready) {
      throw discountUpdateError(503, "DISCOUNT_AUDIT_UNAVAILABLE", "Discount change logging is not available.");
    }

    // The schema permits duplicate pairs. Lock the candidate rows and reject ambiguous matches.
    const { rows } = await client.query(
      `SELECT discount_id FROM agency_discounts
       WHERE category_id = $1 AND agency_id = $2
       ORDER BY discount_id
       LIMIT 2
       FOR UPDATE`,
      [id, agencyId]
    );
    if (rows.length > 1) {
      throw discountUpdateError(409, "DISCOUNT_CONFLICT", "Multiple discounts exist for this rider category and agency.");
    }

    const result = rows.length === 0
      ? await client.query(
        `INSERT INTO agency_discounts (category_id, agency_id, discount_percentage)
         VALUES ($1, $2, $3) RETURNING discount_percentage`,
        [id, agencyId, percentage]
      )
      : await client.query(
        `UPDATE agency_discounts
         SET discount_percentage = $3
         WHERE category_id = $1 AND agency_id = $2 AND discount_id = $4
         RETURNING discount_percentage`,
        [id, agencyId, percentage, rows[0].discount_id]
      );
    if (result.rows.length !== 1) {
      throw new Error("Expected one discount row to be saved.");
    }

    const updated = {
      category_id: id,
      category_name: targets[0].category_name,
      agency_id: agencyId,
      discount_percentage: Number(result.rows[0].discount_percentage),
    };

    await client.query("COMMIT");
    return updated;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      releaseError = rollbackError;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

module.exports = { listRiderCategories, updateRiderDiscount };
