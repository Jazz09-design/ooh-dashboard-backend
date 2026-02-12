// controllers/all.controller.js
const { getKpi } = require("./kpi.controller");
const { getFilters } = require("./filters.controller");
const { getTraffic } = require("./traffic.controller");
const { getDemography } = require("./demography.controller");
const { getOverview } = require("./overview.controller");

/**
 * Jalankan controller Express (req,res) tapi tangkap output JSON-nya
 * tanpa bikin HTTP call ke localhost.
 */
function runController(handler, req) {
  return new Promise((resolve) => {
    const res = {
      _status: 200,
      status(code) {
        this._status = code;
        return this;
      },
      json(payload) {
        resolve({ status: this._status || 200, body: payload });
      },
      send(payload) {
        resolve({ status: this._status || 200, body: payload });
      },
      set() {
        return this;
      },
    };

    Promise.resolve(handler(req, res)).catch((err) => {
      resolve({
        status: 500,
        body: {
          error: "Internal server error",
          message: err?.message,
          code: err?.code,
        },
      });
    });
  });
}

async function getAll(req, res) {
  try {
    const { site_id, date_from, date_to } = req.query;
    const granularity = req.query.granularity || "daily";

    if (!site_id || !date_from || !date_to) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Required query params: site_id, date_from, date_to",
        example:
          "/api/dashboard/all?site_id=1&date_from=2025-12-01&date_to=2025-12-31&granularity=daily",
      });
    }

    // Gunakan req yang sama, tapi pastikan granularity selalu ada
    const reqWithGranularity = {
      ...req,
      query: { ...req.query, granularity },
    };

    const [filtersR, kpiR, trafficR, demographyR, overviewR] = await Promise.all(
      [
        runController(getFilters, reqWithGranularity),
        runController(getKpi, reqWithGranularity),
        runController(getTraffic, reqWithGranularity),
        runController(getDemography, reqWithGranularity),
        runController(getOverview, reqWithGranularity),
      ]
    );

    // Kalau ada yang gagal, tetap balikin semuanya + info error per bagian
    const status =
      [filtersR, kpiR, trafficR, demographyR, overviewR].some((r) => r.status >= 400)
        ? 207 // Multi-Status (praktis untuk agregasi)
        : 200;

    return res.status(status).json({
      meta: {
        site_id: Number(site_id),
        date_from,
        date_to,
        granularity,
        version: "dashboard-all-v1",
      },
      parts_status: {
        filters: filtersR.status,
        kpi: kpiR.status,
        traffic: trafficR.status,
        demography: demographyR.status,
        overview: overviewR.status,
      },
      data: {
        filters: filtersR.body,
        kpi: kpiR.body,
        traffic: trafficR.body,
        demography: demographyR.body,
        overview: overviewR.body,
      },
    });
  } catch (err) {
    console.error("[all.controller] error:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: err?.message,
      code: err?.code,
    });
  }
}

module.exports = { getAll };

