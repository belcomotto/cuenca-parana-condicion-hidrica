# INA Rivers Watch

Live telemetry station catalog + exploration map for INA (Instituto Nacional
del Agua, Argentina) river gauges in the **Bermejo, Pilcomayo, Iguazú and
Paraguay** corridor — plus the mainstem Paraná and small-tributary gauges
visible in that same stretch of INA's public map. Built to produce clean
GeoJSON layers for import into ArcGIS Online / Experience Builder.

## How the data is built

`scripts/fetch-stations.mjs` queries INA's public SIyAH API
(`https://alerta.ina.gob.ar/pub/datos/`) and GeoServer instance
(`https://alerta.ina.gob.ar/geoserver/ows`):

**Stations:**

1. `estaciones` — the full national catalog (~1900 stations, all rivers).
2. Filters to the **RHN-SAT** network (`nombre_red === 'RHN - SAT'`,
   `automatica: true`) with a name prefixed `"<River> - <Place>"` matching
   Bermejo / Pilcomayo / Iguazú / Paraguay, minus two known-bad entries:
   - `6637` "Bermejo - Azud los Colorados" — actually in La Rioja, an
     unrelated river of the same name.
   - `2154` "Bermejo - Pozo Sarmiento" — dead duplicate of `7248`
     "Bermejo - P. Sarmiento" (same location, no readings ever).
3. Adds a manually-identified list (`EXTRA_SITECODES`) of stations visible
   on INA's public map (`/pub/mapa`) in the same corridor but on other
   networks — mostly the Prefectura Naval river-scale network
   (`escalas Prefectura Nacional`), which covers the bigger navigable
   rivers (Paraná, Paraguay) that RHN-SAT doesn't. INA classifies several of
   these by their own `rio` tag as Paraná mainstem ("PARANAMED"/"PARANAINF")
   rather than literally Iguazú/Paraguay — that tag is kept as-is (translated
   to "Paraná (medio)"/"Paraná (inferior)") rather than relabeled, so the
   `river` field stays geographically accurate.
4. For every candidate, calls `series&siteCode=X` **once** — this returns
   every variable series configured for that station plus its last
   observation date, so there's no more guessing variable IDs per station.
5. **Drops any station with no reading in the last 30 days entirely** — it
   won't appear in the output at all, not even as a "no data" marker.
6. Tags each surviving station with every variable category it's currently
   reporting (`level`, `discharge`, `rain`, `temperature`, `wind`,
   `humidity`, `hydrological_state`), and fetches the latest value for each.

**Reach condition ("Condición Hídrica"):**

GeoServer layer `public2:tramos_condicion_params` gives named river reaches
with a current level/discharge percentile classification — "aguas altas"
(high) through "aguas bajas" (low), based on where today's value falls in
the historical record. Filtered to the 6 reaches in this corridor (the layer
also covers the Uruguay river and Paraná down to the Delta, out of scope
here). Colors are INA's own style (pulled from the layer's
`GetLegendGraphic`), not reinvented.

Run either any time to refresh:

```bash
npm run fetch:stations
```

This overwrites `public/data/stations.geojson`, `public/data/tramos.geojson`,
and `public/data/report.json`.

## Station status

- `status`: `ok` (reading within 14 days) or `stale` (15–30 days old).
  Nothing older than 30 days is included at all.
- `variables` / `variable_labels`: which categories this station currently
  reports — a station can have several (e.g. a combined station reporting
  both level and rain).

Current counts (total stations, by river, by agency, by trend, which
candidates got dropped for not transmitting) aren't hardcoded here since
they refresh hourly — see `public/data/report.json` for the live
per-station breakdown, or the summary bar at the top of the Dashboards tab.

## Explore locally

```bash
npm install
npm run dev
```

Opens a MapLibre map (no API token needed — tiles from
[OpenFreeMap](https://openfreemap.org)) with:

- Stations colored by river/reach, status halos, click-for-detail popups.
- Per-river and per-variable filter checkboxes (combined with AND — a
  station shows only if its river *and* at least one of its active
  variables are checked).
- A togglable "Condición Hídrica" overlay showing the 6 reach lines colored
  by INA's high-to-low water percentile scale, with its own popup.

A second tab, **Dashboards**, gives a per-river read of what the map can't
show at a glance: a rising/falling/steady call for every station (sparkline
+ arrow), INA's own official forecast where one exists (Corrientes,
Barranqueras, Puerto Pilcomayo, Puerto Formosa — a real dated projection with
confidence bands, not an extrapolation), an honest "no forecast yet" note
everywhere else, and a written explanation of exactly where every number
comes from and how trend is computed.

## Export to ArcGIS Online

Both `public/data/stations.geojson` (points) and `public/data/tramos.geojson`
(lines) are flat-property GeoJSON (EPSG:4326), ready to import directly:

**ArcGIS Online** → Content → New item → your computer → select the file →
publish as a hosted feature layer → add to your Experience Builder map.

**Station fields**: `agency`, `site_code`, `name`, `river`, `variables`,
`variable_labels`, `country`, `network`, `status`, `level_m`,
`discharge_m3s`, `rain_mm`, `temp_c`, `wind_kmh`, `humidity_pct`,
`last_reading_date`, `days_since_reading`, `trend_variable`, `trend`,
`trend_change`, `trend_window_days`, `trend_history` (JSON string),
`has_forecast`, `forecast` (JSON string or null), `alert_level_m`,
`critical_level_m`, `disaster_level_m` (the last three are MADES-only
reference levels; INA's equivalents live inside `forecast` instead, a
different scale/semantics — see `src/dashboard.js` if reconciling them).

**Reach fields**: `reach`, `river`, `condicion`, `percentil`, `color` (hex,
INA's own palette), `tendencia`, `level_m`, `level_condicion`,
`discharge_m3s`, `discharge_condicion`, `fecha`.

## Keeping it live

`.github/workflows/refresh-data.yml` re-runs `scripts/fetch-stations.mjs`
every hour, commits `public/data/*.geojson`/`report.json` only if something
actually changed, and pushes to `main`. Vercel is connected to this repo and
auto-deploys on every push, so that's the whole loop: GitHub Action refreshes
the files → push → Vercel rebuilds → the live site's "updated" timestamp
moves. No server, no database, no app code calling the upstream APIs — just
a static site whose static files happen to get regenerated hourly. Trigger
it manually anytime from the repo's Actions tab (`workflow_dispatch`) instead
of waiting for the next hour, or run `npm run fetch:stations` locally same
as before.

An ArcGIS Online layer built from the downloaded GeoJSON is still a manual
snapshot, though — re-download and re-upload (or script an overwrite via the
ArcGIS API for Python) to pull in what this pipeline has refreshed since.
