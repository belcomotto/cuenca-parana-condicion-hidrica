// Colors are keyed by RIVER, not by agency — an INA-run gauge and a
// MADES-run gauge on the same river (e.g. "Paraguay") share a color, since
// they're literally the same river. The `agency` property (INA / MADES) is
// what distinguishes source, shown separately in popups and the dashboard.
export const RIVER_COLOR = {
  'Bermejo':             '#4db8ff',
  'Pilcomayo':           '#f0a500',
  'Iguazú':              '#22c55e',
  'Paraguay':            '#c084fc',
  'Paraná (medio)':      '#ef4444',
  'Paraná (inferior)':   '#fb7185',
  'Riacho Barranqueras': '#94a3b8',
  'Arroyo Riachuelo':    '#2dd4bf',
  'Piray Guazú':         '#eab308',
  'Piray Miní':          '#f97316',
  'Riacho Salado':       '#a3e635',
};
export const RIVER_FALLBACK_COLOR = '#DED8CF';

// Order the four "headline" rivers first, then the extra corridor stations.
export const RIVER_ORDER = [
  'Bermejo', 'Pilcomayo', 'Iguazú', 'Paraguay',
  'Paraná (medio)', 'Paraná (inferior)', 'Riacho Barranqueras',
  'Arroyo Riachuelo', 'Piray Guazú', 'Piray Miní', 'Riacho Salado',
];

export const AGENCY_LABEL = { INA: 'INA (Argentina)', MADES: 'MADES (Paraguay)' };

export const VARIABLE_LABEL = {
  level: 'Water level', discharge: 'Discharge', rain: 'Rain',
  temperature: 'Temperature', wind: 'Wind', humidity: 'Humidity',
  hydrological_state: 'Hydrological state',
};
export const VARIABLE_UNIT = {
  level: 'm', discharge: 'm³/s', rain: 'mm', temperature: '°C', wind: 'km/h', humidity: '%',
};
export const VARIABLE_ORDER = ['level', 'discharge', 'rain', 'temperature', 'wind', 'humidity', 'hydrological_state'];

export const STATUS_LABEL = { ok: 'Reporting', stale: 'Stale (15–30d)' };

export const CONDICION_LABEL = {
  'aguas altas': 'Aguas altas (high)',
  'aguas medias altas': 'Aguas medias altas',
  'aguas medias': 'Aguas medias (normal)',
  'aguas medias bajas': 'Aguas medias bajas',
  'aguas bajas': 'Aguas bajas (low)',
};
export const CONDICION_ORDER = ['aguas altas', 'aguas medias altas', 'aguas medias', 'aguas medias bajas', 'aguas bajas'];
export const CONDICION_COLOR = {
  'aguas altas': '#6fa8dc', 'aguas medias altas': '#cfe2f3', 'aguas medias': '#fff2cc',
  'aguas medias bajas': '#f6b26b', 'aguas bajas': '#ea9999',
};

export const TREND_LABEL = { rising: 'Rising', falling: 'Falling', steady: 'Steady' };
export const TREND_ARROW = { rising: '↑', falling: '↓', steady: '→' };
export const TREND_COLOR = { rising: '#ef4444', falling: '#22c55e', steady: '#94a3b8' };
// Note: for a river, "rising" (red) flags rising flood risk and "falling"
// (green) reads as reassuring — the opposite of the usual green=good station
// status colors, which is intentional; a legend spells this out in the UI.

export async function loadData() {
  const [stations, tramos, report] = await Promise.all([
    fetch('/data/stations.geojson').then(r => r.json()),
    fetch('/data/tramos.geojson').then(r => r.json()),
    fetch('/data/report.json').then(r => r.json()),
  ]);
  return { stations, tramos, report };
}
