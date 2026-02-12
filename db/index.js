// backend/db/index.js
const { Pool } = require("pg");

/**
 * FIX UTAMA:
 * - Di Vercel/Production: WAJIB pakai DATABASE_URL (Neon).
 * - Jangan fallback ke PGHOST/localhost karena bisa kebaca "base" dari env lain -> ENOTFOUND base.
 * - Lokal (development): boleh fallback ke PGHOST/PG* untuk docker/local postgres.
 */

const isVercel = !!process.env.VERCEL;
const isProd = process.env.NODE_ENV === "production";

const databaseUrl = process.env.DATABASE_URL;

// Wajib DATABASE_URL saat deploy (Vercel / production)
if ((isVercel || isProd) && !databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Set DATABASE_URL in Vercel Project → Settings → Environment Variables."
  );
}

let pool;

if (databaseUrl) {
  // ✅ Neon / Hosted Postgres via URL
  pool = new Pool({
    connectionString: databaseUrl,
    // Neon wajib SSL; untuk serverless aman pakai rejectUnauthorized: false
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000,
  });
} else {
  // ✅ Local fallback (dev only)
  pool = new Pool({
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "outdoor_analytics_dev",
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "postgres",
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000,
  });
}

pool.on("error", (err) => {
  console.error("[PG POOL ERROR]", err);
});

// Debug startup (biar yakin pakai DB yang benar)
pool
  .query("SELECT current_database() db, current_user usr")
  .then((r) => console.log("[DB CONNECTED]", r.rows[0]))
  .catch((e) => console.error("[DB CONNECTION ERROR]", e.message));

module.exports = { pool };
