
const express = require("express");
const pool = require("./db");
const cors = require("cors");
const multer = require("multer");

const {
  validateGtfsUpload,
  GtfsValidationError,
} = require("./validation/gtfs");

// Import GTFS database functionality - Issue #16
const { importGtfs } = require("./gtfsImport");

require("dotenv").config();

const app = express();

// Configure file uploads for GTFS ZIP files
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1,
    fields: 1,
  },
});

// Allow the React frontend to communicate with the backend
app.use(cors());

// Allow the backend to read JSON requests
app.use(express.json());

// Test route to check backend and database connection
app.get("/api/test", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT NOW() as current_time"
    );

    res.json({
      status: "ok",
      message: "FairFare backend is running!",
      database: "Connected",
      time: result.rows[0].current_time,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      status: "error",
      message: "Database connection failed",
    });
  }
});


const AGENCY_IDS = {
  TTC: "ttc",
  "GO Transit": "gotransit",
  MiWay: "miway",
  "York Region Transit": "yrt",
  "Brampton Transit": "brampton_transit",
  "Durham Region Transit": "durham_region_transit",
};

const AGENCY_NAMES = {
  ttc: ["Toronto Transit Commission", "TTC"],
  gotransit: ["GO Transit", "GO Transit (Metrolinx)"],
  miway: ["MiWay"],
  yrt: ["York Region Transit", "YRT"],
  brampton_transit: ["Brampton Transit"],
  durham_region_transit: ["Durham Region Transit"],
};

// Upload and import GTFS file
app.post("/api/admin/import", (req, res) => {
  upload.single("file")(req, res, async (uploadError) => {
    if (uploadError) {
      return res.status(400).json({
        code: "FILE_UNREADABLE",
        message: "File could not be read",
      });
    }

    try {
      const selectedAgency = req.body?.agency;
      const agencyId = AGENCY_IDS[selectedAgency];

      if (!agencyId) {
        return res.status(400).json({
          code: "AGENCY_MISMATCH",
          message: "Please choose a valid agency",
        });
      }

      if (!req.file?.buffer) {
        return res.status(400).json({
          code: "FILE_UNREADABLE",
          message: "Please upload a GTFS ZIP file",
        });
      }

      // Confirm selected agency exists in the database
      const agencyResult = await pool.query(
        "SELECT agency_id, agency_name FROM agencies WHERE agency_id = $1",
        [agencyId]
      );

      if (agencyResult.rowCount === 0) {
        return res.status(400).json({
          code: "AGENCY_MISMATCH",
          message: "Selected agency was not found",
        });
      }

      const agencyMatcher = async (agencies) => {
        const allowedNames = AGENCY_NAMES[agencyId];

        return agencies.length > 0 && agencies.every(
          (agency) =>
            allowedNames.some(
              (name) =>
                name.toLowerCase() ===
                agency.agency_name?.trim().toLowerCase()
            )
        );
      };

      // Validate ZIP contents before importing
      const validated = await validateGtfsUpload(
        req.file.buffer,
        { agencyMatcher }
      );

      // Save validated data in PostgreSQL
      const imported = await importGtfs(validated, agencyId);

      return res.status(200).json(imported);
    } catch (error) {
      if (error instanceof GtfsValidationError) {
        return res.status(400).json(error.toJSON());
      }

      console.error("GTFS import failed:", error);

      return res.status(500).json({
        code: "IMPORT_FAILED",
        message: "GTFS import failed. No changes were saved.",
      });
    }
  });
});


const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
