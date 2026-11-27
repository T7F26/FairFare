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

async function updateRiderDiscount(categoryId, agencyId, value, recordChange) {
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
  if (typeof recordChange !== "function") {
    throw discountUpdateError(503, "DISCOUNT_WRITES_UNAVAILABLE", "Discount editing is not available yet.");
  }

  const client = await pool.connect();
  let releaseError;
  try {
    await client.query("BEGIN");

    // The schema permits duplicate pairs. Lock the candidate rows and reject ambiguous matches.
    const { rows } = await client.query(
      `SELECT ad.discount_id, ad.discount_percentage, rc.category_name
       FROM agency_discounts ad
       JOIN rider_categories rc ON rc.category_id = ad.category_id
       WHERE ad.category_id = $1 AND ad.agency_id = $2
       ORDER BY ad.discount_id
       LIMIT 2
       FOR UPDATE OF ad`,
      [id, agencyId]
    );
    if (rows.length === 0) {
      throw discountUpdateError(404, "DISCOUNT_NOT_FOUND", "No discount exists for this rider category and agency.");
    }
    if (rows.length > 1) {
      throw discountUpdateError(409, "DISCOUNT_CONFLICT", "Multiple discounts exist for this rider category and agency.");
    }

    const existing = rows[0];
    const result = await client.query(
      `UPDATE agency_discounts
       SET discount_percentage = $3
       WHERE category_id = $1 AND agency_id = $2 AND discount_id = $4
       RETURNING discount_percentage`,
      [id, agencyId, percentage, existing.discount_id]
    );
    if (result.rows.length !== 1) {
      throw new Error("Expected one discount row to be updated.");
    }

    const updated = {
      category_id: id,
      category_name: existing.category_name,
      agency_id: agencyId,
      discount_percentage: Number(result.rows[0].discount_percentage),
    };

    // Commit the discount and its audit entry together using the same client.
    await recordChange(client, {
      ...updated,
      previous_discount_percentage: existing.discount_percentage === null
        ? null
        : Number(existing.discount_percentage),
    });
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
