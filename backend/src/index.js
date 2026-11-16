
const express = require("express");
const pool = require("./db");
const cors = require("cors");
const multer = require("multer");
const { validateGtfsUpload, GtfsValidationError } =
  require("./validation/gtfs");

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

// GTFS import endpoint will be added in the next step.
// It will use:
// - upload.single("file")
// - validateGtfsUpload()
// - PostgreSQL staging tables
// - process_gtfs_records()

const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
