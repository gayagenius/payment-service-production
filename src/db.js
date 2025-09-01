const { Pool } = require("pg");

const pool = new Pool({
  user: process.env.DB_USER || "pay_user",
  host: process.env.DB_HOST || "payment-db",
  database: process.env.DB_NAME || "payments",
  password: process.env.DB_PASS || "supersecret",
  port: 5432,
});

module.exports = pool;
