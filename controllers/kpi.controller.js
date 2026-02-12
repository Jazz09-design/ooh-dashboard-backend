// controllers/kpi.controller.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
});

function isYmd(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

let _trafficSchemaCache = null;

async function getTrafficSchema() {
  if (_trafficSchemaCache) return _trafficSchemaCache;

  const { rows } = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='traffic_daily'
    ORDER BY ordinal_position
  `
  );

  const cols = rows.map(r => r.column_name);

  // pilih kolom impression yang tersedia
  const imprCol =
    cols.includes("impression") ? "impression" :
    cols.includes("impressions") ? "impressions" :
    cols.includes("volume") ? "volume" :
    null;

  // pilih kolom tanggal traffic yang tersedia
  const dateCol =
    cols.includes("traffic_date") ? "traffic_date" :
    cols.includes("d") ? "d" :
    cols.includes("date") ? "date" :
    cols.includes("dt") ? "dt" :
    null;

  _trafficSchemaCache = { imprCol, dateCol, cols };
  console.log("KPI traffic_daily schema:", _trafficSchemaCache);
  return _trafficSchemaCache;
}

async function getKpi(req, res) {
  try {
    const siteId = Number(req.query.site_id);
    const dateFrom = req.query.date_from;
    const dateTo = req.query.date_to;

    if (!siteId || !isYmd(dateFrom) || !isYmd(dateTo)) {
      return res.status(400).json({
        error: "Bad request",
        message: "Wajib: site_id (number), date_from (YYYY-MM-DD), date_to (YYYY-MM-DD)"
      });
    }

    // SCORE: sesuai DB kamu (site_scores_daily: site_id, d, poi_score, technical_score, traffic_score, demographic_score, impressions)
    const scoreDateExpr = `(d AT TIME ZONE 'Asia/Jakarta')::date`;

    const qScore = `
      SELECT
        COALESCE(AVG(poi_score), 0)::float AS poi_score,
        COALESCE(AVG(technical_score), 0)::float AS technical_score,
        COALESCE(AVG(traffic_score), 0)::float AS traffic_score,
        COALESCE(AVG(demographic_score), 0)::float AS demographic_score
      FROM site_scores_daily
      WHERE site_id = $1
        AND ${scoreDateExpr} >= $2::date
        AND ${scoreDateExpr} <= $3::date
    `;

    // TRAFFIC: autodetect kolom yang benar pada DB yang sedang dipakai server
    const { imprCol, dateCol, cols } = await getTrafficSchema();

    if (!imprCol) {
      return res.status(500).json({
        error: "Schema error",
        message: `Kolom impression tidak ditemukan di traffic_daily. Kolom tersedia: ${cols.join(", ")}`
      });
    }
    if (!dateCol) {
      return res.status(500).json({
        error: "Schema error",
        message: `Kolom tanggal tidak ditemukan di traffic_daily. Kolom tersedia: ${cols.join(", ")}`
      });
    }

    const trafficDateExpr = `("${dateCol}" AT TIME ZONE 'Asia/Jakarta')::date`;

    const qImpr = `
      SELECT COALESCE(SUM("${imprCol}"), 0)::bigint AS monthly_impression
      FROM traffic_daily
      WHERE site_id = $1
        AND ${trafficDateExpr} >= $2::date
        AND ${trafficDateExpr} <= $3::date
    `;

    const [scoreRes, imprRes] = await Promise.all([
      pool.query(qScore, [siteId, dateFrom, dateTo]),
      pool.query(qImpr, [siteId, dateFrom, dateTo])
    ]);

    const score = scoreRes.rows?.[0] || {};
    const impr = imprRes.rows?.[0] || {};

    const totalScore =
      Number(score.poi_score || 0) +
      Number(score.technical_score || 0) +
      Number(score.traffic_score || 0) +
      Number(score.demographic_score || 0);

    return res.json({
      site_id: siteId,
      date_from: dateFrom,
      date_to: dateTo,
      kpis: {
        poi_score: Number(score.poi_score || 0),
        technical_score: Number(score.technical_score || 0),
        traffic_score: Number(score.traffic_score || 0),
        demographic_score: Number(score.demographic_score || 0),
        monthly_impression: Number(impr.monthly_impression || 0),
        total_score: totalScore
      }
    });
  } catch (err) {
    console.error("KPI ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: err?.message,
      code: err?.code,
      detail: err?.detail
    });
  }
}

module.exports = { getKpi };
