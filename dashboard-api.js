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
  const $from  = () => el("filterStartDate") || el("dateFrom");
  const $to    = () => el("filterEndDate") || el("dateTo");

  const $applyBtn = () => el("filterApply") || el("btnApply"); // fallback untuk versi lain

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ====== Global date bounds (from /filters) ======
  let __DATE_MIN__ = null; // YYYY-MM-DD
  let __DATE_MAX__ = null; // YYYY-MM-DD

  function isISODate(s){ return /^\d{4}-\d{2}-\d{2}$/.test(String(s||"")); }
  function monthOfISODate(iso){ return isISODate(iso) ? iso.slice(0,7) : ""; }

  // Clamp ISO date to [min,max] (inclusive)
  function clampISODate(d, min, max){
    if (!isISODate(d)) return d;
    if (isISODate(min) && d < min) return min;
    if (isISODate(max) && d > max) return max;
    return d;
  }

  // Build first/last day of a YYYY-MM month
  function monthBounds(ym){
    if (!/^\d{4}-\d{2}$/.test(String(ym||""))) return { min: null, max: null };
    const [y, m] = ym.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
    const mm = String(m).padStart(2,"0");
    return { min: `${y}-${mm}-01`, max: `${y}-${mm}-${String(last).padStart(2,"0")}` };
  }

  function setDateInputsGlobalBounds(){
    const elStart = $from();
    const elEnd = $to();
    if (!elStart || !elEnd) return;
    if (isISODate(__DATE_MIN__)) { elStart.min = __DATE_MIN__; elEnd.min = __DATE_MIN__; }
    if (isISODate(__DATE_MAX__)) { elStart.max = __DATE_MAX__; elEnd.max = __DATE_MAX__; }
  }

  function syncDatesToMonth(ym){
    const elStart = $from();
    const elEnd = $to();
    if (!elStart || !elEnd) return;

    const b = monthBounds(ym);
    if (!b.min || !b.max) return;

    // Clamp month bounds by global bounds
    const minDate = clampISODate(b.min, __DATE_MIN__, __DATE_MAX__);
    const maxDate = clampISODate(b.max, __DATE_MIN__, __DATE_MAX__);

    // Ensure start/end are within [minDate,maxDate]
    const curStart = isISODate(elStart.value) ? elStart.value : minDate;
    const curEnd = isISODate(elEnd.value) ? elEnd.value : maxDate;

    const nextStart = clampISODate(curStart, minDate, maxDate);
    let nextEnd = clampISODate(curEnd, minDate, maxDate);

    // If start > end, auto-fix end = start
    if (nextEnd < nextStart) nextEnd = nextStart;

    elStart.value = nextStart;
    elEnd.value = nextEnd;
  }

  async function initFiltersFromApi(){
    try {
      const f = await fetchJson("/filters", {});
      const months = (f?.months || []).filter(Boolean).sort();
      const elMonth = $month();

      // Set global bounds
      const dm = String(f?.date_min || "").slice(0,10);
      const dx = String(f?.date_max || "").slice(0,10);
      __DATE_MIN__ = isISODate(dm) ? dm : __DATE_MIN__;
      __DATE_MAX__ = isISODate(dx) ? dx : __DATE_MAX__;

      if (elMonth && months.length){
        elMonth.min = months[0];
        elMonth.max = months[months.length-1];
        if (!elMonth.value || elMonth.value < elMonth.min || elMonth.value > elMonth.max){
          elMonth.value = months[months.length-1];
        }
      }

      setDateInputsGlobalBounds();

      const ym = $month()?.value;
      if (ym) syncDatesToMonth(ym);

      return f;
    } catch (e){
      console.warn("[dashboard-api] initFiltersFromApi gagal:", e);
      return null;
    }
  }

  function bindMonthAndDateSync(){
    const elMonth = $month();
    const elStart = $from();
    const elEnd = $to();

    // Month changed -> adjust dates to that month
    if (elMonth){
      elMonth.addEventListener("change", () => {
        syncDatesToMonth(elMonth.value);
        // update badges + refresh data on month change (same behavior as "Terapkan")
        refreshAll().catch(()=>{});
      });
    }

    // Date changed -> auto-sync month to match start date's month
    if (elStart){
      elStart.addEventListener("change", () => {
        const ym = monthOfISODate(elStart.value);
        if (ym && elMonth && elMonth.value !== ym){
          elMonth.value = ym;
        }
        // ensure end date not behind start, and within month
        if (ym) syncDatesToMonth(ym);
      });
    }

    if (elEnd){
      elEnd.addEventListener("change", () => {
        // if end < start, fix
        if (elStart && isISODate(elStart.value) && isISODate(elEnd.value) && elEnd.value < elStart.value){
          elEnd.value = elStart.value;
        }
      });
    }
  }


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


// ===== HOURLY 24H (Override template) + PDF Print (Safari-safe) =====
(function () {
  const CFG = window.APP_CONFIG || {};
  const API_BASE = CFG.API_BASE_URL || "http://localhost:3000";
  const DASH_PREFIX = CFG.DASHBOARD_PREFIX || "/api/dashboard";

  function toISODate(input) {
    if (!input) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
    const m = input.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return input;
  }

  function getParams() {
    const siteEl = document.getElementById("filterLocation");
    const fromEl = document.getElementById("filterStartDate");
    const toEl = document.getElementById("filterEndDate");
    const site_id = Number(siteEl?.value || 1) || 1;
    const date_from = toISODate(fromEl?.value || "");
    const date_to = toISODate(toEl?.value || "");
    return { site_id, date_from, date_to };
  }

  async function fetchHourly(p) {
    const url =
      `${API_BASE}${DASH_PREFIX}/traffic` +
      `?site_id=${encodeURIComponent(p.site_id)}` +
      `&date_from=${encodeURIComponent(p.date_from)}` +
      `&date_to=${encodeURIComponent(p.date_to)}` +
      `&granularity=hourly`;
    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
    return json;
  }

  function seriesTo24(data) {
    const sum = Array(24).fill(0);
    const cnt = Array(24).fill(0);
    (data?.series || []).forEach((pt) => {
      const x = pt?.x || pt?.ts_hour || pt?.timestamp;
      const dt = new Date(x);
      const v = Number(pt?.value ?? pt?.volume ?? 0);
      if (!Number.isFinite(v) || Number.isNaN(dt.getTime())) return;
      const h = dt.getHours();
      sum[h] += v;
      cnt[h] += 1;
    });
    return sum.map((s, h) => (cnt[h] ? Math.round(s / cnt[h]) : 0));
  }

  let hourlyChart = null;

  function findHourlyEl() {
    return (
      document.querySelector("[data-hourly-chart]") ||
      document.querySelector("#totalRevenueChart") ||
      document.querySelector("#hourlyTrafficChart") ||
      null
    );
  }

  function ensureHourlyChart() {
    const el = findHourlyEl();
    if (!el) return null;
    if (!window.ApexCharts) {
      console.warn("ApexCharts belum ter-load. Hourly chart tidak dirender.");
      return null;
    }
    if (hourlyChart) return hourlyChart;

    try { el.innerHTML = ""; } catch {}

    const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0") + ":00");
    hourlyChart = new window.ApexCharts(el, {
      chart: { type: "bar", height: 320, toolbar: { show: false } },
      series: [{ name: "Hourly Traffic", data: Array(24).fill(0) }],
      xaxis: { categories: hours },
      plotOptions: { bar: { horizontal: false, columnWidth: "55%" } },
      dataLabels: { enabled: false },
      stroke: { show: false },
      tooltip: { y: { formatter: (v) => Math.round(v) } }
    });
    hourlyChart.render();
    return hourlyChart;
  }

  function renderHourly(arr24) {
    const ch = ensureHourlyChart();
    if (!ch) return;
    const d = Array.isArray(arr24) ? arr24.slice(0, 24) : [];
    while (d.length < 24) d.push(0);
    ch.updateSeries([{ name: "Hourly Traffic", data: d }], true);
  }

  async function refreshHourly() {
    const p = getParams();
    if (!p.date_from || !p.date_to) return;
    const data = await fetchHourly(p);
    renderHourly(seriesTo24(data));
  }


  // ===== Multi-site dropdown loader =====
  async function loadSites() {
    const sel = document.getElementById("filterLocation");
    if (!sel) return;

    const candidates = [
      `${API_BASE}${DASH_PREFIX}/filters`,
      `${API_BASE}${DASH_PREFIX}/filters/sites`,
      `${API_BASE}/api/filters`,
      `${API_BASE}/api/dashboard/filters`,
      `${API_BASE}/api/dashboard/filters/sites`
    ];

    let payload = null;
    for (const u of candidates) {
      try {
        const r = await fetch(u, { cache: "no-store" });
        if (!r.ok) continue;
        const j = await r.json().catch(() => null);
        if (j) { payload = j; break; }
      } catch (e) {}
    }
    if (!payload) {
      console.warn("Gagal memuat daftar lokasi dari API (filters). Dropdown tetap dummy.");
      return;
    }

    // normalisasi bentuk response
    const sites =
      payload.sites ||
      payload.data?.sites ||
      payload.filters?.sites ||
      payload.locations ||
      payload.data ||
      [];

    if (!Array.isArray(sites) || sites.length === 0) {
      console.warn("Response filters tidak berisi daftar sites yang valid:", payload);
      return;
    }

    // simpan map global
    window.__SITES_LIST__ = sites;

    // simpan pilihan lama (slug atau id)
    const prev = sel.value;

    // rebuild options
    sel.innerHTML = "";
    for (const s of sites) {
      const id = s.id ?? s.site_id ?? s.siteId;
      if (id == null) continue;
      const name = s.name ?? s.site_name ?? s.label ?? `Site ${id}`;
      const city = s.city ?? s.kota ?? "";
      const opt = document.createElement("option");
      opt.value = String(id);
      opt.textContent = city ? `${name} — ${city}` : name;
      sel.appendChild(opt);
    }

    // restore selection
    let restored = false;
    if (prev) {
      // jika prev numeric
      const prevNum = String(parseInt(prev, 10));
      for (const o of sel.options) {
        if (o.value === prevNum) { sel.value = prevNum; restored = true; break; }
      }
      if (!restored) {
        // coba cocokkan berdasarkan slug/name
        const p = String(prev).toLowerCase();
        const match = sites.find(s => String(s.slug || s.code || s.name || "").toLowerCase().includes(p));
        if (match) {
          const id = match.id ?? match.site_id ?? match.siteId;
          if (id != null) { sel.value = String(id); restored = true; }
        }
      }
    }
    if (!restored && sel.options.length) sel.selectedIndex = 0;

    // sync city & type (jika ada)
    try {
      const curId = Number(sel.value);
      const cur = sites.find(s => Number(s.id ?? s.site_id ?? s.siteId) === curId);
      if (cur) {
        const elCity = document.getElementById("filterCity");
        const elType = document.getElementById("filterOOHType");
        if (elCity && cur.city) {
          const v = String(cur.city).toLowerCase();
          const opt = Array.from(elCity.options).find(o => String(o.value).toLowerCase() === v);
          if (opt) elCity.value = opt.value;
        }
        if (elType && (cur.ooh_type || cur.type || cur.oohType)) {
          // mapping sederhana (sesuaikan bila perlu)
          const t = String(cur.ooh_type || cur.type || cur.oohType).toLowerCase();
          const map = [
            ["billboard vertical", "bb-vertical"],
            ["billboard horizontal", "bb-horizontal"],
            ["led vertical", "led-vertical"],
            ["led horizontal", "led-horizontal"],
            ["neonbox vertical", "neonbox-vertical"],
            ["neonbox horizontal", "neonbox-horizontal"],
          ];
          const m = map.find(([k]) => t.includes(k));
          if (m) elType.value = m[1];
        }
      }
    } catch (e) {}
  }

  function bindApplyHook() {
    const btn = document.getElementById("filterApply");
    if (!btn) return;
    btn.addEventListener("click", function () {
      setTimeout(() => { refreshHourly().catch(e => console.warn("Hourly refresh failed:", e)); }, 0);
    }, true);
  }

  function bindPdfHotfix() {
    const btn = document.getElementById("btnExportPdf");
    if (!btn) return;
    btn.addEventListener("click", function (e) {
      try {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      } catch {}
      window.print();
    }, true);
  }

  async function boot() {
    await initFiltersFromApi();
    await loadSites();
    bindApplyHook();
    bindPdfHotfix();
    bindMonthAndDateSync();
    setTimeout(() => { refreshHourly().catch(()=>{}); }, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

