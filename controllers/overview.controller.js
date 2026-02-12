console.log("OVERVIEW CONTROLLER LOADED ");
const { z } = require("zod");
const { pool } = require("../db.js");

// Query params validation
const OverviewQuery = z.object({
  site_id: z.coerce.number().int().positive(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  granularity: z.enum(["daily", "hourly"]).default("daily")
});

const round = (x) => Math.round(Number(x || 0));
const toNum = (x) => Number(x || 0);

function buildDailySeries(dateFrom, dateTo, rows) {
  // rows: [{x:'YYYY-MM-DD', value:number}]
  const m = new Map((rows || []).map(r => [String(r.x), Number(r.value)]));
  const out = [];
  const start = new Date(dateFrom + "T00:00:00Z");
  const end = new Date(dateTo + "T00:00:00Z");
  // safety cap 366 days
  let i = 0;
  for (let d = start; d <= end && i < 366; d = new Date(d.getTime() + 86400000), i++) {
    const x = d.toISOString().slice(0,10);
    out.push({ x, value: m.get(x) ?? 0 });
  }
  return out;
}


function jsonToSeries(obj) {
  const o = obj || {};
  return Object.entries(o).map(([label, value]) => ({
    label,
    value: Number(value)
  }));
}

async function getOverview(req, res) {
  console.log("OVERVIEW HIT ", req.query);
  const parsed = OverviewQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const { site_id, date_from, date_to, granularity } = parsed.data;
  if (date_from > date_to) {
    return res.status(400).json({ error: "date_from must be <= date_to" });
  }

  try {
    // =========================
    // 0) Site basic (optional tapi enak buat frontend)
    // =========================
    const siteQ = await pool.query(
      `SELECT id, name, city, ooh_type, latitude, longitude
       FROM sites
       WHERE id = $1`,
      [site_id]
    );
    const site = siteQ.rows[0] || null;

    // =========================
    // 0.5) POI around site (public.poi_points)
    // =========================
    // The demo DB sometimes doesn't have POI. We handle gracefully:
    // - If table exists and site has lat/lon => return pois + count within 500m.
    // - Otherwise return empty list and null count (frontend can show "—").
    let poi_within_500m = null;
    let map = { center: null, pois: [] };

    if (site && site.latitude != null && site.longitude != null) {
      map.center = { lat: Number(site.latitude), lon: Number(site.longitude) };

      try {
        // Haversine distance (meters). Using pure SQL to avoid PostGIS dependency.
        const poiQ = await pool.query(
          `WITH base AS (
             SELECT $1::double precision AS lat0, $2::double precision AS lon0
           ), ranked AS (
             SELECT
               p.id,
               p.name,
               p.category,
               p.latitude AS lat,
               p.longitude AS lon,
               6371000 * 2 * asin(
                 sqrt(
                   pow(sin(radians((p.latitude - b.lat0) / 2)), 2) +
                   cos(radians(b.lat0)) * cos(radians(p.latitude)) *
                   pow(sin(radians((p.longitude - b.lon0) / 2)), 2)
                 )
               ) AS distance_m
             FROM public.poi_points p
             CROSS JOIN base b
             WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
           )
           SELECT *
           FROM ranked
           ORDER BY distance_m ASC
           LIMIT 50;`,
          [Number(site.latitude), Number(site.longitude)]
        );

        const pois = (poiQ.rows || []).map((r) => ({
          id: r.id,
          name: r.name,
          category: r.category,
          lat: Number(r.lat),
          lon: Number(r.lon),
          distance_m: Math.round(Number(r.distance_m || 0))
        }));

        map.pois = pois;
        poi_within_500m = pois.filter((p) => Number(p.distance_m) <= 500).length;
      } catch (e) {
        // Most common cause: table doesn't exist yet.
        // Don't fail /overview; just omit POI.
        console.warn("POI QUERY SKIPPED:", e?.message);
      }
    }

    // =========================
    // 1) KPI (site_scores_daily)
    // =========================
    const kpiQ = await pool.query(
      `SELECT
         AVG(poi_score)         AS poi_score_avg,
         AVG(technical_score)   AS technical_score_avg,
         AVG(traffic_score)     AS traffic_score_avg,
         AVG(demographic_score) AS demographic_score_avg,
         COALESCE(SUM(impressions),0) AS impressions_sum
       FROM site_scores_daily
       WHERE site_id = $1
         AND d BETWEEN $2::date AND $3::date`,
      [site_id, date_from, date_to]
    );

    const k = kpiQ.rows[0] || {};
    const poi = round(k.poi_score_avg);
    const tech = round(k.technical_score_avg);
    const traf = round(k.traffic_score_avg);
    const demo = round(k.demographic_score_avg);
    const total = round((poi + tech + traf + demo) / 4);

    const kpis = {
      poi_score: poi,
      technical_score: tech,
      traffic_score: traf,
      demographic_score: demo,
      monthly_impression: Number(k.impressions_sum || 0),
      total_score: total
    };

    // =========================
    // 2) Traffic (traffic_daily / traffic_hourly)
    // =========================
    let series = [];

    if (granularity === "daily") {
      const tQ = await pool.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS x, volume AS value
         FROM traffic_daily
         WHERE site_id = $1
           AND d BETWEEN $2::date AND $3::date
         ORDER BY d ASC`,
        [site_id, date_from, date_to]
      );

      const raw = tQ.rows.map((r) => ({ x: String(r.x), value: Number(r.value) }));

      // lengkapi tanggal agar chart berubah mengikuti range (isi 0 jika tidak ada data)
      series = buildDailySeries(date_from, date_to, raw);
    } else {
      const tQ = await pool.query(
        `SELECT to_char(ts_hour, 'YYYY-MM-DD HH24:MI') AS x, volume AS value
         FROM traffic_hourly
         WHERE site_id = $1
           AND ts_hour >= $2::date
           AND ts_hour < ($3::date + INTERVAL '1 day')
         ORDER BY ts_hour ASC`,
        [site_id, date_from, date_to]
      );

      const raw = tQ.rows.map((r) => ({ x: String(r.x), value: Number(r.value) }));

      // lengkapi tanggal agar chart berubah mengikuti range (isi 0 jika tidak ada data)
      series = buildDailySeries(date_from, date_to, raw);
    }

    const avgTraffic = series.length
      ? Math.round(series.reduce((sum, p) => sum + toNum(p.value), 0) / series.length)
      : 0;

    const traffic = {
      summary: {
        peak_hour: null,
        best_day: null,
        avg_daily_traffic: avgTraffic
      },
      series
    };

    // =========================
    // 3) Demography (site_demography_daily)
    // =========================
    const dQ = await pool.query(
      `SELECT audience_gender, audience_mobile, place_category, interest_segment
       FROM site_demography_daily
       WHERE site_id = $1
         AND d BETWEEN $2::date AND $3::date
       ORDER BY d DESC
       LIMIT 1`,
      [site_id, date_from, date_to]
    );

    const d = dQ.rows[0] || {};
    const demography = {
      audience_mobile: { type: "donut", series: jsonToSeries(d.audience_mobile) },
      audience_gender: { type: "donut", series: jsonToSeries(d.audience_gender) },
      place_category: { type: "bar_horizontal", series: jsonToSeries(d.place_category) },
      interest_segmentation: { type: "donut", series: jsonToSeries(d.interest_segment) }
    };

    // =========================
    // Response final overview
    // =========================
    return res.json({
      meta: { site_id, date_from, date_to, granularity },
      site,
      kpis,
      poi_within_500m,
      map,
      traffic,
      demography
    });
  } catch (err) {
    console.error("OVERVIEW ERROR:", err);

    return res.status(500).json({
      error: "Internal server error",
      message: err?.message,
      code: err?.code,
      detail: err?.detail,
      where: err?.where,
      stack: (err?.stack || "").split("\n").slice(0, 8),
    });
  }
}

module.exports = { getOverview };


