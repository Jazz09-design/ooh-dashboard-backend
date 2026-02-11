/**
 * Seed traffic_daily & traffic_hourly untuk demo (Okt–Des 2025).
 * Schema (dari traffic.controller.js):
 *  - traffic_daily(site_id, d, volume)
 *  - traffic_hourly(site_id, ts_hour, volume)
 *
 * Jalankan dari folder backend:
 *   node seed_traffic_oct_dec_2025.fixed.js
 */

require("dotenv").config(); // IMPORTANT: agar PGHOST/PGDATABASE/... kebaca dari .env

const { pool } = require("./db/index.js"); // mengikuti server.js (./db/index.js)

function isoDate(dateObj) {
  return dateObj.toISOString().slice(0, 10);
}

function* eachDay(startISO, endISO) {
  const start = new Date(startISO + "T00:00:00Z");
  const end = new Date(endISO + "T00:00:00Z");
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    yield new Date(d);
  }
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// Daily total: weekday tinggi, weekend lebih rendah, ada noise.
function generateDailyTotal(dateObj) {
  const day = dateObj.getUTCDay(); // 0 Sun ... 6 Sat
  const isWeekend = day === 0 || day === 6;

  let base = isWeekend ? randInt(30000, 42000) : randInt(42000, 60000);
  base += randInt(-3000, 3000);
  return clamp(base, 26000, 65000);
}

// Distribusi 24 jam dengan 2 puncak (pagi & sore).
// Output int yang jumlahnya tepat = total.
function distributeHourly(total) {
  const weights = Array.from({ length: 24 }, (_, h) => {
    const morning = Math.exp(-Math.pow((h - 9) / 2.2, 2));
    const evening = Math.exp(-Math.pow((h - 18) / 2.6, 2));
    const baseline = 0.15;
    return baseline + 1.2 * morning + 1.35 * evening;
  });

  const sumW = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / sumW) * total);

  const ints = raw.map((x) => Math.floor(x));
  let diff = total - ints.reduce((a, b) => a + b, 0);

  let i = 0;
  while (diff > 0) {
    ints[i % 24] += 1;
    diff -= 1;
    i += 1;
  }
  return ints;
}

async function seedTraffic({ siteId, start, end }) {
  console.log(`Seeding traffic for site_id=${siteId} from ${start} to ${end} ...`);

  // Validasi env biar error-nya jelas (daripada "database user does not exist")
  const required = ["PGHOST", "PGDATABASE", "PGUSER"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `ENV belum lengkap: ${missing.join(", ")}. Pastikan file .env ada di folder backend dan berisi PGHOST/PGDATABASE/PGUSER/PGPASSWORD/PGPORT`
    );
  }

  // Hapus dulu agar bisa di-run berulang (idempotent)
  await pool.query(
    `DELETE FROM traffic_hourly
     WHERE site_id = $1
       AND ts_hour >= $2::date
       AND ts_hour < ($3::date + INTERVAL '1 day')`,
    [siteId, start, end]
  );

  await pool.query(
    `DELETE FROM traffic_daily
     WHERE site_id = $1 AND d BETWEEN $2::date AND $3::date`,
    [siteId, start, end]
  );

  // INSERT traffic_daily (batch)
  const dailyRows = [];
  const dailyParams = [];
  let p = 1;

  // INSERT traffic_hourly per hari (biar query tidak kepanjangan)
  for (const day of eachDay(start, end)) {
    const total = generateDailyTotal(day);
    const dStr = isoDate(day);

    dailyRows.push(`($${p++}, $${p++}::date, $${p++}::bigint)`);
    dailyParams.push(siteId, dStr, total);

    const hourly = distributeHourly(total);

    const hrRows = [];
    const hrParams = [];
    let h = 1;

    for (let hour = 0; hour < 24; hour++) {
      const ts = `${dStr} ${String(hour).padStart(2, "0")}:00:00+00`;
      hrRows.push(`($${h++}, $${h++}::timestamptz, $${h++}::bigint)`);
      hrParams.push(siteId, ts, hourly[hour]);
    }

    await pool.query(
      `INSERT INTO traffic_hourly (site_id, ts_hour, volume) VALUES ${hrRows.join(",")}`,
      hrParams
    );
  }

  await pool.query(
    `INSERT INTO traffic_daily (site_id, d, volume) VALUES ${dailyRows.join(",")}`,
    dailyParams
  );

  console.log("✅ Done.");
}

(async () => {
  const SITE_ID = 1;          // Pasir Kaliki
  const START = "2025-10-01"; // 3 bulan ke belakang dari Des
  const END = "2025-12-31";

  try {
    await seedTraffic({ siteId: SITE_ID, start: START, end: END });
  } catch (e) {
    console.error("❌ Seed failed:", e.message || e);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
})();
