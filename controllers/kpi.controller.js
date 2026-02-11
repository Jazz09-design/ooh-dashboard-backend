// controllers/kpi.controller.js
//const db = require("../db"); // kalau file db Anda namanya beda, nanti kita sesuaikan

async function getKpi(req, res) {
  try {
    console.log("KPI ENDPOINT HIT", req.query);

    const siteId = Number(req.query.site_id);
    const dateFrom = req.query.date_from;
    const dateTo = req.query.date_to;

    if (!siteId || !dateFrom || !dateTo) {
      return res.status(400).json({
        error: "Bad request",
        message: "site_id, date_from, date_to wajib diisi"
      });
    }

    // TEMP response agar server jalan (nanti kita ganti query DB aslinya)
    return res.json({
      site_id: siteId,
      date_from: dateFrom,
      date_to: dateTo,
      kpis: {
        poi_score: 0,
        technical_score: 0,
        traffic_score: 0,
        demographic_score: 0,
        monthly_impression: 0,
        total_score: 0
      }
    });
  } catch (err) {
    console.error("KPI ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: err?.message,
      code: err?.code,
      detail: err?.detail,
      where: err?.where,
      hint: err?.hint,
      stack: err?.stack
    });
  }
}

module.exports = { getKpi };

