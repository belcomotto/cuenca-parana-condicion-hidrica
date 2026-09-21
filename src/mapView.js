import { Map, NavigationControl, ScaleControl, Popup, LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  RIVER_COLOR, RIVER_FALLBACK_COLOR, RIVER_ORDER,
  VARIABLE_LABEL, VARIABLE_ORDER, STATUS_LABEL,
  CONDICION_LABEL, CONDICION_ORDER, CONDICION_COLOR,
} from './shared.js';

let map;
let allFeatures = [];
let tramosGeoJSON = null;
const activeRivers = new Set();
const activeVariables = new Set(VARIABLE_ORDER);

export function initMap({ stations, tramos }) {
  allFeatures = stations.features;
  tramosGeoJSON = tramos;

  for (const f of allFeatures) activeRivers.add(f.properties.river);

  renderStats(allFeatures);
  renderVariableFilter(allFeatures);
  renderRiverFilter(allFeatures);
  renderTramosLegend();

  const bounds = new LngLatBounds();
  for (const f of allFeatures) bounds.extend(f.geometry.coordinates);
  for (const f of tramosGeoJSON.features) {
    for (const line of f.geometry.coordinates) for (const pt of line) bounds.extend(pt);
  }

  map = new Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    bounds,
    fitBoundsOptions: { padding: 60 },
  });

  map.addControl(new NavigationControl(), 'top-right');
  map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');

  map.on('load', () => {
    // ── Condición Hídrica reaches (lines) — added first so points draw on top ──
    map.addSource('tramos', { type: 'geojson', data: tramosGeoJSON });
    map.addLayer({
      id: 'tramos-line',
      type: 'line',
      source: 'tramos',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 4,
        'line-opacity': 0.85,
      },
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    });

    map.on('mouseenter', 'tramos-line', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'tramos-line', () => { map.getCanvas().style.cursor = ''; });

    // ── Stations (points) ──────────────────────────────────────────────────
    map.addSource('stations', { type: 'geojson', data: filteredGeoJSON() });

    map.addLayer({
      id: 'station-halo',
      type: 'circle',
      source: 'stations',
      paint: {
        'circle-radius': 14,
        'circle-color': ['match', ['get', 'status'], 'ok', '#22c55e', 'stale', '#f0a500', '#6b7280'],
        'circle-opacity': 0.22,
      },
    });

    map.addLayer({
      id: 'station-dot',
      type: 'circle',
      source: 'stations',
      paint: {
        'circle-radius': 6.5,
        'circle-color': [
          'match', ['get', 'river'],
          ...Object.entries(RIVER_COLOR).flat(),
          RIVER_FALLBACK_COLOR,
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });

    map.on('mouseenter', 'station-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'station-dot', () => { map.getCanvas().style.cursor = ''; });

    // Single click handler covering both layers, station points take priority
    // over reach lines when they overlap (stations render on top).
    let openPopup = null;
    map.on('click', (e) => {
      const stationHits = map.queryRenderedFeatures(e.point, { layers: ['station-dot'] });
      const tramoHits = stationHits.length ? [] : map.queryRenderedFeatures(e.point, { layers: ['tramos-line'] });
      if (!stationHits.length && !tramoHits.length) return;

      openPopup?.remove();
      const html = stationHits.length ? stationPopupHTML(stationHits[0].properties) : tramoPopupHTML(tramoHits[0].properties);
      openPopup = new Popup({ closeButton: false, maxWidth: '280px' })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(map);
    });
  });

  document.getElementById('tramos-toggle').addEventListener('change', (e) => {
    if (!map.getLayer('tramos-line')) return;
    map.setLayoutProperty('tramos-line', 'visibility', e.target.checked ? 'visible' : 'none');
  });

  return map;
}

// MapLibre needs a resize nudge after being unhidden (display:none prevents
// it from ever knowing its real container size while a tab is inactive).
export function resizeMap() {
  map?.resize();
}

function stationPopupHTML(p) {
  const statusColor = p.status === 'ok' ? '#22c55e' : '#f0a500';
  const rows = [
    p.level_m       != null ? `Level: <strong>${p.level_m} m</strong>` : null,
    p.discharge_m3s != null ? `Discharge: <strong>${p.discharge_m3s} m³/s</strong>` : null,
    p.rain_mm       != null ? `Rain: <strong>${p.rain_mm} mm</strong>` : null,
    p.temp_c        != null ? `Temp: <strong>${p.temp_c}°C</strong>` : null,
    p.wind_kmh      != null ? `Wind: <strong>${p.wind_kmh} km/h</strong>` : null,
    p.humidity_pct  != null ? `Humidity: <strong>${p.humidity_pct}%</strong>` : null,
  ].filter(Boolean).join('<br/>') || 'No current value';

  const readingTime = p.last_reading_date ? String(p.last_reading_date).slice(0, 16).replace('T', ' ') : '—';

  return `
    <div class="popup">
      <p class="popup-title">${p.name}</p>
      <p class="popup-sub">${p.river} · siteCode ${p.site_code}</p>
      <p class="popup-status" style="color:${statusColor}">● ${STATUS_LABEL[p.status] ?? p.status}</p>
      <div class="popup-body">
        <p>${rows}</p>
        <p class="popup-meta">${p.variable_labels}</p>
        <p class="popup-meta">Last reading: ${readingTime}</p>
        <p class="popup-meta">${p.network}</p>
      </div>
    </div>
  `;
}

function tramoPopupHTML(p) {
  const color = p.color ?? '#999';
  const level = p.level_m != null ? `Level: <strong>${p.level_m} m</strong>${p.level_condicion ? ` (${CONDICION_LABEL[p.level_condicion] ?? p.level_condicion})` : ''}` : null;
  const discharge = p.discharge_m3s != null ? `Discharge: <strong>${Math.round(p.discharge_m3s)} m³/s</strong>${p.discharge_condicion ? ` (${CONDICION_LABEL[p.discharge_condicion] ?? p.discharge_condicion})` : ''}` : null;
  const trend = { crece: 'Rising', baja: 'Falling', permanece: 'Steady' }[p.tendencia] ?? p.tendencia;

  return `
    <div class="popup">
      <p class="popup-title">${p.reach}</p>
      <p class="popup-sub">${p.river ?? ''}</p>
      <p class="popup-status" style="color:${color}">● ${CONDICION_LABEL[p.condicion] ?? p.condicion ?? '—'}</p>
      <div class="popup-body">
        <p>${[level, discharge].filter(Boolean).join('<br/>') || 'No classification available'}</p>
        <p class="popup-meta">Trend: ${trend ?? '—'}</p>
        <p class="popup-meta">${p.fecha ? String(p.fecha).slice(0, 10) : ''}</p>
        <p class="popup-meta">INA "Condición Hídrica" — percentile vs. historical record</p>
      </div>
    </div>
  `;
}

function filteredGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: allFeatures.filter(f => {
      if (!activeRivers.has(f.properties.river)) return false;
      const vars = f.properties.variables.split(',');
      return vars.some(v => activeVariables.has(v));
    }),
  };
}

function applyFilter() {
  map?.getSource('stations')?.setData(filteredGeoJSON());
}

function renderStats(features) {
  const byStatus = {};
  for (const f of features) {
    const s = f.properties.status;
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  const el = document.getElementById('stats');
  el.innerHTML = `
    <div class="stat-big">${features.length}</div>
    <div class="stat-label">transmitting stations</div>
    <div class="stat-breakdown">
      ${Object.entries(byStatus).map(([k, v]) => `<span>${v} ${STATUS_LABEL[k] ?? k}</span>`).join('')}
    </div>
  `;
}

function renderVariableFilter(features) {
  const counts = {};
  for (const f of features) {
    for (const v of f.properties.variables.split(',')) counts[v] = (counts[v] ?? 0) + 1;
  }
  const present = VARIABLE_ORDER.filter(v => counts[v]);
  const el = document.getElementById('variable-filter');
  el.innerHTML = `<div class="legend-title">Variable</div>` + present.map(v => `
    <label class="river-row">
      <input type="checkbox" checked data-variable="${v}" />
      ${VARIABLE_LABEL[v] ?? v} <span class="count">(${counts[v]})</span>
    </label>
  `).join('');

  el.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const v = cb.dataset.variable;
      cb.checked ? activeVariables.add(v) : activeVariables.delete(v);
      applyFilter();
    });
  });
}

function renderRiverFilter(features) {
  const counts = {};
  for (const f of features) {
    const r = f.properties.river;
    counts[r] = (counts[r] ?? 0) + 1;
  }
  const present = RIVER_ORDER.filter(r => counts[r]);
  const el = document.getElementById('river-filter');
  el.innerHTML = `<div class="legend-title">River</div>` + present.map(river => `
    <label class="river-row">
      <input type="checkbox" checked data-river="${river}" />
      <span class="dot" style="background:${RIVER_COLOR[river] ?? RIVER_FALLBACK_COLOR}"></span>
      ${river} <span class="count">(${counts[river] ?? 0})</span>
    </label>
  `).join('');

  el.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const river = cb.dataset.river;
      cb.checked ? activeRivers.add(river) : activeRivers.delete(river);
      applyFilter();
    });
  });
}

function renderTramosLegend() {
  const el = document.getElementById('tramos-legend');
  el.innerHTML = CONDICION_ORDER.map(c => `
    <div class="legend-row"><span class="dot" style="background:${CONDICION_COLOR[c]}"></span> ${CONDICION_LABEL[c]}</div>
  `).join('');
}
