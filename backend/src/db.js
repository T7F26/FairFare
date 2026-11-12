const { Pool } = require("pg");
require("dotenv").config();

// A Pool manages multiple connections efficiently
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = pool;