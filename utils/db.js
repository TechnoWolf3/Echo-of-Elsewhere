// utils/db.js
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn("⚠️ DATABASE_URL is not set. DB-backed features will not work.");
}

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      // Railway + many hosted PG providers require SSL.
      // This is safe and avoids local dev headaches.
      ssl: { rejectUnauthorized: false },
    })
  : null;

module.exports = { pool };
