//This file connects the frontend and backend
const express = require("express");
const pool = require("./db");
const cors = require("cors");
const upload = require("./middleware/upload");
const gtfs = require("./validation/gtfs");
require("dotenv").config();

const app = express();

app.use(cors()); // Allows your React frontend to talk to this backend
app.use(express.json()); // Allows the backend to read JSON data sent from the frontend

// This is simply a test route to make sure all things are running as intended
app.get("/api/test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() as current_time");
    res.json({ 
      status: "ok", 
      message: "FairFare backend is running!",
      database: "Connected",
      time: result.rows[0].current_time
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: "Database connection failed" });
  }
});

// GTFS Upload and Validation Route with Agency Matcher
app.post("/api/admin/import", upload.single("file"), async (req, res) => {
  try {
    const buffer = req.file ? req.file.buffer : req.body.buffer; 
    const selectedAgency = (req.body.agency || "").trim();

    const agencyMatcher = async (agencies) => {
      return agencies.some((agency) => 
        agency.agency_id === selectedAgency || agency.agency_name === selectedAgency
      );
    };

    const result = await gtfs.validateGtfsUpload(buffer, { agencyMatcher });
    res.json(result);
  } catch (error) {
    res.status(400).json(error.toJSON ? error.toJSON() : { error: error.message });
  }
});


if (require.main === module) {
  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
  });
}

module.exports = app;