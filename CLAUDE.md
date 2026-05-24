# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## City Scale Compare

Visualizes **79 world cities** at equal geographic scale, overlapping their urban built-up polygons and OSM road networks. React 19 + Vite + TypeScript + d3-geo, with shadcn/ui (Radix) primitives and Tailwind. Package manager is **pnpm** (lockfile committed).

## Commands

App development:
- `pnpm dev` — Vite dev server with HMR (default `http://localhost:5173`)
- `pnpm build` — `tsc -b && vite build` → `dist/`
- `pnpm preview` — serve the built `dist/` over HTTP. **You must use this**, not `file://`, because the app fetches `/data/...` paths and Vite is configured with `base: "/city-scale-comparison/"` ([vite.config.ts:6](vite.config.ts:6))
- `pnpm lint` — ESLint (flat config in [eslint.config.js](eslint.config.js))
- `pnpm deploy` — `pnpm build && gh-pages -d dist` (publishes to GitHub Pages)

Data pipeline (run from project root, in order — all idempotent, all overwrite their outputs):

```bash
node scripts/extract-urban-areas.js    # urban_areas.json → public/data/cities.json
node scripts/fetch-roads-overpass.js   # Overpass        → public/data/roads/<id>.json
node scripts/stitch-roads.js           # roads/          → public/data/roads-stitched/<id>.json
```

The fetcher supports `--region=<id>` (e.g. `--region=china`) for phased fetching when Overpass is rate-limiting.

## Architecture

The app is a **viewer over generated data**. The pipeline scripts run offline; the React app reads `public/data/cities.json` (metadata + boundary geometry, ~400 KB) once at startup, then **lazy-fetches `public/data/roads-stitched/<id>.json` only when a city is toggled visible**. A `loadedRef` Set in [useCityData.ts](src/hooks/useCityData.ts) prevents re-fetch after toggle-off/on.

Rendering pipeline, top-down:

1. [App.tsx](src/App.tsx) — wires `useCityData()` to `CitySelector` (sidebar) and `MapCanvas` (overlay).
2. [src/hooks/useCityData.ts](src/hooks/useCityData.ts) — owns the `CityViewModel[]` state: visibility, drag offsets, lazy road loading. Soft-caps at `VISIBLE_CAP = 12` cities (warning banner, not a block).
3. [src/components/MapCanvas.tsx](src/components/MapCanvas.tsx) — computes `globalScale` from the **largest visible bbox**, so all cities draw at equal km-per-pixel. Owns drag handling and the grid/legend chrome.
4. [src/components/CityMap.tsx](src/components/CityMap.tsx) — per-city `<g>`: equirectangular projection around the bbox center, road clip mask, label placement.
5. [src/components/CitySelector.tsx](src/components/CitySelector.tsx) → [src/components/RegionAccordion.tsx](src/components/RegionAccordion.tsx) — region-grouped accordions with tri-state checkboxes for bulk-toggle.

Cities are organized into 6 regions (`china | asia | europe | north-america | south-america | africa`) defined in [src/lib/regions.ts](src/lib/regions.ts). Region metadata travels with each city in `cities.json`.

## Non-obvious conventions

- **`bbox` is `[minLat, maxLat, minLon, maxLon]`**. Not the GeoJSON `[W, S, E, N]` convention. Everything in this repo uses this order; don't swap.
- **Geometry is `Polygon | MultiPolygon`**. Cities split by water (NYC, Hong Kong, Sydney) come out as MultiPolygon; single-piece cities (Tokyo's Kanto blob) as Polygon. `d3.geoPath` handles both automatically, but the manual ring iteration in [CityMap.tsx](src/components/CityMap.tsx) uses `geojson.type === 'Polygon' ? [coords[0]] : coords.map(p => p[0])`.
- **Roads file format is `number[][][]`** — array of polylines, each polyline is `[lng, lat]` pairs. No metadata, no road class. Stitched files have the same shape, just merged polylines.
- **`areaKm2` is the area of the drawn polygon**, not an external canonical city size. It's summed from Natural Earth's `area_sqkm` across matched features. Linear dimensions track √areaKm2 — that's what makes the equal-scale comparison meaningful.
- **Admin polygons are not used.** We use Natural Earth night-lights built-up polygons (`ne_10m_urban_areas.shp` / `urban_areas.json`). Political boundaries were abandoned because Tokyo Metropolis = 2,194 km² vs NYC = 783 km² makes comparisons meaningless.
- **`clipBbox` field in city seeds** crops a Natural Earth polygon to a sub-rectangle. Used when several seed cities fall inside one giant night-lights blob — e.g. Guangzhou and Shenzhen both match the entire ~10,700 km² Pearl River Delta polygon without it. See [scripts/extract-urban-areas.js](scripts/extract-urban-areas.js).

## Gotchas

- **Fetcher skips cities with non-empty per-city files.** To force a refetch, delete the file: `rm public/data/roads/<id>.json`. No `--force` flag. See `readExistingRoads` in [scripts/fetch-roads-overpass.js](scripts/fetch-roads-overpass.js).
- **Auto-tiling triggers at `MAX_TILE_KM2 = 8000`** — Tokyo, Osaka, Bangkok, Tehran, etc. split 2×2 or 3×3. The threshold was lowered from 12000 after Overpass started returning truncated JSON for ~10k km² single-tile queries. Tiles dedupe by OSM way ID, not coordinates.
- **Stitcher's quantization is 1 cm** (`QUANT = 1e7`). OSM node coords match exactly at shared endpoints; there's no tolerance fallback. If neighboring cities' ways don't stitch, check whether the upstream fetch includes the connecting way — it often doesn't at bbox boundaries.
- **`scripts/extract-roads.js` is deprecated.** The old pipeline routed roads through `cities.json`; the new fetcher writes per-city files directly. Don't re-add extract-roads to the flow; it will overwrite good per-city data with empty arrays. Other deprecated scripts in `scripts/`: `fetch-roads-osmnx*.py`, `fetch-roads.js`, `fetch-city-boundaries.{js,sh}`, `extract-features.js`, `merge-city-data.js`.
- **Scale is computed from the urban-polygon bbox** in [MapCanvas.tsx:43-63](src/components/MapCanvas.tsx:43). The variable comments still say "admin" — that's vestigial; we switched to urban-polygon bbox but kept the variable names.
- **Stitched roads live off-repo on a sibling Pages site.** The app fetches `https://rinshannkaihou.github.io/city-scale-comparison-data/<id>.json` by default; override via `VITE_ROADS_BASE_URL` (see `.env` / `.env.example`). `public/data/cities.json` (1.4 MB) is still bundled. Local `public/data/roads/` and `public/data/roads-stitched/` are gitignored — populate via `pnpm fetch-data` or by re-running the Overpass + stitch pipeline. See `docs/DATA-HOSTING.md`.
- **Per-city files use the city's `id`**, not its name. The `public/data/Beijing.json` (etc.) at the root of `public/data/` are stale leftovers — the runtime path is `public/data/roads-stitched/<id>.json` (e.g. `beijing.json`, lowercase).

## Adding a city

1. Append a seed to the `cities` array in [scripts/extract-urban-areas.js](scripts/extract-urban-areas.js):
   ```js
   { id: 'kyoto', name: 'Kyoto', nameZh: '京都', country: 'Japan',
     region: 'asia', lat: 35.0116, lon: 135.7681 }
   ```
   Required fields: `id`, `name`, `nameZh`, `country`, `region`, `lat`, `lon`. `region` must be one of `china | asia | europe | north-america | south-america | africa`. Optional: `clipBbox` (when the seed falls inside a giant blob shared with another city).
2. Run the full pipeline. Skip-if-exists means only the new city actually hits Overpass:
   ```bash
   node scripts/extract-urban-areas.js
   node scripts/fetch-roads-overpass.js
   node scripts/stitch-roads.js
   ```
3. If the extractor reports `✗ <name>: no urban polygon found within 0.4°`, the seed lat/lon is too far from any Natural Earth urban polygon. Move the seed closer to the urban core, or accept the city has no Natural Earth night-lights footprint.

## Key files

- [src/components/CityMap.tsx](src/components/CityMap.tsx) — per-city SVG group: boundary, clipped roads, label.
- [src/components/MapCanvas.tsx](src/components/MapCanvas.tsx) — global scale computation, drag handling, grid/legend chrome.
- [src/hooks/useCityData.ts](src/hooks/useCityData.ts) — loads cities.json, lazy-fetches per-city roads, owns visibility/offset state, soft-caps at 12 visible.
- [src/types/city.ts](src/types/city.ts) — `CityData` / `CityViewModel`. `geojson` is `Polygon | MultiPolygon`.
- [src/lib/regions.ts](src/lib/regions.ts) — `REGION_ORDER` + bilingual labels.
- [scripts/extract-urban-areas.js](scripts/extract-urban-areas.js) — city seed → urban polygon matching; merges water-split fragments; supports `clipBbox`.
- [scripts/fetch-roads-overpass.js](scripts/fetch-roads-overpass.js) — bbox-scoped Overpass fetch, auto-tiles >8,000 km², 3 mirrors with exponential backoff, `--region=<id>` flag.
- [scripts/stitch-roads.js](scripts/stitch-roads.js) — angle-based stroke stitcher; merges adjacent OSM ways along straight continuations (≤30° turn).
