const { z } = require("zod");
const { pool } = require("../db.js");

const DemoQuery = z.object({
  site_id: z.coerce.number().int().positive(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Normalize JSON into chart series [{label, value}]
 * Supports:
 * - Object map: {"male":55,"female":45}
 * - Array: [{"label":"18-24","value":20}, ...]
 */
function jsonToSeries(input) {
  if (!input) return [];

  if (Array.isArray(input)) {
    return input
      .map((it) => ({
        label: String(it?.label ?? it?.name ?? it?.key ?? ""),
        value: Number(it?.value ?? it?.count ?? it?.v ?? 0),
      }))
      .filter((it) => it.label !== "" && Number.isFinite(it.value));
  }

  if (typeof input === "object") {
    return Object.entries(input)
      .map(([label, value]) => ({ label, value: Number(value) }))
      .filter((it) => it.label !== "" && Number.isFinite(it.value));
  }

  return [];
}

async function getDemography(req, res) {
  const parsed = DemoQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid query",
      details: parsed.error.flatten(),
    });
  }

  const { site_id, date_from, date_to } = parsed.data;
  if (date_from > date_to) {
    return res.status(400).json({ error: "date_from must be <= date_to" });
  }

  try {
    const q = await pool.query(
      `SELECT audience_gender, audience_mobile, place_category, interest_segment
       FROM site_demography_daily
       WHERE site_id = $1 AND d BETWEEN $2::date AND $3::date
       ORDER BY d DESC
       LIMIT 1`,
      [site_id, date_from, date_to]
    );

    const row = q.rows[0] || {};

    return res.json({
      meta: { site_id, date_from, date_to, version: "demography-v2-array-series" },
      charts: {
        audience_mobile: { type: "donut", series: jsonToSeries(row.audience_mobile) },
        audience_gender: { type: "donut", series: jsonToSeries(row.audience_gender) },
        place_category: { type: "bar_horizontal", series: jsonToSeries(row.place_category) },
        interest_segmentation: { type: "donut", series: jsonToSeries(row.interest_segment) },
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { getDemography };

