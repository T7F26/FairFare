"use strict";
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const pool = require("./db");
const gtfs = require("./validation/gtfs");
const gtfsImport = require("./gtfsImport");
const fareChanges = require("./fareChanges");
const riderCategories = require("./riderCategories");

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1,
    fields: 1,
  },
});

app.use(cors());
app.use(express.json());

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

app.get("/api/test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS current_time");
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

app.get("/api/rider-categories", async (req, res) => {
  try {
    const categories = await riderCategories.listRiderCategories();
    return res.status(200).json(categories);
  } catch (error) {
    console.error("Loading rider categories failed:", error);
    return res.status(500).json({
      code: "RIDER_CATEGORIES_FAILED",
      message: "Could not load rider categories.",
    });
  }
});

app.post("/api/admin/import", (req, res) => {
  upload.single("file")(req, res, async (uploadError) => {
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
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          code: "FILE_UNREADABLE",
          message: "Please choose a GTFS ZIP file.",
        });
      }

      const selectedAgency = String(req.body?.agency || "").trim();
      const agencyId =
        AGENCY_IDS[selectedAgency] ||
        (AGENCY_NAMES[selectedAgency] ? selectedAgency : null);

      if (!agencyId) {
        return res.status(400).json({
          code: "AGENCY_MISMATCH",
          message: "Please choose a valid agency.",
        });
      }

      const agencyResult = await pool.query(
        "SELECT agency_id, agency_name FROM agencies WHERE agency_id = $1",
        [agencyId]
      );
      if (agencyResult.rowCount === 0) {
        return res.status(400).json({
          code: "AGENCY_MISMATCH",
          message: "Selected agency was not found.",
        });
      }

      const agencyMatcher = async (agencies) => {
        const validNames = [
          ...(AGENCY_NAMES[agencyId] || []),
          agencyResult.rows[0].agency_name,
        ].map((name) => name.toLowerCase());

        return (
          agencies.length > 0 &&
          agencies.every((agency) => {
            const fileAgencyId = String(agency.agency_id || "").trim().toLowerCase();
            const fileAgencyName = String(agency.agency_name || "").trim().toLowerCase();
            return fileAgencyId === agencyId || validNames.includes(fileAgencyName);
          })
        );
      };

      const validated = await gtfs.validateGtfsUpload(req.file.buffer, {
        agencyMatcher,
      });

      const imported = await gtfsImport.importGtfs(validated, agencyId);

      return res.status(200).json({ valid: true, ...imported });
    } catch (error) {
      if (typeof error.toJSON === "function" && typeof error.code === "string") {
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

app.get("/api/admin/fare-changes", async (req, res) => {
  try {
    const result = await fareChanges.listFareChanges();
    return res.status(200).json(result);
  } catch (error) {
    console.error("Loading fare changes failed:", error);
    return res.status(500).json({
      code: "FARE_CHANGES_FAILED",
      message: "Could not load fare changes.",
    });
  }
});

app.patch("/api/admin/fare-changes/:fareId/status", async (req, res) => {
  try {
    const result = await fareChanges.setFareChangeStatus(
      req.params.fareId,
      req.body?.status
    );
    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        code: error.code,
        message: error.message,
      });
    }
    console.error("Updating fare change status failed:", error);
    return res.status(500).json({
      code: "FARE_STATUS_UPDATE_FAILED",
      message: "Could not save fare change status.",
    });
  }
});

app.post("/api/admin/fare-changes/publish", async(req, res) =>{
  try{
    const result = await fareChanges.publishFareChanges();
    return res.status(200).json(result);
  }catch (error){
    if(error.message && error.message.includes("No approved changes")){
      return res.status(400).json({
        code: "NO_APPROVED_CHANGES",
        message: "Cannot publish. There are no approved changes."
      });
    }
    if(error.statusCode){
      return res.status(error.statusCode).json({
        code: error.code,
        message: error.message,
      });
    }
    console.error("Publishing fare changes failed:", error);
    return res.status(500).json({
      code: "FARE_PUBLISH_FAILED",
      message: "Could not publish fare changes.",
    });
  }
});

if (require.main === module) {
  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
  });
}

module.exports = app;