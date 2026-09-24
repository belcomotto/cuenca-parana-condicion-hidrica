#!/usr/bin/env node
// Builds the verified telemetry station catalog for the wider Paraná basin —
// INA (Argentina) stations on the Pilcomayo, Bermejo, Iguazú and Paraguay
// rivers (plus the mainstem Paraná/tributary gauges visible on INA's public
// map in that same corridor), and MADES (Paraguay) stations on the
// Paraguayan reach of the Paraná/Paraguay/Pilcomayo — plus INA's "Condición
// Hídrica" reach-condition layer. Goal: prove every gauge in this basin can
// actually be fetched live, as the source for a combined ArcGIS Online layer.
//
// Sources:
//   INA SIyAH public API (https://alerta.ina.gob.ar/pub/datos/) + GeoServer
//     - `estaciones` — full national station catalog (~1900 stations).
//     - `series`     — every configured variable series for one station,
//                       with its last observation date. One call tells us
//                       everything a station currently reports, so no more
//                       guessing variable IDs station by station.
//     - GeoServer WFS layer `public2:tramos_condicion_params` — named river
//       reaches with a current level/discharge percentile classification
//       ("aguas altas" .. "aguas bajas") and line geometry.
//   MADES SIAGUAPY (https://siaguapy.mades.gov.py) — see scripts/lib/mades.mjs
//
// Output:
//   public/data/stations.geojson — flat-property GeoJSON, ArcGIS-ready
//   public/data/tramos.geojson   — reach condition lines, ArcGIS-ready
//   public/data/report.json      — verification summary

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchMadesStations } from './lib/mades.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'public', 'data');

const BASE = 'https://alerta.ina.gob.ar/pub/datos/';
const GEOSERVER = 'https://alerta.ina.gob.ar/geoserver/ows';

const RIVERS = ['BERMEJO', 'PILCOMAYO', 'IGUAZU', 'PARAGUAY'];

// Known bad entries in the RHN-SAT catalog, found by manual verification:
//   6637 "Bermejo - Azud los Colorados" sits at -68.25,-29.26 (La Rioja) — a
//        different, unrelated Bermejo river, not the Chaco/Salta one.
//   2154 "Bermejo - Pozo Sarmiento" has zero readings ever — a dead duplicate
//        of 7248 "Bermejo - P. Sarmiento", which is live at nearly the same coords.
const EXCLUDE_SITECODES = new Set([6637, 2154]);

// Stations the user identified by eye on INA's public map (`/pub/mapa`) in the
// Paraguay-river and Iguazú-river map sections. Several of these are actually
// INA-classified as Paraná mainstem gauges ("PARANAMED"/"PARANAINF") rather than
// literally the Iguazú or Paraguay rivers — that's INA's own `rio` tag, kept
// here as-is rather than force-labeled to match the section they were browsed
// under, so the river field stays geographically accurate.
const EXTRA_SITECODES = [
  6659, // Riacho Salado - Tatané - RN 11 (RHN-SAT)
  55,   // Puerto Pilcomayo (escalas Prefectura, rio=PARAGUAY) — distinct from RHN-SAT 2133; also the one INA's forecast model covers
  57,   // Puerto Formosa (escalas Prefectura, rio=PARAGUAY) — distinct from RHN-SAT 2116; also forecast-covered
  58,   // Bermejo / Puerto Bermejo confluence gauge (escalas Prefectura, rio=PARAGUAY)
  59,   // Isla del Cerrito (escalas Prefectura, rio=PARAGUAY) — distinct from RHN-SAT 6449 at same town
  18,   // Paso de la Patria (escalas Prefectura, rio=PARANAMED)
  19,   // Corrientes (escalas Prefectura, rio=PARANAMED)
  20,   // Barranqueras (escalas Prefectura, rio=BARRANQUERAS)
  2854, // Aº Riachuelo - RP Nº5 (RHN-SAT)
  21,   // Empedrado (escalas Prefectura, rio=PARANAINF)
  22,   // Bella Vista (escalas Prefectura, rio=PARANAINF)
  23,   // Goya (escalas Prefectura, rio=PARANAINF)
  16,   // Itá Ibaté (escalas Prefectura, rio=PARANAMED)
  15,   // Ituzaingó (escalas Prefectura, rio=PARANAMED)
  13,   // Santa Ana (escalas Prefectura, rio=PARANAMED)
  14,   // Posadas (escalas Prefectura, rio=PARANAMED)
  12,   // Libertador (escalas Prefectura, rio=PARANAMED)
  6435, // Piray Guazú - R. Nac. 12 Vieja (RHN-SAT)
  11,   // El Dorado (escalas Prefectura, rio=PARANAMED)
  6439, // Piray Miní - Valle Hermoso (RHN-SAT)
  10,   // Libertad (escalas Prefectura, rio=PARANAMED)
  9,    // Puerto Iguazú (escalas Prefectura, rio=PARANAMED)
  8,    // Andresito (escalas Prefectura, rio=IGUAZU)
];

// The 6 named reaches from INA's "Condición Hídrica" product that fall in the
// Pilcomayo/Bermejo/Iguazú/Paraguay corridor (the layer also covers the
// Uruguay river and the Paraná down to the Delta, out of scope here).
const TARGET_REACHES = new Set([
  'Andresito - Desembocadura',
  'Puerto Iguazu - Yacyreta',
  'Barranqueras - Goya',
  'Puerto Pilcomayo - Puerto Formosa',
  'Puerto Formosa - Desembocadura',
  'Yacyreta - Corrientes',
]);

// Official INA color scale for the 5 condition buckets (pulled from the
// GeoServer style's GetLegendGraphic for public2:tramos_condicion_params).
const CONDICION_COLOR = {
  'aguas altas':        '#6fa8dc',
  'aguas medias altas': '#cfe2f3',
  'aguas medias':       '#fff2cc',
  'aguas medias bajas': '#f6b26b',
  'aguas bajas':        '#ea9999',
};

// A station counts as "transmitting" if any of its series has an observation
// within this many days.
const ACTIVE_WINDOW_DAYS = 30;

// How far back to pull for the trend sparkline / rising-falling-steady call.
const TREND_WINDOW_DAYS = 21;

// Which category to use as "the" trend for a station, in priority order —
// river level is what "rising/falling" means to a person watching a river;
// fall back down the list for meteo-only or discharge-only stations.
const TREND_PRIORITY = ['level', 'discharge', 'temperature', 'humidity', 'wind', 'rain', 'hydrological_state'];

// The 4 stations (of our 41) that INA's official forecast model
// (GeoServer public2:last_prono_public_by_var, model "tabprono_central")
// actually covers — it's built for the Paraná/Paraguay mainstem navigation
// network, not the smaller tributaries. We show a real forecast only for
// these; everywhere else the dashboard states plainly that none exists.
const FORECAST_SITECODES = new Set([19, 20, 55, 57]);

// varId -> a friendly category tag, built from the variables actually seen on
// our candidate stations (checked against the full 104-entry `variables`
// catalog, not guessed).
const VAR_CATEGORY = {
  2: 'level', 39: 'level', 85: 'level', 33: 'level', 67: 'level', 50: 'level', 49: 'level',
  4: 'discharge', 40: 'discharge', 87: 'discharge', 48: 'discharge', 68: 'discharge', 69: 'discharge', 70: 'discharge', 71: 'discharge',
  1: 'rain', 27: 'rain', 31: 'rain', 34: 'rain', 91: 'rain', 38: 'rain', 41: 'rain',
  53: 'temperature', 5: 'temperature', 6: 'temperature', 7: 'temperature', 54: 'temperature',
  55: 'wind', 9: 'wind', 10: 'wind', 56: 'wind',
  58: 'humidity', 12: 'humidity', 59: 'humidity',
  104: 'hydrological_state',
};
const CATEGORY_LABEL = {
  level: 'Water level', discharge: 'Discharge', rain: 'Rain',
  temperature: 'Temperature', wind: 'Wind', humidity: 'Humidity',
  hydrological_state: 'Hydrological state', other: 'Other',
};

function norm(s) {
  if (!s) return '';
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

async function fetchJSON(url, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function parseRows(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.data)) return res.data;
  return [];
}

async function fetchStationsCatalog() {
  return parseRows(await fetchJSON(`${BASE}estaciones?format=json`));
}

async function fetchSeriesFor(siteCode) {
  return parseRows(await fetchJSON(`${BASE}series&siteCode=${siteCode}&format=json`));
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

function isoDate(d) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); }
const today = () => isoDate(new Date());

// Reduce a station's raw `series` list to: is it transmitting, and what does
// it report. Keeps only the most-recent series per category (a station can
// have several level series at different aggregations — daily mean, hourly —
// we only need one reading per category for the map).
function summarizeSeries(seriesRows) {
  const byCategory = {};
  let mostRecentReading = null;

  for (const s of seriesRows) {
    const category = VAR_CATEGORY[s.varid];
    if (!category) continue; // skip variables we don't display (pressure, radiation, etc.)
    const days = daysSince(s.to_date);
    if (days == null) continue;

    if (!mostRecentReading || days < mostRecentReading.days) {
      mostRecentReading = { days, date: s.to_date };
    }

    const existing = byCategory[category];
    if (!existing || days < existing.days) {
      byCategory[category] = {
        days, value: null, unit: s.unit_nombre, reading_time: s.to_date, varid: s.varid,
      };
    }
  }

  const active = mostRecentReading != null && mostRecentReading.days <= ACTIVE_WINDOW_DAYS;
  return { active, byCategory, lastReadingDays: mostRecentReading?.days ?? null, lastReadingDate: mostRecentReading?.date ?? null };
}

// The `series` endpoint gives us the last-updated date but not the last
// *value* — pull that with one lightweight `datos` call per active category.
// Uses absolute dates: the API's "T<n>" relative-date shorthand intermittently
// returns "no results" for series that otherwise have a recent to_date.
async function fetchLatestValue(siteCode, varid) {
  const url = `${BASE}datos&siteCode=${siteCode}&varId=${varid}&timeStart=${daysAgo(ACTIVE_WINDOW_DAYS)}&timeEnd=${today()}&format=json`;
  const rows = parseRows(await fetchJSON(url));
  const valid = rows.filter(r => r.valor != null);
  if (!valid.length) return null;
  const latest = valid.reduce((a, b) => new Date(a.timestart) > new Date(b.timestart) ? a : b);
  return Math.round(parseFloat(latest.valor) * 100) / 100;
}

// Pulls the raw observation history for one variable and reduces it to: a
// downsampled daily series for a sparkline, and a rising/falling/steady call.
// The call compares the mean of the most recent ~3 days against the mean of
// the 3 days furthest back in the window — a window-average comparison is
// far less noisy than comparing two single endpoint readings.
async function fetchTrend(siteCode, varid) {
  const url = `${BASE}datos&siteCode=${siteCode}&varId=${varid}&timeStart=${daysAgo(TREND_WINDOW_DAYS)}&timeEnd=${today()}&format=json`;
  const rows = parseRows(await fetchJSON(url))
    .filter(r => r.valor != null)
    .map(r => ({ date: r.timestart, value: parseFloat(r.valor) }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (rows.length < 2) return { history: [], trend: null, change: null, windowDays: TREND_WINDOW_DAYS };

  // Downsample to one point per day (last reading of each day) — hourly
  // RHN-SAT stations would otherwise hand the sparkline hundreds of points.
  const byDay = new Map();
  for (const r of rows) byDay.set(r.date.slice(0, 10), r.value);
  const history = [...byDay.entries()].map(([date, value]) => ({ date, value }));

  const early = history.slice(0, Math.max(1, Math.min(3, Math.floor(history.length / 3))));
  const recent = history.slice(-Math.max(1, Math.min(3, Math.floor(history.length / 3))));
  const earlyMean = early.reduce((a, b) => a + b.value, 0) / early.length;
  const recentMean = recent.reduce((a, b) => a + b.value, 0) / recent.length;
  const change = Math.round((recentMean - earlyMean) * 100) / 100;

  // Threshold scales with the series' own baseline so a 20m Paraná reach and
  // a 1m tributary gauge both need a proportionally similar move to count as
  // a real trend rather than sensor noise.
  const threshold = Math.max(0.03, Math.abs(earlyMean) * 0.03);
  const trend = change > threshold ? 'rising' : change < -threshold ? 'falling' : 'steady';

  return { history, trend, change, windowDays: TREND_WINDOW_DAYS };
}

// INA's official forecast product — one GeoServer call gets every station it
// covers at once, so we fetch it up front rather than per-station.
async function fetchForecasts() {
  const url = `${GEOSERVER}?service=WFS&version=1.0.0&request=GetFeature&typeName=public2:last_prono_public_by_var&outputFormat=application/json`;
  const raw = await fetchJSON(url);
  const byStation = new Map();
  for (const f of (raw?.features ?? [])) {
    const p = f.properties;
    if (!FORECAST_SITECODES.has(p.estacion_id)) continue;
    if (byStation.has(p.estacion_id)) continue; // one series per station is enough
    let points = [];
    try { points = JSON.parse(p.timeseries); } catch { /* leave empty */ }
    const BAND = { medio: 'central', main: 'central', superior: 'upper', inferior: 'lower' };
    const byDate = new Map();
    for (const [date, value, band] of points) {
      const key = date.slice(0, 10);
      if (!byDate.has(key)) byDate.set(key, {});
      byDate.get(key)[BAND[band] ?? band] = parseFloat(value);
    }
    byStation.set(p.estacion_id, {
      issued: p.fecha_emision,
      tendencia: p.tendencia,
      alert_level_m: p.nivel_de_alerta,
      evacuation_level_m: p.nivel_de_evacuacion,
      low_water_level_m: p.nivel_de_aguas_bajas,
      points: [...byDate.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => new Date(a.date) - new Date(b.date)),
      source: 'INA modelo "tabprono_central" (Pronósticos hidrométricos)',
    });
  }
  return byStation;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

// A few small named tributaries in EXTRA_SITECODES have no `rio` field in the
// catalog at all (true of every RHN-SAT station) and no river-name prefix
// (their name is the place, not the river) — label them explicitly rather
// than falling through to "Unclassified".
const RIVER_OVERRIDE_BY_SITECODE = {
  6659: 'Riacho Salado',
  2854: 'Arroyo Riachuelo',
  6435: 'Piray Guazú',
  6439: 'Piray Miní',
};

function riverLabel(rioCode, catalogRio) {
  const MAP = {
    IGUAZU: 'Iguazú', PARAGUAY: 'Paraguay', PILCOMAYO: 'Pilcomayo', BERMEJO: 'Bermejo',
    PARANAMED: 'Paraná (medio)', PARANAINF: 'Paraná (inferior)', BARRANQUERAS: 'Riacho Barranqueras',
  };
  if (rioCode && MAP[rioCode]) return MAP[rioCode];
  if (catalogRio) return catalogRio; // e.g. "Riachuelo", "Piray Miní" from estaciones.rio
  return null;
}

async function main() {
  console.log('Fetching full INA station catalog…');
  const all = await fetchStationsCatalog();
  const byCode = new Map(all.map(r => [r.sitecode, r]));
  console.log(`  ${all.length} total stations in the national catalog`);

  const satAuto = all.filter(r => r.nombre_red === 'RHN - SAT' && r.automatica);
  const baseCandidates = satAuto.filter(r => {
    if (EXCLUDE_SITECODES.has(r.sitecode)) return false;
    const prefix = norm(r.nombre).split(' - ')[0];
    return RIVERS.includes(prefix);
  });

  const extraCandidates = EXTRA_SITECODES
    .filter(sc => !EXCLUDE_SITECODES.has(sc))
    .map(sc => byCode.get(sc))
    .filter(Boolean);

  const candidates = [...baseCandidates, ...extraCandidates];
  console.log(`  ${baseCandidates.length} from the RHN-SAT river-name filter + ${extraCandidates.length} explicitly requested = ${candidates.length} candidates\n`);

  console.log('Fetching series metadata for each candidate (one call per station)…');
  const withSeries = await mapLimit(candidates, 6, async (s) => {
    const seriesRows = await fetchSeriesFor(s.sitecode);
    const summary = summarizeSeries(seriesRows);
    process.stdout.write(`  [${summary.active ? 'active  ' : 'inactive'}] ${s.nombre} (${Object.keys(summary.byCategory).join(',') || 'no data'})\n`);
    return { station: s, summary };
  });

  const activeOnly = withSeries.filter(w => w.summary.active);
  console.log(`\n${activeOnly.length} of ${withSeries.length} candidates are currently transmitting — dropping the rest (per: don't add non-transmitting stations).\n`);

  console.log('Fetching official INA forecasts (one call covers every station it has)…');
  const forecasts = await fetchForecasts();
  console.log(`  ${forecasts.size} of our stations have an official forecast (INA's model only covers the Paraná/Paraguay mainstem network)\n`);

  console.log('Fetching latest reading value per category, plus a trend history for the primary variable…');
  const verified = await mapLimit(activeOnly, 6, async ({ station, summary }) => {
    const categories = Object.keys(summary.byCategory);
    const values = {};
    for (const cat of categories) {
      const varid = summary.byCategory[cat].varid;
      values[cat] = await fetchLatestValue(station.sitecode, varid);
    }

    const trendCategory = TREND_PRIORITY.find(c => categories.includes(c));
    const trendResult = trendCategory
      ? await fetchTrend(station.sitecode, summary.byCategory[trendCategory].varid)
      : { history: [], trend: null, change: null, windowDays: TREND_WINDOW_DAYS };

    const nameParts = station.nombre.split(' - ');
    const namePrefix = norm(nameParts[0]);
    // Priority: INA's own `rio` tag on the station record (authoritative) >
    // manual override for tributaries with no `rio` field > the RHN-SAT
    // "<River> - <Place>" name-prefix convention used by stations with no
    // `rio` field at all.
    const river = station.rio
      ? riverLabel(station.rio, station.rio)
      : RIVER_OVERRIDE_BY_SITECODE[station.sitecode]
        ?? (RIVERS.includes(namePrefix) ? riverLabel(namePrefix, null) : null);

    return {
      agency: 'INA',
      site_code: station.sitecode,
      name: station.nombre,
      river: river ?? 'Unclassified',
      variables: categories,
      country: station.pais,
      network: station.nombre_red,
      lon: station.lon,
      lat: station.lat,
      status: summary.lastReadingDays <= 14 ? 'ok' : 'stale',
      last_reading_date: summary.lastReadingDate,
      days_since_reading: summary.lastReadingDays,
      level_m: values.level ?? null,
      discharge_m3s: values.discharge ?? null,
      rain_mm: values.rain ?? null,
      temp_c: values.temperature ?? null,
      wind_kmh: values.wind ?? null,
      humidity_pct: values.humidity ?? null,
      trend_variable: trendCategory ?? null,
      trend: trendResult.trend,
      trend_change: trendResult.change,
      trend_window_days: trendResult.windowDays,
      trend_history: trendResult.history,
      forecast: forecasts.get(station.sitecode) ?? null,
    };
  });

  console.log('Fetching MADES (Paraguay) station catalog and daily history…');
  const madesStations = await fetchMadesStations();
  console.log(`  ${madesStations.length} MADES stations currently transmitting\n`);

  // One combined array feeds the single ArcGIS-bound layer — this is the
  // whole point of the exercise: prove every gauge in the basin, regardless
  // of which country's agency runs it, can be fetched into one place.
  const allStations = [...verified, ...madesStations];

  await mkdir(DATA_DIR, { recursive: true });

  const stationsGeoJSON = {
    type: 'FeatureCollection',
    features: allStations.map(v => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
      properties: {
        agency: v.agency,
        site_code: v.site_code,
        name: v.name,
        river: v.river,
        variables: v.variables.join(','),
        variable_labels: v.variables.map(c => CATEGORY_LABEL[c] ?? c).join(', '),
        country: v.country,
        network: v.network,
        status: v.status,
        level_m: v.level_m,
        discharge_m3s: v.discharge_m3s,
        rain_mm: v.rain_mm,
        temp_c: v.temp_c,
        wind_kmh: v.wind_kmh,
        humidity_pct: v.humidity_pct,
        last_reading_date: v.last_reading_date,
        days_since_reading: v.days_since_reading,
        trend_variable: v.trend_variable,
        trend: v.trend,
        trend_change: v.trend_change,
        trend_window_days: v.trend_window_days,
        // Arrays kept as JSON strings so the layer stays flat for ArcGIS.
        trend_history: JSON.stringify(v.trend_history),
        has_forecast: v.forecast != null,
        forecast: v.forecast ? JSON.stringify(v.forecast) : null,
        // MADES-only reference thresholds (null for INA stations, which
        // carry their own alert/evacuation levels inside `forecast` instead
        // — the two agencies don't share a threshold scale/semantics).
        alert_level_m: v.alert_level_m ?? null,
        critical_level_m: v.critical_level_m ?? null,
        disaster_level_m: v.disaster_level_m ?? null,
      },
    })),
  };

  // ── Condición Hídrica reach layer ────────────────────────────────────────
  console.log('\nFetching Condición Hídrica reach layer…');
  const tramosURL = `${GEOSERVER}?service=WFS&version=1.0.0&request=GetFeature&typeName=public2:tramos_condicion_params&outputFormat=application/json`;
  const tramosRaw = await fetchJSON(tramosURL);
  // Note: the feature's top-level `geometry` is just a representative point —
  // the actual reach line lives in the `geom_tramo` property.
  const tramosByReach = new Map();
  for (const f of (tramosRaw?.features ?? [])) {
    const p = f.properties;
    if (!TARGET_REACHES.has(p.nombre)) continue;
    if (!tramosByReach.has(p.nombre)) tramosByReach.set(p.nombre, { geometry: p.geom_tramo, entries: [] });
    tramosByReach.get(p.nombre).entries.push(p);
  }

  const tramosGeoJSON = {
    type: 'FeatureCollection',
    features: [...tramosByReach.entries()].map(([nombre, { geometry, entries }]) => {
      // Prefer the level (var_id 2) entry for the reach's color classification;
      // fall back to discharge (var_id 4) if level has no condición computed.
      const level = entries.find(e => e.var_id === 2);
      const discharge = entries.find(e => e.var_id === 4);
      const primary = (level && level.condicion) ? level : (discharge && discharge.condicion) ? discharge : (level ?? discharge);

      return {
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates: geometry.coordinates },
        properties: {
          reach: nombre,
          river: riverLabel(primary.rio, primary.rio),
          condicion: primary.condicion,
          percentil: primary.percentil,
          color: CONDICION_COLOR[primary.condicion] ?? '#999999',
          tendencia: primary.tendencia,
          level_m: level?.valor ?? null,
          level_condicion: level?.condicion ?? null,
          discharge_m3s: discharge?.valor ?? null,
          discharge_condicion: discharge?.condicion ?? null,
          fecha: primary.fecha,
        },
      };
    }),
  };

  const byRiver = {};
  const byVariable = {};
  const byTrend = {};
  const byAgency = {};
  for (const v of allStations) {
    byRiver[v.river] = (byRiver[v.river] ?? 0) + 1;
    for (const cat of v.variables) byVariable[cat] = (byVariable[cat] ?? 0) + 1;
    if (v.trend) byTrend[v.trend] = (byTrend[v.trend] ?? 0) + 1;
    byAgency[v.agency] = (byAgency[v.agency] ?? 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    totalStations: allStations.length,
    droppedNotTransmitting: (withSeries.length - activeOnly.length),
    byRiver,
    byVariable,
    byTrend,
    byAgency,
    stationsWithForecast: allStations.filter(v => v.forecast).map(v => v.name),
    reachesFound: [...tramosByReach.keys()],
    stations: allStations,
  };

  await writeFile(join(DATA_DIR, 'stations.geojson'), JSON.stringify(stationsGeoJSON, null, 2));
  await writeFile(join(DATA_DIR, 'tramos.geojson'), JSON.stringify(tramosGeoJSON, null, 2));
  await writeFile(join(DATA_DIR, 'report.json'), JSON.stringify(report, null, 2));

  console.log('\n── Summary ──────────────────────────────');
  console.log(`Total transmitting stations: ${allStations.length} (dropped ${report.droppedNotTransmitting} INA candidates not transmitting)`);
  console.log('By agency:', byAgency);
  console.log('By river:', byRiver);
  console.log('By variable:', byVariable);
  console.log('By trend:', byTrend);
  console.log(`Stations with an official forecast: ${report.stationsWithForecast.join(', ') || 'none'}`);
  console.log(`Reaches: ${report.reachesFound.length} / ${TARGET_REACHES.size} target reaches found`);
  console.log(`\nWritten: public/data/stations.geojson, public/data/tramos.geojson, public/data/report.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
