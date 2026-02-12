-- ==========================================
-- NEON READY: SCHEMA + IMPORT + SEED DEMO (LAST 3 MONTHS)
-- Periode: 2025-11-01 s/d 2026-01-31
-- Catatan:
--   - Script ini WAJIB dijalankan via psql (karena ada \copy)
--   - Pastikan DATABASE_URL Neon sudah ada di .env (atau export di shell)
--   - Ganti <<ABSOLUTE_PATH>> ke folder tempat CSV berada
-- ==========================================

-- Jalankan contoh:
--   psql "$DATABASE_URL" -f IMPORT_AND_SEED_NEON_LAST3MONTHS.sql
-- atau (kalau DATABASE_URL ada di .env):
--   node -e "require('dotenv').config(); console.log(process.env.DATABASE_URL)" | xargs -I{} psql "{}" -f IMPORT_AND_SEED_NEON_LAST3MONTHS.sql

-- 0) EXTENSIONS (dibutuhkan untuk PostGIS: ST_MakePoint, geography, ST_DWithin, dll)
CREATE EXTENSION IF NOT EXISTS postgis;

-- 0b) SCHEMA: tabel minimal untuk backend & seed demo
CREATE TABLE IF NOT EXISTS sites (
  id BIGSERIAL PRIMARY KEY,
  site_code   TEXT UNIQUE NOT NULL,
  site_name   TEXT NOT NULL,
  city        TEXT,
  area        TEXT,
  type_ooh    TEXT,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  geom        geography(Point,4326),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sites_city ON sites(city);
CREATE INDEX IF NOT EXISTS idx_sites_type_ooh ON sites(type_ooh);
CREATE INDEX IF NOT EXISTS idx_sites_geom ON sites USING GIST (geom);

CREATE TABLE IF NOT EXISTS traffic_hourly (
  id BIGSERIAL PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  ts_hour TIMESTAMP NOT NULL,
  volume  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_traffic_hourly_site_ts ON traffic_hourly(site_id, ts_hour);

CREATE TABLE IF NOT EXISTS traffic_daily (
  id BIGSERIAL PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  volume  BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_traffic_daily_site_date ON traffic_daily(site_id, date);

CREATE TABLE IF NOT EXISTS site_scores_daily (
  id BIGSERIAL PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  d DATE NOT NULL,
  poi_score          NUMERIC,
  technical_score    NUMERIC,
  traffic_score      NUMERIC,
  demographic_score  NUMERIC,
  impressions        BIGINT,
  total_score        NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_scores_site_d ON site_scores_daily(site_id, d);

CREATE TABLE IF NOT EXISTS site_demographics_daily (
  id BIGSERIAL PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  d DATE NOT NULL,
  gender        JSONB,
  age_groups    JSONB,
  vehicle_types JSONB
);
CREATE INDEX IF NOT EXISTS idx_demo_site_d ON site_demographics_daily(site_id, d);

-- Tabel ini dipakai oleh endpoint overview (map POI + insights).
-- Kalau belum ada data, aman (return kosong), tapi tabel harus ada supaya query tidak error.
CREATE TABLE IF NOT EXISTS poi_points (
  id BIGSERIAL PRIMARY KEY,
  name     TEXT NOT NULL,
  category TEXT,
  geom     geometry(Point,4326) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_poi_geom ON poi_points USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_poi_category ON poi_points(category);

CREATE TABLE IF NOT EXISTS site_insights (
  id BIGSERIAL PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  bullets      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insights_site_period ON site_insights(site_id, period_start, period_end);

-- ==========================================
-- 1) IMPORT sites (CSV)
-- ==========================================
-- IMPORTANT:
-- - Pastikan file CSV ada di laptop kamu (bukan di server Neon)
-- - Ganti <<ABSOLUTE_PATH>> misal: /Users/wawan/Downloads/ooh-seed
\copy sites(site_code,site_name,city,area,type_ooh,latitude,longitude,is_active) FROM './sites_final_ready_import.csv' WITH (FORMAT csv, HEADER true);

-- 2) Update geom (untuk map)
UPDATE sites
SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE geom IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

-- ==========================================
-- 3) Seed traffic_hourly
-- ==========================================
DROP TABLE IF EXISTS stg_traffic_hourly;
CREATE TEMP TABLE stg_traffic_hourly(
  site_code TEXT,
  ts_hour   TIMESTAMP,
  volume    INTEGER
);

\copy stg_traffic_hourly(site_code,ts_hour,volume) FROM './seed_traffic_hourly_last3months.csv' WITH (FORMAT csv, HEADER true);

INSERT INTO traffic_hourly(site_id, ts_hour, volume)
SELECT s.id, t.ts_hour, t.volume
FROM stg_traffic_hourly t
JOIN sites s ON s.site_code = t.site_code;

-- ==========================================
-- 4) Seed traffic_daily (opsional)
-- ==========================================
DROP TABLE IF EXISTS stg_traffic_daily;
CREATE TEMP TABLE stg_traffic_daily(
  site_code TEXT,
  date      DATE,
  volume    BIGINT
);

\copy stg_traffic_daily(site_code,date,volume) FROM './seed_traffic_daily_last3months.csv' WITH (FORMAT csv, HEADER true);

INSERT INTO traffic_daily(site_id, date, volume)
SELECT s.id, d.date, d.volume
FROM stg_traffic_daily d
JOIN sites s ON s.site_code = d.site_code;

-- ==========================================
-- 5) Seed site_scores_daily (KPI + impressions)
-- ==========================================
DROP TABLE IF EXISTS stg_scores;
CREATE TEMP TABLE stg_scores(
  site_code TEXT,
  d DATE,
  poi_score NUMERIC,
  technical_score NUMERIC,
  traffic_score NUMERIC,
  demographic_score NUMERIC,
  impressions BIGINT,
  total_score NUMERIC
);

\copy stg_scores(site_code,d,poi_score,technical_score,traffic_score,demographic_score,impressions,total_score) FROM './seed_site_scores_daily_last3months.csv' WITH (FORMAT csv, HEADER true);

INSERT INTO site_scores_daily(site_id, d, poi_score, technical_score, traffic_score, demographic_score, impressions, total_score)
SELECT s.id, x.d, x.poi_score, x.technical_score, x.traffic_score, x.demographic_score, x.impressions, x.total_score
FROM stg_scores x
JOIN sites s ON s.site_code = x.site_code;

-- ==========================================
-- 6) Seed site_demographics_daily (demografi)
-- ==========================================
DROP TABLE IF EXISTS stg_demo;
CREATE TEMP TABLE stg_demo(
  site_code TEXT,
  d DATE,
  gender JSONB,
  age_groups JSONB,
  vehicle_types JSONB
);

\copy stg_demo(site_code,d,gender,age_groups,vehicle_types) FROM './seed_site_demographics_daily_last3months.csv' WITH (FORMAT csv, HEADER true);

INSERT INTO site_demographics_daily(site_id, d, gender, age_groups, vehicle_types)
SELECT s.id, x.d, x.gender, x.age_groups, x.vehicle_types
FROM stg_demo x
JOIN sites s ON s.site_code = x.site_code;

-- ==========================================
-- 7) Validasi cepat
-- ==========================================
SELECT COUNT(*) AS total_sites FROM sites;
SELECT COUNT(*) AS traffic_hourly_rows FROM traffic_hourly;
SELECT COUNT(*) AS scores_rows FROM site_scores_daily;
SELECT MIN(total_score) AS min_score, AVG(total_score) AS avg_score FROM site_scores_daily;
SELECT MIN(impressions) AS min_impressions, AVG(impressions) AS avg_impressions FROM site_scores_daily;
