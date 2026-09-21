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

As of the last run: **41 transmitting stations** across 11 river/reach
labels (Bermejo 10, Paraná medio 10, Paraguay 7, Iguazú 4, Paraná inferior 2,
Pilcomayo 3, plus 5 single-station tributaries: Riacho Barranqueras, Arroyo
Riachuelo, Piray Guazú, Piray Miní, Riacho Salado) — 6 candidates were
dropped for not currently transmitting. See `public/data/report.json` for
the full per-station breakdown.

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

**Station fields**: `site_code`, `name`, `river`, `variables`,
`variable_labels`, `country`, `network`, `status`, `level_m`,
`discharge_m3s`, `rain_mm`, `temp_c`, `wind_kmh`, `humidity_pct`,
`last_reading_date`, `days_since_reading`.

**Reach fields**: `reach`, `river`, `condicion`, `percentil`, `color` (hex,
INA's own palette), `tendencia`, `level_m`, `level_condicion`,
`discharge_m3s`, `discharge_condicion`, `fecha`.

This is a snapshot, not a live feed — re-run `npm run fetch:stations` and
re-upload to refresh the values in ArcGIS Online.
