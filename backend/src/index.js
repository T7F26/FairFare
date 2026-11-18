
"use strict";

// FairFare Backend
// GTFS Upload and Database Import - Issue #16

// Load environment variables before database connection
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");

const pool = require("./db");
const { validateGtfsUpload } = require("./validation/gtfs");
const { importGtfs } = require("./gtfsImport");

const app = express();

// TODO: Add authentication and admin authorization
// before enabling this endpoint in production.

// GTFS ZIP upload configuration (50 MB maximum)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1,
    fields: 1,
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Agency IDs used by FairFare
const AGENCY_IDS = {
  TTC: "ttc",
  "GO Transit": "gotransit",
  MiWay: "miway",
  "York Region Transit": "yrt",
  "Brampton Transit": "brampton_transit",
  "Durham Region Transit": "durham_region_transit",
};

// Known agency names
const AGENCY_NAMES = {
  ttc: ["Toronto Transit Commission", "TTC"],
  gotransit: ["GO Transit", "GO Transit (Metrolinx)"],
  miway: ["MiWay"],
  yrt: ["York Region Transit", "YRT"],
  brampton_transit: ["Brampton Transit"],
  durham_region_transit: ["Durham Region Transit"],
};

// Backend and database connection test
app.get("/api/test", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT NOW() AS current_time"
    );

    res.json({
      status: "ok",
      message: "FairFare backend is running!",
      database: "Connected",
      time: result.rows[0].current_time,
    });
  } catch (error) {
    console.error("Database connection error:", error);

    res.status(500).json({
      status: "error",
      message: "Database connection failed",
    });
  }
});

// GTFS Upload and Import - Issue #16
// Uses the existing POST /api/admin/import URL
app.post("/api/admin/import", (req, res) => {
  upload.single("file")(req, res, async (uploadError) => {

    // Handle upload errors
    if (uploadError) {
      if (uploadError.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          code: "FILE_TOO_LARGE",
          message: "File is too large. Maximum size is 50 MB.",
        });
      }

      return res.status(400).json({
        code: "FILE_UNREADABLE",
        message: "File could not be read.",
      });
    }

    try {
      // Make sure a ZIP file was uploaded
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          code: "FILE_UNREADABLE",
          message: "Please choose a GTFS ZIP file.",
        });
      }

      // Read selected agency from frontend
      const selectedAgency = String(
        req.body?.agency || ""
      ).trim();

      // Convert agency display name to database ID
      const agencyId =
        AGENCY_IDS[selectedAgency] ||
        (AGENCY_NAMES[selectedAgency]
          ? selectedAgency
          : null);

      if (!agencyId) {
        return res.status(400).json({
          code: "AGENCY_MISMATCH",
          message: "Please choose a valid agency.",
        });
      }

      // Check that selected agency exists
      const agencyResult = await pool.query(
        `SELECT agency_id, agency_name
         FROM agencies
         WHERE agency_id = $1`,
        [agencyId]
      );

      if (agencyResult.rowCount === 0) {
        return res.status(400).json({
          code: "AGENCY_MISMATCH",
          message: "Selected agency was not found.",
        });
      }

      // Match uploaded GTFS agency to selected agency
      const agencyMatcher = async (agencies) => {
        const allowedNames = AGENCY_NAMES[agencyId] || [];
        const dbAgencyName = agencyResult.rows[0].agency_name;

        return agencies.length > 0 && agencies.every(
          (agency) => {
            const fileAgencyId = String(
              agency.agency_id || ""
            ).trim().toLowerCase();

            const fileAgencyName = String(
              agency.agency_name || ""
            ).trim().toLowerCase();

            const validNames = [
              ...allowedNames,
              dbAgencyName,
            ].map((name) => name.toLowerCase());

            return (
              fileAgencyId === agencyId ||
              validNames.includes(fileAgencyName)
            );
          }
        );
      };

      // Validate ZIP before writing to database
      const validated = await validateGtfsUpload(
        req.file.buffer,
        { agencyMatcher }
      );

      // Save validated GTFS data using staging tables
      const imported = await importGtfs(
        validated,
        agencyId
      );

      // Return import result
      return res.status(200).json(imported);

    } catch (error) {

      // Handle GTFS validation errors
      if (
        typeof error.toJSON === "function" &&
        typeof error.code === "string"
      ) {
        return res.status(400).json(error.toJSON());
      }

      // Handle database or unexpected errors
      console.error("GTFS import failed:", error);

      return res.status(500).json({
        code: "IMPORT_FAILED",
        message: "GTFS import failed. No changes were saved.",
      });
    }
  });
});

// Start server
const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
