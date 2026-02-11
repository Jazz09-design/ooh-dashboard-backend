// dashboard-api.js (fixed v2)
// - Fix Month selector min/max dari /api/dashboard/filters
// - Fix ID filterStartDate/filterEndDate + filterOOHType sesuai dashboard.html
// - Update badge Periode & Tanggal
// - Filter lokasi mengikuti pilihan City (reverse sync)
// - Export PDF: window.print() (Safari-safe)

(() => {
  window.__USE_API_WIRING__ = true;

  const CFG = window.APP_CONFIG || {};
  const API_BASE = String(CFG.API_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  const PREFIX   = String(CFG.DASHBOARD_PREFIX || "/api/dashboard").replace(/\/+$/, "");

  const el = (id) => document.getElementById(id);

  // ====== Filter elements (sesuai dashboard.html) ======
  const $loc   = () => el("filterLocation");
  const $ooh   = () => el("filterOOHType");
  const $city  = () => el("filterCity");
  const $month = () => el("filterMonth");
  const $from  = () => el("filterStartDate");
  const $to    = () => el("filterEndDate");

  const $applyBtn = () => el("filterApply") || el("btnApply");
  const $pdfBtn   = () => el("btnExportPdf");

  // badges
  const $periodBadge = () => el("periodBadge");
  const $dateBadge   = () => el("dateRangeBadge");

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ====== helpers ======
  function pad2(n){ return String(n).padStart(2,'0'); }
  function lastDayOfMonth(y, m1to12){ return new Date(y, m1to12, 0).getDate(); }

  function formatMonthIdToLabel(monthStr){
    // "2025-12" -> "Des 2025"
    const [y, m] = String(monthStr || "").split("-").map(Number);
    if (!y || !m) return "";
    const nama = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"][m-1] || "";
    return `${nama} ${y}`;
  }

  function setBadges(){
    const m = $month()?.value || "";
    const df = $from()?.value || "";
    const dt = $to()?.value || "";
    const pb = $periodBadge();
    const db = $dateBadge();

    if (pb && m) pb.textContent = formatMonthIdToLabel(m) || m;
    if (db && df && dt) db.textContent = `${df} s/d ${dt}`;
  }

  function syncDatesWithMonth(monthStr){
    const elMonth = $month();
    const elStart = $from();
    const elEnd   = $to();
    if (!elMonth || !elStart || !elEnd) return;

    const [y, m] = String(monthStr || elMonth.value || "").split("-").map(Number);
    if (!y || !m) return;

    const last = lastDayOfMonth(y, m);
    const minDate = `${y}-${pad2(m)}-01`;
    const maxDate = `${y}-${pad2(m)}-${pad2(last)}`;

    elStart.min = minDate; elStart.max = maxDate;
    elEnd.min   = minDate; elEnd.max   = maxDate;

    if (!elStart.value || elStart.value < minDate || elStart.value > maxDate) elStart.value = minDate;
    if (!elEnd.value   || elEnd.value   < minDate || elEnd.value   > maxDate) elEnd.value   = maxDate;

    if (elEnd.value < elStart.value) elEnd.value = elStart.value;

    setBadges();
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
    const res = await fetch(url, { headers: { "Accept": "application/json" }, cache: "no-store" });
    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch {}
      throw new Error(`HTTP ${res.status} ${res.statusText} - ${path} - ${body.slice(0,200)}`);
    }
    return res.json();
  }

  function getFilters() {
    const site_id = Number($loc()?.value || 0) || null;
    const date_from = $from()?.value || "";
    const date_to   = $to()?.value || "";
    return {
      site_id,
      date_from,
      date_to,
      city: $city()?.value || "",
      ooh_type: $ooh()?.value || "",
      month: $month()?.value || "",
    };
  }

  // ====== Month min/max from API ======
  async function initMonthMinMaxFromApi(){
    const elMonth = $month();
    if (!elMonth) return;

    const f = await fetchJson("/filters", {});
    const months = (f?.months || []).filter(Boolean).sort(); // lama -> baru
    if (!months.length) {
      console.warn("[dashboard-api] filters.months kosong, month min/max tidak di-set", f);
      return;
    }

    elMonth.min = months[0];
    elMonth.max = months[months.length - 1];

    if (!elMonth.value || elMonth.value < elMonth.min || elMonth.value > elMonth.max) {
      elMonth.value = elMonth.max; // default latest
    }

    syncDatesWithMonth(elMonth.value);

    elMonth.addEventListener("change", () => {
      syncDatesWithMonth(elMonth.value);
      // optional auto refresh
      // refreshAll("month-change");
    });
  }

  // ====== Reverse sync: City -> Location ======
  function rebuildLocationOptionsByCity(){
    const sites = window.__SITES_LIST__ || [];
    const selLoc = $loc();
    const selCity = $city();
    if (!selLoc || !selCity || !Array.isArray(sites) || !sites.length) return;

    const chosenCity = String(selCity.value || "").toLowerCase();
    const prev = selLoc.value;

    const filtered = chosenCity && chosenCity !== "all"
      ? sites.filter(s => String(s.city ?? s.kota ?? "").toLowerCase() === chosenCity)
      : sites;

    selLoc.innerHTML = "";
    for (const s of filtered) {
      const id = s.id ?? s.site_id ?? s.siteId;
      if (id == null) continue;
      const name = s.name ?? s.site_name ?? s.label ?? `Site ${id}`;
      const city = s.city ?? s.kota ?? "";
      const opt = document.createElement("option");
      opt.value = String(id);
      opt.textContent = city ? `${name} — ${city}` : name;
      selLoc.appendChild(opt);
    }

    // restore previous if still exists
    if (prev) {
      const exists = Array.from(selLoc.options).some(o => o.value === String(prev));
      if (exists) selLoc.value = String(prev);
    }
    if (!selLoc.value && selLoc.options.length) selLoc.selectedIndex = 0;
  }

  async function loadSites() {
    const sel = $loc();
    if (!sel) return;

    const payload = await fetchJson("/filters", {});
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

    window.__SITES_LIST__ = sites;

    // build city dropdown unique (kalau city dropdown ada)
    const citySel = $city();
    if (citySel) {
      const prevCity = citySel.value;
      const cities = Array.from(new Set(sites.map(s => (s.city ?? s.kota ?? "")).filter(Boolean)));
      // kalau option sudah ada (All/Jakarta/dll), kita tidak hapus total; hanya isi jika kosong
      if (citySel.options.length <= 1) {
        for (const c of cities) {
          const opt = document.createElement("option");
          opt.value = c;
          opt.textContent = c;
          citySel.appendChild(opt);
        }
      }
      if (prevCity) citySel.value = prevCity;
      citySel.addEventListener("change", () => {
        rebuildLocationOptionsByCity();
        // optional auto refresh
        // refreshAll("city-change");
      });
    }

    // build location options (initial, ikut city jika dipilih)
    rebuildLocationOptionsByCity();

    // sync city & type based on selected location
    sel.addEventListener("change", () => {
      const curId = Number(sel.value);
      const cur = sites.find(s => Number(s.id ?? s.site_id ?? s.siteId) === curId);
      if (cur) {
        if (citySel && cur.city) {
          const v = String(cur.city);
          const opt = Array.from(citySel.options).find(o => String(o.value).toLowerCase() === v.toLowerCase());
          if (opt) citySel.value = opt.value;
        }
        const typeSel = $ooh();
        if (typeSel && (cur.ooh_type || cur.type || cur.oohType)) {
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
          if (m) typeSel.value = m[1];
        }
      }
    });
  }

  // ====== Refresh dashboard (kpi/traffic/demography) ======
  let __reqSeq = 0;

  async function refreshAll(reason = "manual") {
    const seq = ++__reqSeq;

    const f = getFilters();
    if (!f.site_id || !f.date_from || !f.date_to) {
      console.warn("[dashboard-api] Filter belum lengkap", f);
      return;
    }

    setBadges();

    try {
      const [kpi, tDaily, tHourly, demo] = await Promise.all([
        fetchJson("/kpi", { site_id: f.site_id, date_from: f.date_from, date_to: f.date_to }),
        fetchJson("/traffic", { site_id: f.site_id, date_from: f.date_from, date_to: f.date_to, granularity: "daily" }),
        fetchJson("/traffic", { site_id: f.site_id, date_from: f.date_from, date_to: f.date_to, granularity: "hourly" }),
        fetchJson("/demography", { site_id: f.site_id, date_from: f.date_from, date_to: f.date_to }),
      ]);

      if (seq !== __reqSeq) return;

      if (typeof window.updateKpiCards === "function") window.updateKpiCards(kpi);
      if (typeof window.updateTrafficDailyChart === "function") window.updateTrafficDailyChart(tDaily);
      if (typeof window.updateHourlyChart === "function") window.updateHourlyChart(tHourly);

      // Demography
      if (typeof window.updateDemographyCharts === "function") {
        window.updateDemographyCharts(demo);
      } else {
        // fallback minimal untuk Age Distribution jika chart global tersedia
        try {
          const age = demo?.charts?.place_category?.series || [];
          if (window.ageDistChart && age.length) {
            window.ageDistChart.updateOptions({ xaxis: { categories: age.map(a => a.label) } }, false, true);
            window.ageDistChart.updateSeries([{ name: "Audience", data: age.map(a => a.value) }], true);
          }
        } catch (e) {}
      }
    } catch (err) {
      console.error("[dashboard-api] refresh error:", err);
    }
  }

  function bindUI() {
    const btn = $applyBtn();
    if (btn) btn.addEventListener("click", () => refreshAll("apply"));
    const from = $from(); const to = $to();
    if (from) from.addEventListener("change", setBadges);
    if (to) to.addEventListener("change", setBadges);

    const pdf = $pdfBtn();
    if (pdf) {
      pdf.addEventListener("click", (e) => {
        try { e.preventDefault(); e.stopPropagation(); } catch {}
        window.print();
      }, true);
    }
  }

  async function boot() {
    bindUI();
    await initMonthMinMaxFromApi();
    await loadSites();
    await sleep(50);
    refreshAll("startup");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();