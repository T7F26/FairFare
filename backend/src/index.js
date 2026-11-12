//This file connects the frontend and backend
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();


app.use(cors()); // Allows your React frontend to talk to this backend
app.use(express.json()); // Allows the backend to read JSON data sent from the frontend

// This is simply a test route to make sure all things are running as intended
app.get("/api/test", (req, res) => {
  res.json({ status: "ok", message: "FairFare backend is running!" });
});


const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});