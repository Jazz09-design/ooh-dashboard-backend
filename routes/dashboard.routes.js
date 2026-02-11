const { pool } = require("../db");

const express = require("express");
const router = express.Router();

const { getKpi } = require("../controllers/kpi.controller");
const { getFilters } = require("../controllers/filters.controller");
const { getTraffic } = require("../controllers/traffic.controller");
const { getDemography } = require("../controllers/demography.controller");
const { getOverview } = require("../controllers/overview.controller");
const { dbCheck } = require("../controllers/dbcheck.controller");

// ping buat memastikan router ini kepake
router.get("/__ping", (req, res) => res.json({ ok: true, from: "dashboard" }));
// debug cek koneksi DB + tabel
router.get("/__dbcheck", dbCheck);

router.get("/kpi", getKpi);
router.get("/filters", getFilters);
router.get("/traffic", getTraffic);
router.get("/demography", getDemography);
router.get("/overview", getOverview);

module.exports = router;

