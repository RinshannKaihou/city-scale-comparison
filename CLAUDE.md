# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## City Scale Compare

Visualizes **79 world cities** at equal geographic scale, overlapping their urban built-up polygons and OSM road networks. React 19 + Vite + TypeScript, rendering to a single **HTML Canvas 2D** (a metro carries up to ~1.1M road vertices — far too much for SVG/DOM), with shadcn/ui (Radix) primitives and Tailwind. Package manager is **pnpm** (lockfile committed).

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
3. [src/components/MapCanvas.tsx](src/components/MapCanvas.tsx) — the `<canvas>` element + all interaction. Computes `globalScale` from the **largest visible bbox** (equal km-per-pixel). Owns: an rAF-coalesced paint (with a synchronous fallback when the tab is hidden — rAF is paused then), a **one-city-per-frame road-build pump** (so bulk-toggling a region doesn't freeze the main thread projecting millions of vertices at once), pointer-drag hit-testing, and the grid/legend chrome (HTML overlays).
4. [src/lib/map-render.ts](src/lib/map-render.ts) — the imperative core, off the React render path: equirectangular projection around each bbox center, screen-space LOD road decimation, a per-`(city, scale)` `Path2D` cache (a drag only re-translates cached paths — no re-projection), `drawScene`, and point-in-polygon `hitTest`. The cheap **boundary** builds synchronously (outlines appear instantly); the heavy **roads** build via the pump and stream in.
5. [src/lib/export-map.ts](src/lib/export-map.ts) — PNG (re-render the scene to an offscreen canvas at 2×) and SVG (rebuild `d`-strings from the cached geometry on click — so vector export stays available without any SVG cost during interaction). Both force-build roads first so the export is complete.
6. [src/components/CitySelector.tsx](src/components/CitySelector.tsx) → [src/components/RegionAccordion.tsx](src/components/RegionAccordion.tsx) — region-grouped accordions with tri-state checkboxes for bulk-toggle.

Cities are organized into 6 regions (`china | asia | europe | north-america | south-america | africa`) defined in [src/lib/regions.ts](src/lib/regions.ts). Region metadata travels with each city in `cities.json`.

## Non-obvious conventions

- **`bbox` is `[minLat, maxLat, minLon, maxLon]`**. Not the GeoJSON `[W, S, E, N]` convention. Everything in this repo uses this order; don't swap.
- **Geometry is `Polygon | MultiPolygon`**. Cities split by water (NYC, Hong Kong, Sydney) come out as MultiPolygon; single-piece cities (Tokyo's Kanto blob) as Polygon. The renderer handles both via `geojson.type === 'Polygon' ? [coords[0]] : coords.map(p => p[0])` for outer rings (see `outerRings`/`allRings` in [map-render.ts](src/lib/map-render.ts)). The geometry type is defined locally in [types/city.ts](src/types/city.ts) (`CityGeometry`), **not** the `@types/geojson` UMD global — that global was only present transitively via `@types/d3-geo`, which no longer exists.
- **Roads file format is `number[][][]`** — array of polylines, each polyline is `[lng, lat]` pairs. No metadata, no road class. Stitched files have the same shape, just merged polylines.
- **`areaKm2` is the area of the drawn polygon**, recomputed (equirectangular planar area) from the final matched+partitioned geometry — not an external canonical city size. Linear dimensions track √areaKm2 — that's what makes the equal-scale comparison meaningful.
- **Admin polygons are not used.** We use Natural Earth night-lights built-up polygons (`ne_10m_urban_areas.shp` / `urban_areas.json`). Political boundaries were abandoned because Tokyo Metropolis = 2,194 km² vs NYC = 783 km² makes comparisons meaningless.
- **Conurbations are split by shadow seeds, not `clipBbox`.** The old `clipBbox` rectangle hack is gone. When one built-up blob contains several seeded cities (Pearl River Delta = Guangzhou + Shenzhen, Keihanshin = Osaka + Kobe + Kyoto, the Randstad, DC–Baltimore…), the blob is partitioned along the **perpendicular bisectors** between the seeds inside it. Neighbors that aren't in the display list are added as `display: false` **shadow seeds** (full entries in the `cities` array that partition the geometry but are not written to `cities.json`). See the shadow-seed block in [scripts/extract-urban-areas.js](scripts/extract-urban-areas.js). Flip a shadow seed to `display: true` to surface it as its own selectable city.

## Gotchas

- **Fetcher skips cities with non-empty per-city files.** To force a refetch, delete the file: `rm public/data/roads/<id>.json`. No `--force` flag. See `readExistingRoads` in [scripts/fetch-roads-overpass.js](scripts/fetch-roads-overpass.js).
- **Auto-tiling triggers at `MAX_TILE_KM2 = 8000`** — Tokyo, Osaka, Bangkok, Tehran, etc. split 2×2 or 3×3. The threshold was lowered from 12000 after Overpass started returning truncated JSON for ~10k km² single-tile queries. Tiles dedupe by OSM way ID, not coordinates.
- **Stitcher's quantization is 1 cm** (`QUANT = 1e7`). OSM node coords match exactly at shared endpoints; there's no tolerance fallback. If neighboring cities' ways don't stitch, check whether the upstream fetch includes the connecting way — it often doesn't at bbox boundaries.
- **`scripts/extract-roads.js` is deprecated.** The old pipeline routed roads through `cities.json`; the new fetcher writes per-city files directly. Don't re-add extract-roads to the flow; it will overwrite good per-city data with empty arrays. Other deprecated scripts in `scripts/`: `fetch-roads-osmnx*.py`, `fetch-roads.js`, `fetch-city-boundaries.{js,sh}`, `extract-features.js`, `merge-city-data.js`.
- **Scale is computed from the urban-polygon bbox** — `computeGlobalScale` in [map-render.ts](src/lib/map-render.ts) takes the largest visible bbox so all cities share one km-per-pixel.
- **The road build is the only expensive step, and it is kept off the draw path.** Projecting + LOD-decimating a metro's roads is hundreds of ms (Tokyo ~1.1M vertices). It runs once per `(city, scale)`, cached as a `Path2D`; drawing is then ~0.2ms/frame and a drag never re-projects. Bulk toggles build one city per animation frame ([MapCanvas.tsx](src/components/MapCanvas.tsx) pump). If you touch this, keep the invariant: `getCityGeom` rebuilds when `scale` **or** `roadsRef` changes, and the pump reads `citiesRef`/`layoutRef` (not closure state) so in-flight builds stay current.
- **Stitched roads live off-repo on a sibling Pages site.** The app fetches `https://rinshannkaihou.github.io/city-scale-comparison-data/<id>.json` by default; override via `VITE_ROADS_BASE_URL` (see `.env` / `.env.example`). `public/data/cities.json` (1.4 MB) is still bundled. Local `public/data/roads/` and `public/data/roads-stitched/` are gitignored — populate via `pnpm fetch-data` or by re-running the Overpass + stitch pipeline. See `docs/DATA-HOSTING.md`.
- **Per-city files use the city's `id`**, not its name. The `public/data/Beijing.json` (etc.) at the root of `public/data/` are stale leftovers — the runtime path is `public/data/roads-stitched/<id>.json` (e.g. `beijing.json`, lowercase).

## Adding a city

1. Append a seed to the `cities` array in [scripts/extract-urban-areas.js](scripts/extract-urban-areas.js):
   ```js
   { id: 'nagoya', name: 'Nagoya', nameZh: '名古屋', country: 'Japan',
     region: 'asia', lat: 35.1815, lon: 136.9066 }
   ```
   Required fields: `id`, `name`, `nameZh`, `country`, `region`, `lat`, `lon`. `region` must be one of `china | asia | europe | north-america | south-america | africa`. Optional: `display: false` (a partition-only shadow seed — see below) and `excludeFeats: number[]` (feature indices this city must never annex, for a cross-border artifact geometry can't resolve — e.g. Singapore excludes Johor Bahru). If the new seed falls inside a blob already owned by another displayed city, it automatically co-partitions it along the perpendicular bisector — no manual crop.
2. Run the full pipeline. Skip-if-exists means only the new city actually hits Overpass:
   ```bash
   node scripts/extract-urban-areas.js
   node scripts/fetch-roads-overpass.js
   node scripts/stitch-roads.js
   ```
3. If the extractor reports a city as `✗ ... UNMATCHED`, the seed lat/lon isn't inside (or within `SNAP_MAX = 5 km` of) any Natural Earth urban polygon. Move the seed closer to the urban core, or accept the city has no Natural Earth night-lights footprint (the prior entry is preserved).

## Key files

- [src/lib/map-render.ts](src/lib/map-render.ts) — canvas rendering core: projection, LOD road decimation, `Path2D` cache, `drawScene`, `hitTest`. Off the React render path.
- [src/lib/export-map.ts](src/lib/export-map.ts) — PNG (offscreen re-render at 2×) and SVG (rebuild `d`-strings on demand) export.
- [src/components/MapCanvas.tsx](src/components/MapCanvas.tsx) — `<canvas>` + rAF paint, road-build pump, drag hit-testing, grid/legend chrome.
- [src/hooks/useCityData.ts](src/hooks/useCityData.ts) — loads cities.json, lazy-fetches per-city roads, owns visibility/offset state, soft-caps at 12 visible.
- [src/types/city.ts](src/types/city.ts) — `CityData` / `CityViewModel` + the local `CityGeometry` (`Polygon | MultiPolygon`) type.
- [src/lib/regions.ts](src/lib/regions.ts) — `REGION_ORDER` + bilingual labels.
- [scripts/extract-urban-areas.js](scripts/extract-urban-areas.js) — seed → urban-polygon matching by **nearest-seed ownership + adjacency flood-fill** (`GAP_MAX = 8 km`, `REACH_MAX = 45 km`); reunites water-split fragments; partitions shared blobs along perpendicular bisectors; `display: false` shadow seeds; prints a per-city report.
- [scripts/fetch-roads-overpass.js](scripts/fetch-roads-overpass.js) — bbox-scoped Overpass fetch, auto-tiles >8,000 km², 3 mirrors with exponential backoff, `--region=<id>` flag.
- [scripts/stitch-roads.js](scripts/stitch-roads.js) — angle-based stroke stitcher; merges adjacent OSM ways along straight continuations (≤30° turn).
