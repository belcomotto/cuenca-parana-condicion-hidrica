// MADES Paraguay (Ministerio del Ambiente y Desarrollo Sostenible) — SIAGUAPY
// telemetry stations. A specific 14-station subset of MADES's full ~36-station
// Paraguay/Paraná/Pilcomayo catalog was requested (see TARGET_SITE_IDS below)
// — including a few cross-border gauges MADES monitors in Bolivia, Argentina
// and Brazil under regional basin agreements.
//
// Source: https://siaguapy.mades.gov.py/monitoreo-cuencas-y-acuiferos/mapa
//   - The station catalog (id, name, coordinates, basin group, data owner,
//     manual/automatic) is embedded directly in that page's HTML as a
//     `const stations = [...]` array (a Laravel-rendered map, not a JSON API)
//     — extracted below by locating and bracket-matching that literal.
//   - Each station's full daily history is at
//     GET /historico-datos/{id}/data → { series_data: [[epoch_ms, value], ...] },
//     found by loading a station detail page and watching its network
//     requests (that page URL itself isn't documented/stable, so we don't
//     depend on it beyond having found the /data endpoint).

import { fetchJSON, mapLimit, daysSince, classifyTrend } from './util.mjs';

const MAP_PAGE = 'https://siaguapy.mades.gov.py/monitoreo-cuencas-y-acuiferos/mapa';
const DATA_URL = (id) => `https://siaguapy.mades.gov.py/historico-datos/${id}/data`;

// The 14 stations explicitly requested — MADES's full catalog has 36 across
// these three basin groups (plus Tebicuary/Negro/Yhaguy and groundwater
// wells, out of scope entirely), but only this set was asked for.
const TARGET_SITE_IDS = new Set([
  45, // Villa Montes (Pilcomayo)
  44, // Misión La Paz DE CTN (Pilcomayo)
  29, // Pozo Hondo (Pilcomayo)
  1,  // Puerto Ladario - Brasil (Paraguay)
  6,  // Bahía Negra (Paraguay)
  5,  // Fuerte Olimpo (Paraguay)
  4,  // Isla Margarita (Paraguay)
  7,  // Vallemí (Paraguay)
  8,  // Concepción (Paraguay)
  10, // Puerto Antequera (Paraguay)
  9,  // Rosario (Paraguay)
  11, // Villeta (Paraguay)
  18, // Salto del Guairá (Paraná)
  19, // Ciudad del Este (Paraná)
]);
const GROUP_TO_RIVER = {
  'Río Paraguay': 'Paraguay',
  'Río Pilcomayo': 'Pilcomayo',
  // MADES's own "Río Paraná" group spans the whole Paraguayan reach (Salto
  // del Guairá down to the Argentina confluence near Paso de la Patria) —
  // a different segmentation than INA's Condición Hídrica reach names, so
  // it gets its own label rather than being force-fit into "medio"/"inferior".
  'Río Paraná': 'Paraná (Paraguay)',
};

const ACTIVE_WINDOW_DAYS = 30;
const TREND_WINDOW_DAYS = 21;

function ownerNetwork(dataOwner, method) {
  if (dataOwner.includes('Trinacional')) return `MADES SIAGUAPY — Comisión Trinacional del Pilcomayo (${method})`;
  if (dataOwner === 'DMH-DINAC') return `MADES SIAGUAPY — DINAC (${method})`;
  return `MADES SIAGUAPY — Armada Nacional/ANNP/DMH-DINAC (${method})`;
}

function guessCountry(name) {
  if (name.includes('Brasil')) return 'Brasil';
  if (name === 'Villa Montes') return 'Bolivia';
  if (name === 'Misión La Paz DE CTN' || name === 'Pozo Hondo') return 'Argentina';
  return 'Paraguay';
}

// The station catalog is a literal JS array embedded in the page's HTML,
// not a JSON endpoint — extract it by finding `const stations = [` and
// bracket-matching to its close (respecting quoted strings).
function extractStationsArray(html) {
  const marker = 'const stations = [';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('MADES: could not find embedded station array — page structure may have changed');
  const arrStart = html.indexOf('[', start);
  let depth = 0, inStr = false, esc = false, i = arrStart;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) { i++; break; } }
    }
  }
  return JSON.parse(html.slice(arrStart, i));
}

async function fetchCatalog() {
  const res = await fetch(MAP_PAGE, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`MADES: catalog page returned ${res.status}`);
  const html = await res.text();
  return extractStationsArray(html);
}

export async function fetchMadesStations() {
  const catalog = await fetchCatalog();
  const candidates = catalog.filter(s => TARGET_SITE_IDS.has(s.id));

  const results = await mapLimit(candidates, 6, async (s) => {
    const raw = await fetchJSON(DATA_URL(s.id));
    const seriesData = raw?.series_data ?? [];
    const history = seriesData
      .map(([ms, value]) => ({ date: new Date(ms).toISOString().slice(0, 10), value: parseFloat(value) }))
      .filter(p => !isNaN(p.value))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const last = history[history.length - 1] ?? null;
    const lastReadingDays = last ? daysSince(last.date) : null;
    const active = lastReadingDays != null && lastReadingDays <= ACTIVE_WINDOW_DAYS;

    process.stdout.write(`  [${active ? 'active  ' : 'inactive'}] ${s.name} (${s.group}, ${s.measurement_method})\n`);
    if (!active) return null;

    const trendResult = classifyTrend(history.slice(-TREND_WINDOW_DAYS), TREND_WINDOW_DAYS);

    return {
      agency: 'MADES',
      site_code: s.id,
      name: s.name,
      river: GROUP_TO_RIVER[s.group],
      variables: ['level'],
      country: guessCountry(s.name),
      network: ownerNetwork(s.data_owner, s.measurement_method),
      lon: s.longitude,
      lat: s.latitude,
      status: lastReadingDays <= 14 ? 'ok' : 'stale',
      last_reading_date: last?.date ?? null,
      days_since_reading: lastReadingDays,
      level_m: last?.value ?? null,
      discharge_m3s: null,
      rain_mm: null,
      temp_c: null,
      wind_kmh: null,
      humidity_pct: null,
      trend_variable: 'level',
      trend: trendResult.trend,
      trend_change: trendResult.change,
      trend_window_days: trendResult.windowDays,
      trend_history: trendResult.history,
      forecast: null, // MADES doesn't publish an official forecast product (unlike INA's tabprono_central)
      alert_level_m: s.alert ?? null,
      critical_level_m: s.critical ?? null,
      disaster_level_m: s.disaster ?? null,
    };
  });

  return results.filter(Boolean);
}
