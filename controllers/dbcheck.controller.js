console.log("DBCHECK CONTROLLER LOADED");
const { pool } = require("../db.js");

/**
 * GET /api/dashboard/__dbcheck
 * Tujuan: cek koneksi DB, list tabel public, dan ringkasan traffic_daily.
 */
async function dbCheck(req, res) {
  try {
    // 1) Tes koneksi sederhana
    const nowQ = await pool.query("SELECT NOW() AS now");

    // 2) List tabel di schema public
    const tablesQ = await pool.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);

    // 3) Cek traffic_daily (kalau tabelnya belum ada, tangkap error)
    let trafficDaily = { exists: false };
    try {
      const countQ = await pool.query("SELECT COUNT(*)::int AS count FROM traffic_daily");
      const rangeQ = await pool.query(`
        SELECT site_id, MIN(d) AS min_date, MAX(d) AS max_date, COUNT(*)::int AS rows
        FROM traffic_daily
        GROUP BY site_id
        ORDER BY site_id
      `);
      trafficDaily = {
        exists: true,
        count: countQ.rows?.[0]?.count ?? 0,
        range_by_site: rangeQ.rows || []
      };
    } catch (e) {
      trafficDaily = { exists: false, error: e.message };
    }

    // 4) Cek traffic_hourly juga (sering dipakai untuk agregasi)
    let trafficHourly = { exists: false };
    try {
      const countQ = await pool.query("SELECT COUNT(*)::int AS count FROM traffic_hourly");
      const rangeQ = await pool.query(`
        SELECT site_id,
               MIN(ts_hour) AS min_ts,
               MAX(ts_hour) AS max_ts,
               COUNT(*)::int AS rows
        FROM traffic_hourly
        GROUP BY site_id
        ORDER BY site_id
      `);
      trafficHourly = {
        exists: true,
        count: countQ.rows?.[0]?.count ?? 0,
        range_by_site: rangeQ.rows || []
      };
    } catch (e) {
      trafficHourly = { exists: false, error: e.message };
    }

    return res.json({
      ok: true,
      db_time: nowQ.rows?.[0]?.now,
      tables: tablesQ.rows.map(r => r.tablename),
      traffic_daily: trafficDaily,
      traffic_hourly: trafficHourly
    });
  } catch (err) {
    console.error("DBCHECK ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = { dbCheck };
