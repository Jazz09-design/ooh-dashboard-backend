const { z } = require("zod");
const { pool } = require("../db");

const TrafficQuery = z.object({
  site_id: z.coerce.number().int().positive(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  granularity: z.enum(["daily", "hourly"]).default("daily")
});

async function getTraffic(req, res) {
  const parsed = TrafficQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const { site_id, date_from, date_to, granularity } = parsed.data;
  if (date_from > date_to) return res.status(400).json({ error: "date_from must be <= date_to" });

  try {
    let series = [];

    if (granularity === "daily") {
      const q = await pool.query(
        `SELECT d::text AS x, volume::bigint AS value
         FROM traffic_daily
         WHERE site_id = $1 AND d BETWEEN $2::date AND $3::date
         ORDER BY d ASC`,
        [site_id, date_from, date_to]
      );
      series = q.rows.map(r => ({ x: r.x, value: Number(r.value) }));
    } else {
      const q = await pool.query(
        `SELECT to_char(ts_hour, 'YYYY-MM-DD HH24:00') AS x, volume::bigint AS value
         FROM traffic_hourly
         WHERE site_id = $1
           AND ts_hour >= $2::date
           AND ts_hour < ($3::date + INTERVAL '1 day')
         ORDER BY ts_hour ASC`,
        [site_id, date_from, date_to]
      );
      series = q.rows.map(r => ({ x: r.x, value: Number(r.value) }));
    }

    // summary sederhana (cukup untuk MVP)
    const avgDaily =
      series.length === 0
        ? 0
        : Math.round(series.reduce((a, b) => a + (b.value || 0), 0) / series.length);

    return res.json({
      meta: { site_id, date_from, date_to, granularity },
      summary: { peak_hour: null, best_day: null, avg_daily_traffic: avgDaily },
      series
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { getTraffic };
