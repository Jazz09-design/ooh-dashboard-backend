// dashboard-api.js (fixed)
// API wiring untuk dashboard HTML (mode API, non-dummy)
//
// Fix utama:
// - Tidak lagi bergantung pada variabel global "btnApply" (yang tidak ada di HTML ini)
// - Cari tombol Terapkan via id="filterApply" (fallback: btnApply)
// - Lindungi race condition: hanya response terakhir yang dipakai (request sequence guard)

(() => {
  // Matikan dummy wiring (inline script) kalau file ini aktif
  window.__USE_API_WIRING__ = true;

  const CFG = window.APP_CONFIG || {};
  const API_BASE = String(CFG.API_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  const PREFIX   = String(CFG.DASHBOARD_PREFIX || "/api/dashboard").replace(/\/+$/, "");

  const el = (id) => document.getElementById(id);

  // Elemen filter (sesuaikan dengan HTML Anda)
  const $loc   = () => el("filterLocation");
  const $ooh   = () => el("filterType");
  const $city  = () => el("filterCity");
  const $month = () => el("filterMonth");
  const $from  = () => el("dateFrom");
  const $to    = () => el("dateTo");

  const $applyBtn = () => el("filterApply") || el("btnApply"); // fallback untuk versi lain

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Map slug -> site_id (sesuaikan kalau Anda punya lebih banyak lokasi)
  const SITE_MAP = {
    "pasir-kaliki": 1,
    "hang-tuah": 2,
    "raya-darmo": 3,
  };

  function parseSiteId(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    // kalau option valuenya numeric
    if (/^\d+$/.test(s)) return Number(s);
    // kalau slug
    if (SITE_MAP[s] != null) return SITE_MAP[s];
    return null;
  }

  function getFilters() {
    const siteVal = $loc()?.value;
    const site_id = parseSiteId(siteVal);
    const date_from = $from()?.value || "";
    const date_to   = $to()?.value || "";
    const granularity = "daily";

    return {
      site_id,
      date_from,
      date_to,
      granularity,
      ooh_type: $ooh()?.value || "",
      city: $city()?.value || "",
      month: $month()?.value || "",
      _raw_site: siteVal
    };
  }

  function qs(params) {
    const u = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      u.set(k, String(v));
    });
    return u.toString();
  }

  async function fetchJson(path, params) {
    const url = `${API_BASE}${PREFIX}${path}?${qs(params)}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch {}
      throw new Error(`HTTP ${res.status} ${res.statusText} - ${path} - ${body.slice(0,200)}`);
    }
    return res.json();
  }

  // Ubah response /traffic?granularity=hourly jadi array 24 jam (avg per jam)
  function hourlySeriesTo24(resp) {
    const series = resp?.series || [];
    const bucket = Array.from({ length: 24 }, () => ({ sum: 0, n: 0 }));
    for (const p of series) {
      const x = String(p.x || "");
      const m = x.match(/\b(\d{2}):00\b/);
      if (!m) continue;
      const h = Number(m[1]);
      const v = Number(p.value ?? 0);
      if (Number.isFinite(h) && h >= 0 && h < 24 && Number.isFinite(v)) {
        bucket[h].sum += v;
        bucket[h].n += 1;
      }
    }
    return bucket.map(b => b.n ? Math.round(b.sum / b.n) : 0);
  }

  // Ubah response /traffic?granularity=daily jadi {labels, values}
  function dailySeries(resp) {
    const series = resp?.series || [];
    return {
      labels: series.map(p => p.x),
      values: series.map(p => Number(p.value ?? 0)),
    };
  }

  
  // ===== Hourly chart renderer (force 24 jam bar chart) =====
  let __hourlyChart = null;

  function findHourlyEl() {
    return (
      document.querySelector("#hourlyTrafficChart") ||
      document.querySelector("#totalRevenueChart") ||
      document.querySelector("#hourlyChart") ||
      document.querySelector("#hourly-chart") ||
      document.querySelector("[data-hourly-chart]") ||
      null
    );
  }

  function ensureHourlyChart() {
    const el = findHourlyEl();
    if (!el || !window.ApexCharts) return null;
    if (__hourlyChart) return __hourlyChart;

    // bersihkan isi template (kalau ada)
    try { el.innerHTML = ""; } catch {}

    const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0") + ":00");

    __hourlyChart = new window.ApexCharts(el, {
      chart: { type: "bar", height: 320, toolbar: { show: false } },
      series: [{ name: "Hourly Traffic", data: Array(24).fill(0) }],
      xaxis: { categories: hours },
      plotOptions: { bar: { horizontal: false, columnWidth: "55%" } },
      dataLabels: { enabled: false },
      stroke: { show: false },
      yaxis: { labels: { formatter: (v) => Math.round(v) } },
      tooltip: { y: { formatter: (v) => Math.round(v) } },
    });
    __hourlyChart.render();
    return __hourlyChart;
  }

  function renderHourly24(arr24) {
    const chart = ensureHourlyChart();
    if (!chart) return;

    const safe = Array.isArray(arr24) ? arr24.slice(0, 24) : [];
    while (safe.length < 24) safe.push(0);

    chart.updateSeries([{ name: "Hourly Traffic", data: safe }], true);
  }

let __reqSeq = 0;

  async function refreshAll(reason = "manual") {
    const seq = ++__reqSeq;

    const f = getFilters();
    if (!f.site_id || !f.date_from || !f.date_to) {
      console.warn("[dashboard-api] Filter belum lengkap", f);
      return;
    }

    // Optional: tampilkan indikator ringan
    console.info("[dashboard-api] refresh", reason, f);

    try {
      // Jalankan paralel: KPI + traffic daily + traffic hourly + demography
      const [kpi, tDaily, tHourly, demo] = await Promise.all([
        fetchJson("/kpi", { site_id: f.site_id, date_from: f.date_from, date_to: f.date_to }),
        fetchJson("/traffic", { site_id: f.site_id, date_from: f.date_from, date_to: f.date_to, granularity: "daily" }),
        fetchJson("/traffic", { site_id: f.site_id, date_from: f.date_from, date_to: f.date_to, granularity: "hourly" }),
        fetchJson("/demography", { site_id: f.site_id, date_from: f.date_from, date_to: f.date_to }),
      ]);

      // Abaikan response lama (race condition)
      if (seq !== __reqSeq) return;

      // 1) Update KPI cards (jika ada fungsi global dari HTML)
      if (typeof window.updateKpiCards === "function") {
        window.updateKpiCards(kpi);
      }

      // 2) Update "traffic chart" harian (jika ada fungsi global)
      const ds = dailySeries(tDaily);
      if (typeof window.updateTrafficDailyChart === "function") {
        window.updateTrafficDailyChart(ds.labels, ds.values);
      }

      // 3) Update hourly chart (HTML Anda sudah punya function updateHourlyChart(hourlyArr))
      const h24 = hourlySeriesTo24(tHourly);
      if (typeof window.updateHourlyChart === "function") {
        window.updateHourlyChart(h24);
      }


      // paksa hourly chart menjadi 24 jam (bar)
      renderHourly24(h24);
      // 4) Update demography (kalau ada handler global)
      if (typeof window.updateDemographyCharts === "function") {
        window.updateDemographyCharts(demo);
      }

    } catch (err) {
      console.error("[dashboard-api] init/refresh error:", err);
      // tampilkan alert yang ramah (Safari)
      try {
        alert("Gagal init dashboard API wiring. Cek console untuk detail.\n\n" + (err?.message || err));
      } catch {}
    }
  }

  function bindUI() {
    const btn = $applyBtn();
    if (!btn) {
      // Jangan throw (biar dashboard tetap tampil), cukup warning
      console.warn("[dashboard-api] Tombol Terapkan tidak ditemukan. Pastikan ada id='filterApply' di HTML.");
      return;
    }
    btn.addEventListener("click", () => refreshAll("apply"));

    // Optional: auto refresh kalau user ganti dropdown (tanpa klik Terapkan)
    // (dinonaktifkan default agar tidak spam request)
    // [$loc(), $ooh(), $city(), $month(), $from(), $to()].forEach(x => x && x.addEventListener("change", () => refreshAll("change")));
  }

  // Start saat DOM siap
  document.addEventListener("DOMContentLoaded", async () => {
    bindUI();
    // sedikit delay agar chart template selesai init dulu
    await sleep(50);
    refreshAll("startup");
  });
})();


async function exportPdf() {
  // Safari-safe Print to PDF (avoid html2canvas color() issues)
  window.print();
}



// ===== PDF HOTFIX (Safari): force Print-to-PDF and stop other PDF handlers =====
(function () {
  function bindPdfHotfix() {
    const btn = document.getElementById("btnExportPdf");
    if (!btn) return;
    // Capture phase to run BEFORE other listeners
    btn.addEventListener(
      "click",
      function (e) {
        try {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        } catch {}
        // Always use browser print (avoids html2canvas color() error)
        window.print();
      },
      true
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindPdfHotfix);
  } else {
    bindPdfHotfix();
  }
})();

