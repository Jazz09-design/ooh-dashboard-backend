const { pool } = require("../db.js"); // ✅ ini yang benar (mengarah ke db/index.js yang sudah kita patch)
console.log("FILTERS CONTROLLER PATCH LOADED ✅", __filename);


/**
 * GET /api/dashboard/filters
 * Return:
 * - sites (id, name, city, ooh_type, lat/lng)
 * - cities (unique)
 * - ooh_types (unique)
 * - date_min, date_max (YYYY-MM-DD)
 * - months (["YYYY-MM", ...])
 *
 * Sources date range from union of tables that have date dimension.
 */
async function getFilters(req, res) {
  try {
    // 1) sites list (yang Mas sudah punya)
    const sitesQ = await pool.query(`
      SELECT
        id,
        name,
        city,
        ooh_type,
        latitude,
        longitude
      FROM sites
      ORDER BY id ASC
    `);

    const sites = sitesQ.rows || [];

    // derive unique cities/ooh_types from sites (lebih aman dari data seed)
    const cities = Array.from(new Set(sites.map(s => s.city).filter(Boolean))).sort();
    const ooh_types = Array.from(new Set(sites.map(s => s.ooh_type).filter(Boolean))).sort();

    // 2) date bounds + months (paling penting)
    // Ambil range tanggal dari gabungan tabel "daily" yang dipakai dashboard
    // - traffic_daily(d)
    // - site_demography_daily(d)
    // (kalau salah satu kosong, yang lain masih jalan)
    const boundsQ = await pool.query(`
      WITH all_days AS (
        SELECT d::date AS d FROM traffic_daily
        UNION ALL
        SELECT d::date AS d FROM site_demography_daily
      ),
      bounds AS (
        SELECT MIN(d) AS min_d, MAX(d) AS max_d
        FROM all_days
      ),
      months AS (
        SELECT
          to_char(gs::date, 'YYYY-MM') AS ym
        FROM bounds b,
        LATERAL generate_series(
          date_trunc('month', b.min_d)::date,
          date_trunc('month', b.max_d)::date,
          interval '1 month'
        ) gs
      )
      SELECT
        (SELECT min_d FROM bounds) AS date_min,
        (SELECT max_d FROM bounds) AS date_max,
        COALESCE(json_agg(m.ym ORDER BY m.ym), '[]'::json) AS months
      FROM months m;
    `);

    const bounds = boundsQ.rows?.[0] || {};
    const date_min = bounds.date_min ? new Date(bounds.date_min).toISOString().slice(0, 10) : null;
    const date_max = bounds.date_max ? new Date(bounds.date_max).toISOString().slice(0, 10) : null;
    const months = Array.isArray(bounds.months) ? bounds.months : [];

    return res.json({
      ok: true,
      date_min,
      date_max,
      months,
      cities,
      ooh_types,
      sites,
    });
  } catch (err) {
    console.error("[filters.controller] error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

module.exports = { getFilters };
