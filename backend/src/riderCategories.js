"use strict";

const pool = require("./db");

async function hasProofRequiredColumn() {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'rider_categories'
       AND column_name = 'proof_required'
     LIMIT 1`
  );
  return result.rowCount > 0;
}

async function listRiderCategories() {
  const includeProof = await hasProofRequiredColumn();
  const proofSelect = includeProof ? "rc.proof_required" : "NULL::text AS proof_required";

  const result = await pool.query(
    `SELECT
       rc.category_id,
       rc.category_name,
       ${proofSelect},
       COALESCE(
         json_object_agg(ad.agency_id, ad.discount_percentage)
           FILTER (WHERE ad.agency_id IS NOT NULL),
         '{}'::json
       ) AS discounts
     FROM rider_categories rc
     LEFT JOIN agency_discounts ad
       ON ad.category_id = rc.category_id
     GROUP BY rc.category_id, rc.category_name${includeProof ? ", rc.proof_required" : ""}
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

module.exports = { listRiderCategories };