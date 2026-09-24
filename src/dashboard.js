import {
  RIVER_COLOR, RIVER_ORDER, TREND_LABEL, TREND_ARROW, TREND_COLOR,
  VARIABLE_LABEL, VARIABLE_UNIT, AGENCY_LABEL,
} from './shared.js';

const NETWORK_SOURCE_NOTE = {
  'RHN - SAT': 'RHN-SAT — automatic telemetry, INA/SSRH, hourly cadence',
  'escalas Prefectura Nacional': 'Prefectura Naval Argentina river-scale readings, INA SIyAH, ~daily cadence',
  // MADES network strings are already descriptive (built per-station from
  // its own data_owner) — no lookup needed, they pass through as-is.
};

let cachedData = null;

export function renderDashboard(container, data) {
  cachedData = data;
  const stations = data.stations.features.map(f => parseStation(f.properties, f.geometry));
  const reaches = data.tramos.features.map(f => f.properties);
  const byRiver = groupByRiver(stations);

  const generatedAt = data.report.generatedAt ? new Date(data.report.generatedAt) : null;

  container.innerHTML = `
    <div class="dash-header">
      <h1>River Dashboards</h1>
      <p class="dash-sub">Trend and forecast reading for every gauge in the Paraná basin corridor — INA (Argentina) and MADES (Paraguay) stations together.</p>
      ${overallSummaryHTML(stations, generatedAt)}
    </div>
    <div class="dash-grid">
      ${RIVER_ORDER.filter(r => byRiver.has(r)).map(r => riverCardHTML(r, byRiver.get(r), reaches)).join('')}
    </div>
    <div class="dash-sources">
      <h2>Where this comes from</h2>
      <p>Two national agencies feed this basin-wide layer. <strong>INA</strong> (Instituto Nacional del Agua,
      Argentina) via its public SIyAH API (<code>alerta.ina.gob.ar</code>) — two networks:
      <strong>RHN-SAT</strong>, automatic sensors reporting roughly hourly, and <strong>escalas Prefectura
      Nacional</strong>, river-scale gauges read and published by the Argentine Coast Guard, roughly daily.
      <strong>MADES</strong> (Ministerio del Ambiente y Desarrollo Sostenible, Paraguay) via its SIAGUAPY
      system (<code>siaguapy.mades.gov.py</code>) — manual readings from the Armada Nacional/DINAC and a
      handful of automatic sensors, reporting daily. MADES also monitors a few gauges physically in
      Bolivia, Argentina and Brazil as part of regional basin-sharing agreements — their <code>country</code>
      field reflects where the gauge actually sits, not who reads it.</p>
      <p><strong>Trend</strong> (rising / falling / steady) is computed here, not supplied by either agency:
      for each station we compare the average of its most recent ~3 readings against the average of its
      earliest ~3 readings in a ${stations[0]?.trend_window_days ?? 21}-day window, using a threshold scaled
      to that station's own typical range so small sensor noise doesn't register as a trend.</p>
      <p><strong>Forecast</strong> ("when to expect this") is INA's own official model output
      (<code>tabprono_central</code>) where available — a real dated projection with upper/central/lower
      bands, re-issued every few days. It currently only covers the Paraná/Paraguay mainstem navigation
      network, so it's shown for Corrientes, Barranqueras, Puerto Pilcomayo and Puerto Formosa only. MADES
      doesn't publish an equivalent forecast product. No forecast exists for any other station — those cards
      say so rather than guessing.</p>
      <p class="dash-snapshot">This is a snapshot, not a live feed. Data as of
      ${generatedAt ? generatedAt.toLocaleString() : 'unknown'} — run <code>npm run fetch:stations</code> to refresh.</p>
    </div>
  `;
}

function parseStation(p, geometry) {
  return {
    ...p,
    lon: geometry?.coordinates?.[0] ?? null,
    lat: geometry?.coordinates?.[1] ?? null,
    trend_history: safeParse(p.trend_history, []),
    forecast: p.has_forecast ? safeParse(p.forecast, null) : null,
  };
}

function safeParse(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function groupByRiver(stations) {
  const map = new Map();
  for (const s of stations) {
    if (!map.has(s.river)) map.set(s.river, []);
    map.get(s.river).push(s);
  }
  return map;
}

function overallSummaryHTML(stations, generatedAt) {
  const counts = { rising: 0, falling: 0, steady: 0, unknown: 0 };
  for (const s of stations) counts[s.trend ?? 'unknown']++;
  const withForecast = stations.filter(s => s.forecast).length;
  const byAgency = {};
  for (const s of stations) byAgency[s.agency] = (byAgency[s.agency] ?? 0) + 1;

  return `
    <div class="dash-summary">
      <div class="dash-stat"><span class="dash-stat-num">${stations.length}</span><span>stations (${Object.entries(byAgency).map(([a, n]) => `${n} ${a}`).join(' · ')})</span></div>
      <div class="dash-stat"><span class="dash-stat-num" style="color:${TREND_COLOR.rising}">${counts.rising}</span><span>rising</span></div>
      <div class="dash-stat"><span class="dash-stat-num" style="color:${TREND_COLOR.falling}">${counts.falling}</span><span>falling</span></div>
      <div class="dash-stat"><span class="dash-stat-num" style="color:${TREND_COLOR.steady}">${counts.steady}</span><span>steady</span></div>
      <div class="dash-stat"><span class="dash-stat-num">${withForecast}</span><span>with official forecast</span></div>
      ${generatedAt ? `<div class="dash-stat dash-stat-time"><span>updated</span><span>${generatedAt.toLocaleString()}</span></div>` : ''}
    </div>
  `;
}

function riverCardHTML(river, stationsInRiver, reaches) {
  const color = RIVER_COLOR[river] ?? '#DED8CF';
  const counts = { rising: 0, falling: 0, steady: 0 };
  for (const s of stationsInRiver) if (s.trend) counts[s.trend]++;

  const headline = pickHeadlineTrend(counts);
  const matchingReaches = reaches.filter(r => r.river === river);
  const forecastStations = stationsInRiver.filter(s => s.forecast);
  const networks = [...new Set(stationsInRiver.map(s => s.network))];

  return `
    <div class="river-card" style="border-top: 3px solid ${color}">
      <div class="river-card-head">
        <h3>${river}</h3>
        <span class="river-card-count">${stationsInRiver.length} station${stationsInRiver.length === 1 ? '' : 's'}</span>
      </div>

      ${headlineHTML(headline, counts)}
      ${miniMapHTML(stationsInRiver, matchingReaches)}
      ${matchingReaches.map(reachSummaryHTML).join('')}

      <div class="river-card-stations">
        ${stationsInRiver.map(stationRowHTML).join('')}
      </div>

      ${forecastStations.length ? forecastSectionHTML(forecastStations) : noForecastHTML(river)}

      <div class="river-card-source">
        Source: ${networks.map(n => NETWORK_SOURCE_NOTE[n] ?? n).join(' · ')}
      </div>
    </div>
  `;
}

function pickHeadlineTrend(counts) {
  const entries = Object.entries(counts);
  const max = Math.max(...entries.map(([, v]) => v));
  if (max === 0) return null;
  const leaders = entries.filter(([, v]) => v === max).map(([k]) => k);
  return leaders.length === 1 ? leaders[0] : 'mixed';
}

function headlineHTML(headline, counts) {
  if (!headline) return `<p class="river-card-headline dim">No trend data yet</p>`;
  if (headline === 'mixed') {
    return `<p class="river-card-headline dim">Mixed — ${counts.rising} rising, ${counts.falling} falling, ${counts.steady} steady</p>`;
  }
  return `
    <p class="river-card-headline" style="color:${TREND_COLOR[headline]}">
      ${TREND_ARROW[headline]} ${TREND_LABEL[headline]}
      <span class="dim"> — ${counts.rising} rising, ${counts.falling} falling, ${counts.steady} steady</span>
    </p>
  `;
}

// A lightweight, dependency-free "zoomed to this river" plot — real lon/lat
// positions linearly projected into a small SVG box, no basemap tiles.
// Spinning up a dozen full MapLibre instances (one per river card) would mean
// a dozen concurrent WebGL contexts and vector-tile fetches just for this
// dashboard tab; this stays consistent with the sparkline/forecast charts
// elsewhere on this page (hand-rolled SVG, no chart library) and costs
// nothing to render.
function miniMapHTML(stationsInRiver) {
  const pts = stationsInRiver.filter(s => s.lon != null && s.lat != null);
  if (!pts.length) return '';

  const w = 300, h = 170, pad = 24;
  const minLon0 = Math.min(...pts.map(p => p.lon));
  const maxLon0 = Math.max(...pts.map(p => p.lon));
  const minLat0 = Math.min(...pts.map(p => p.lat));
  const maxLat0 = Math.max(...pts.map(p => p.lat));
  const lonMid = (minLon0 + maxLon0) / 2;
  const latMid = (minLat0 + maxLat0) / 2;

  // Floor the span so a single station (or a tight cluster) doesn't zoom to
  // nothing, and pad by 25% so markers never sit flush against the edge.
  const MIN_SPAN_DEG = 0.15;
  const lonSpan = Math.max((maxLon0 - minLon0) * 1.25, MIN_SPAN_DEG);
  const latSpan = Math.max((maxLat0 - minLat0) * 1.25, MIN_SPAN_DEG);
  const minLon = lonMid - lonSpan / 2, maxLon = lonMid + lonSpan / 2;
  const minLat = latMid - latSpan / 2, maxLat = latMid + latSpan / 2;

  const x = (lon) => pad + ((lon - minLon) / (maxLon - minLon)) * (w - 2 * pad);
  // lat increases north; SVG y increases downward, so flip.
  const y = (lat) => pad + (1 - (lat - minLat) / (maxLat - minLat)) * (h - 2 * pad);

  const markers = pts.map(p => minimapMarkerSVG(x(p.lon), y(p.lat), p)).join('');

  return `
    <div class="minimap-wrap">
      <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="minimap" preserveAspectRatio="xMidYMid meet">
        <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" class="minimap-bg" rx="8" />
        ${markers}
      </svg>
      <div class="minimap-legend">
        <span style="color:${TREND_COLOR.rising}">▲ Rising</span>
        <span style="color:${TREND_COLOR.falling}">▼ Falling</span>
        <span style="color:${TREND_COLOR.steady}">● Steady</span>
      </div>
    </div>
  `;
}

function minimapMarkerSVG(cx, cy, s) {
  const color = TREND_COLOR[s.trend] ?? '#94a3b8';
  const cxr = cx.toFixed(1), cyr = cy.toFixed(1);
  const title = `${s.name} — ${TREND_LABEL[s.trend] ?? 'no trend data'}${s.level_m != null ? ` — ${s.level_m} m` : ''}`;

  let shape;
  if (s.trend === 'rising') {
    shape = `<path d="M ${cxr} ${(cy - 5).toFixed(1)} L ${(cx - 4.5).toFixed(1)} ${(cy + 4).toFixed(1)} L ${(cx + 4.5).toFixed(1)} ${(cy + 4).toFixed(1)} Z" fill="${color}" />`;
  } else if (s.trend === 'falling') {
    shape = `<path d="M ${cxr} ${(cy + 5).toFixed(1)} L ${(cx - 4.5).toFixed(1)} ${(cy - 4).toFixed(1)} L ${(cx + 4.5).toFixed(1)} ${(cy - 4).toFixed(1)} Z" fill="${color}" />`;
  } else {
    shape = `<circle cx="${cxr}" cy="${cyr}" r="3.6" fill="${color}" />`;
  }

  return `
    <g class="minimap-marker">
      <circle cx="${cxr}" cy="${cyr}" r="7.5" fill="rgba(255,255,255,0.92)" />
      ${shape}
      <title>${title}</title>
    </g>
  `;
}

function reachSummaryHTML(r) {
  return `
    <div class="reach-summary">
      <span class="reach-name">${r.reach}</span>
      <span class="reach-condicion" style="color:${r.color}">${r.condicion ?? '—'}</span>
      <span class="dim">· INA Condición Hídrica, trend: ${{ crece: 'rising', baja: 'falling', permanece: 'steady' }[r.tendencia] ?? r.tendencia}</span>
    </div>
  `;
}

function stationRowHTML(s) {
  const primary = primaryValueHTML(s);
  return `
    <div class="station-row">
      <div class="station-row-main">
        <span class="station-row-name">${s.name} <span class="agency-tag">${s.agency} · ${s.country}</span></span>
        <span class="station-row-trend" style="color:${TREND_COLOR[s.trend] ?? '#94a3b8'}">
          ${s.trend ? `${TREND_ARROW[s.trend]} ${TREND_LABEL[s.trend]}` : '—'}
        </span>
      </div>
      <div class="station-row-detail">
        ${sparklineSVG(s.trend_history, s.trend)}
        <span class="dim">${primary}</span>
      </div>
    </div>
  `;
}

function primaryValueHTML(s) {
  const cat = s.trend_variable;
  if (!cat) return 'no current value';
  const key = { level: 'level_m', discharge: 'discharge_m3s', rain: 'rain_mm', temperature: 'temp_c', humidity: 'humidity_pct', wind: 'wind_kmh' }[cat];
  const val = s[key];
  const unit = VARIABLE_UNIT[cat] ?? '';
  const changeStr = s.trend_change != null ? ` (${s.trend_change > 0 ? '+' : ''}${s.trend_change}${unit} / ${s.trend_window_days}d)` : '';
  return val != null ? `${VARIABLE_LABEL[cat]}: ${val}${unit}${changeStr}` : `${VARIABLE_LABEL[cat]}: —`;
}

function sparklineSVG(history, trend) {
  if (!history || history.length < 2) return `<svg width="70" height="24" class="sparkline"></svg>`;
  const w = 70, h = 24, pad = 2;
  const values = history.map(p => p.value);
  const min = Math.min(...values), max = Math.max(...values);
  const range = (max - min) || 1;
  const points = history.map((p, i) => {
    const x = pad + (i / (history.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((p.value - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = TREND_COLOR[trend] ?? '#94a3b8';
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="sparkline">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function forecastSectionHTML(forecastStations) {
  return `
    <div class="forecast-section">
      <div class="forecast-title">When to expect this — official INA forecast</div>
      ${forecastStations.map(s => forecastCardHTML(s)).join('')}
    </div>
  `;
}

function forecastCardHTML(s) {
  const f = s.forecast;
  const issued = f.issued ? new Date(f.issued) : null;
  const last = f.points[f.points.length - 1];
  const tendenciaLabel = { crece: 'Rising', baja: 'Falling', permanece: 'Steady' }[f.tendencia] ?? f.tendencia;

  return `
    <div class="forecast-card">
      <div class="forecast-card-head">
        <span class="forecast-station-name">${s.name}</span>
        <span class="dim">issued ${issued ? issued.toLocaleDateString() : '—'}</span>
      </div>
      ${forecastChartSVG(f)}
      <p class="forecast-readout">
        ${tendenciaLabel} — by ${last.date.slice(5)}: <strong>${last.central ?? '—'} m</strong>
        ${last.lower != null && last.upper != null ? `<span class="dim">(${last.lower}–${last.upper} m range)</span>` : ''}
      </p>
      <p class="dim forecast-thresholds">
        INA reference levels for this gauge — alert: ${f.alert_level_m ?? '—'} m ·
        evacuation: ${f.evacuation_level_m ?? '—'} m · low water: ${f.low_water_level_m ?? '—'} m
      </p>
    </div>
  `;
}

function forecastChartSVG(forecast) {
  const pts = forecast.points;
  if (!pts || pts.length < 2) return '';
  const w = 260, h = 90, padL = 4, padR = 4, padT = 8, padB = 16;
  const allVals = pts.flatMap(p => [p.central, p.upper, p.lower].filter(v => v != null));
  const min = Math.min(...allVals), max = Math.max(...allVals);
  const span = (max - min) || 1;
  const x = i => padL + (i / (pts.length - 1)) * (w - padL - padR);
  const y = v => padT + (1 - (v - min) / span) * (h - padT - padB);

  const centralPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.central).toFixed(1)}`).join(' ');
  const upperSide = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.upper).toFixed(1)}`).join(' ');
  const lowerSide = pts.slice().reverse().map((p, i) => `L${x(pts.length - 1 - i).toFixed(1)},${y(p.lower).toFixed(1)}`).join(' ');

  const firstDate = pts[0].date.slice(5);
  const lastDate = pts[pts.length - 1].date.slice(5);

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="forecast-chart">
    <path d="${upperSide} ${lowerSide} Z" fill="#60a5fa" opacity="0.18" stroke="none"/>
    <path d="${centralPath}" fill="none" stroke="#60a5fa" stroke-width="2"/>
    <text x="${padL}" y="${h - 2}" font-size="9" fill="#9aa0a8">${firstDate}</text>
    <text x="${w - padR}" y="${h - 2}" font-size="9" fill="#9aa0a8" text-anchor="end">${lastDate}</text>
  </svg>`;
}

function noForecastHTML(river) {
  return `<p class="no-forecast">No official forecast (INA or MADES) covers ${river} yet — trend above is the observed direction only.</p>`;
}
