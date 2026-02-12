// backend/db/index.js
const { Pool } = require("pg");

// NOTE:
// - dotenv cukup dipanggil di server.js paling atas.
// - Jangan panggil require("dotenv").config() di sini supaya tidak ada perilaku aneh path .env.

const hasDatabaseUrl = !!process.env.DATABASE_URL;

const pool = hasDatabaseUrl
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 20000,
    })
  : new Pool({
      host: process.env.PGHOST || "localhost",
      port: Number(process.env.PGPORT || 5432),

      // ✅ anti “database user” (fallback kalau env kosong)
      database: process.env.PGDATABASE || "outdoor_analytics_dev",
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "postgres",

      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 20000,
    });

pool.on("error", (err) => {
  console.error("[PG POOL ERROR]", err);
});

// Debug startup (biar yakin pakai DB yang benar)
pool
  .query("SELECT current_database() db, current_user usr")
  .then((r) => console.log("[DB CONNECTED]", r.rows[0]))
  .catch((e) => console.error("[DB CONNECTION ERROR]", e.message));

module.exports = { pool };
