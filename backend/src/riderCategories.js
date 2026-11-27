"use strict";

const pool = require("./db");

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

module.exports = { listRiderCategories };