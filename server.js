console.log("SERVER FILE LOADED");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { z } = require("zod");
const { pool } = require("./db/index.js");

const app = express();
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/__whoami", (req, res) => res.json({ file: "server.js", ts: new Date().toISOString() }));

app.use(cors({
  origin: true,            // izinkan origin dari mana saja (untuk dev)
  credentials: true
}));
app.use(cors());
app.use(express.json());
const dashboardRoutes = require("./routes/dashboard.routes");
app.use("/api/dashboard",dashboardRoutes);

console.log(
  "DASHBOARD ROUTES REGISTERED:",
  dashboardRoutes.stack
    ?.filter(r => r.route)
    .map(r => r.route.path)
);  

const DashboardQuery = z.object({
  site_id: z.coerce.number().int().positive(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  poi_radius_m: z.coerce.number().int().positive().default(500)
});

const toNum = (x, d = 2) => Number(Number(x || 0).toFixed(d));

app.get("/api/dashboard", async (req, res) => {
  const parsed = DashboardQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const { site_id, start, end, poi_radius_m } = parsed.data;
  if (start > end) return res.status(400).json({ error: "start must be <= end" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Site detail
    const siteQ = await client.query(
      `SELECT id, site_name AS name, latitude AS lat, longitude AS lon
       FROM sites
       WHERE id = $1 AND is_active = true`,
      [site_id]
    );
    if (siteQ.rowCount === 0) {
      return res.status(404).json({ error: "Site not found" });
    }
    const site = siteQ.rows[0];

    // 2) KPI agregasi dari site_scores_daily
    const kpiQ = await client.query(
      `SELECT
         AVG(poi_score)           AS poi_score_avg,
         AVG(technical_score)     AS technical_score_avg,
         AVG(traffic_score)       AS traffic_score_avg,
         AVG(demographic_score)   AS demographic_score_avg,
         COALESCE(SUM(impressions),0) AS impressions_sum
       FROM site_scores_daily
       WHERE site_id = $1 AND d BETWEEN $2::date AND $3::date`,
      [site_id, start, end]
    );
    const k = kpiQ.rows[0];
    const kpis = {
      poiScore: toNum(k.poi_score_avg),
      technicalScore: toNum(k.technical_score_avg),
      trafficScore: toNum(k.traffic_score_avg),
      demographicScore: toNum(k.demographic_score_avg),
      monthlyImpression: Number(k.impressions_sum || 0)
    };

    // 3) Traffic hourly (range datetime)
    const hourlyQ = await client.query(
      `SELECT ts_hour AS ts, volume AS value
       FROM traffic_hourly
       WHERE site_id = $1
         AND ts_hour >= $2::date
         AND ts_hour < ($3::date + INTERVAL '1 day')
       ORDER BY ts_hour ASC`,
      [site_id, start, end]
    );

    // 4) Traffic daily
    const dailyQ = await client.query(
      `SELECT date, volume AS value
       FROM traffic_daily
       WHERE site_id = $1 AND date BETWEEN $2::date AND $3::date
       ORDER BY date ASC`,
      [site_id, start, end]
    );

    // 5) Demografi (ambil data terbaru dalam range)
    const demoQ = await client.query(
      `SELECT gender, age_groups, vehicle_types
       FROM site_demographics_daily
       WHERE site_id = $1 AND d BETWEEN $2::date AND $3::date
       ORDER BY d DESC
       LIMIT 1`,
      [site_id, start, end]
    );

    let gender = [];
    let ageGroups = [];
    let vehicleTypes = [];

    if (demoQ.rowCount > 0) {
      const d = demoQ.rows[0];

      // gender JSON -> array {label,value}
      const g = d.gender || {};
      gender = Object.entries(g).map(([key, val]) => ({
        label: key[0].toUpperCase() + key.slice(1),
        value: Number(val)
      }));

      // age_groups -> array of objects (seed sudah sesuai)
      ageGroups = Array.isArray(d.age_groups) ? d.age_groups : [];

      // vehicle_types JSON -> array {label,value}
      const v = d.vehicle_types || {};
      vehicleTypes = Object.entries(v).map(([key, val]) => ({
        label: key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        value: Number(val)
      }));
    }

    // 6) POI radius (meter) dengan PostGIS geography
    const poiQ = await client.query(
      `SELECT p.name, p.category,
              ST_Y(p.geom) AS lat,
              ST_X(p.geom) AS lon
       FROM poi_points p
       JOIN sites s ON s.id = $1
       WHERE ST_DWithin(p.geom::geography, s.geom::geography, $4)
       ORDER BY p.category, p.name
       LIMIT 200`,
      [site_id, start, end, poi_radius_m]
    );

    // 7) Insights
    const insightQ = await client.query(
      `SELECT bullets
       FROM site_insights
       WHERE site_id = $1
         AND period_start <= $2::date
         AND period_end >= $3::date
       ORDER BY created_at DESC
       LIMIT 1`,
      [site_id, start, end]
    );

    const insights =
      insightQ.rowCount > 0 && Array.isArray(insightQ.rows[0].bullets)
        ? insightQ.rows[0].bullets
        : [
            "Puncak traffic sering terjadi pada jam sibuk (pagi/sore).",
            "Segmen usia produktif cenderung dominan pada area komersial.",
            "Komposisi kendaraan dapat memengaruhi estimasi impressions."
          ];

    await client.query("COMMIT");

    return res.json({
      meta: { site_id, start, end },
      site,
      kpis,
      charts: { gender, ageGroups, vehicleTypes },
      traffic: { hourly: hourlyQ.rows, daily: dailyQ.rows },
      map: { pois: poiQ.rows },
      insights
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  } finally {
    client.release();
  }
});

// === DEBUG ROUTE (PAKSA) ===
app.get("/__traffic_test", (req, res) => {
  res.json({ ok: true, from: "server.js", pid: process.pid });
});

const PORT = process.env.PORT || 3000;

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});


app.listen(PORT, () => {
  console.log("API running on port", PORT);
});

