# City Scale Compare

Visualizes 15 world cities at equal scale, overlapping their urban road networks and built-up area polygons. React + Vite + TypeScript + d3.

## Data pipeline

Run in order. Each step overwrites its outputs; all are idempotent.

```bash
node scripts/extract-urban-areas.js    # urban_areas.json → public/data/cities.json
node scripts/fetch-roads-overpass.js   # Overpass → public/data/roads/<id>.json
node scripts/stitch-roads.js           # roads/ → roads-stitched/
pnpm build                             # tsc -b && vite build
```

The app reads `public/data/cities.json` (metadata + geometry) and lazy-fetches `public/data/roads-stitched/<id>.json` for visible cities.

## Non-obvious conventions

- **bbox is `[minLat, maxLat, minLon, maxLon]`**. Not the GeoJSON `[W, S, E, N]` convention. Everything in this repo uses this order; don't swap.
- **Geometry is `Polygon | MultiPolygon`**. Fragmented cities (NYC, split by Hudson/East rivers) come out as MultiPolygon; single-piece cities (Tokyo's Kanto blob) as Polygon. Consumers in `src/` must handle both — `d3.geoPath` does this automatically, but manual ring iteration in [CityMap.tsx](src/components/CityMap.tsx) uses `geojson.type === 'Polygon' ? [coords[0]] : coords.map(p => p[0])`.
- **Roads file format is `number[][][]`** — an array of polylines, each polyline is `[lng, lat]` pairs. No metadata, no road class. Stitched files have the same shape, just merged polylines.
- **`areaKm2` is the area of the drawn polygon**, not an external canonical city size. It's summed from Natural Earth's `area_sqkm` across matched features.
- **Admin polygons are not used.** We use Natural Earth night-lights built-up polygons (`ne_10m_urban_areas.shp` / `urban_areas.json`). Political boundaries were abandoned because Tokyo Metropolis = 2,194 km² vs NYC = 783 km² makes comparisons meaningless.

## Gotchas

- **Fetcher skips cities with non-empty per-city files.** To force a refetch, delete the file: `rm public/data/roads/<id>.json`. No `--force` flag. See [fetch-roads-overpass.js `readExistingRoads`](scripts/fetch-roads-overpass.js).
- **Auto-tiling triggers at `MAX_TILE_KM2 = 12000`** — only Tokyo hits this (44,400 km² bbox splits 2×2). Tiles dedupe by OSM way ID, not coordinates.
- **Stitcher's quantization is 1 cm** (`QUANT = 1e7`). OSM node coords match exactly at shared endpoints; there's no tolerance fallback. If neighboring cities' ways don't stitch, check whether the upstream fetch includes the connecting way — it often doesn't at bbox boundaries.
- **`scripts/extract-roads.js` is deprecated.** The old pipeline routed roads through `cities.json`; the new fetcher writes per-city files directly. Don't re-add extract-roads to the flow; it will overwrite good per-city data with empty arrays.
- **Scale is computed from admin bbox in [MapCanvas.tsx:40](src/components/MapCanvas.tsx:40)**, which now reads urban-polygon bbox (renamed from admin but we kept the variable name). Linear dimensions track `sqrt(areaKm2)` — this is what makes cross-city size comparisons meaningful.
- **`public/data/cities.json` is large (~400 KB) and generated.** Don't hand-edit geometry; rerun the extractor. Hand-editing `rivers`/`coastline` is fine — those fields are preserved on re-extract.

## Adding a city

1. Append an entry to the `cities` array in [scripts/extract-urban-areas.js](scripts/extract-urban-areas.js). You need `id`, `name`, `nameZh`, `country`, `lat`, `lon`.
2. Run the full pipeline. The fetcher's skip-if-exists means only the new city actually hits Overpass:
   ```bash
   node scripts/extract-urban-areas.js
   node scripts/fetch-roads-overpass.js
   node scripts/stitch-roads.js
   pnpm build
   ```
3. If the extractor reports `✗ <name>: no urban polygon found within 0.4°`, the city center is too far from any Natural Earth urban polygon. Loosen `NEIGHBOR_RADIUS_DEG` or move the lat/lon to the urban core.

## Key files

- [src/components/CityMap.tsx](src/components/CityMap.tsx) — per-city SVG group: boundary, clipped roads, label.
- [src/components/MapCanvas.tsx](src/components/MapCanvas.tsx) — global scale computation, drag handling, grid/legend chrome.
- [src/hooks/useCityData.ts](src/hooks/useCityData.ts) — loads cities.json, lazy-fetches per-city roads, owns visibility/offset state.
- [src/types/city.ts](src/types/city.ts) — `CityData` / `CityViewModel`. `geojson` is `Polygon | MultiPolygon`.
- [scripts/extract-urban-areas.js](scripts/extract-urban-areas.js) — city → urban polygon matching; merges water-split fragments.
- [scripts/fetch-roads-overpass.js](scripts/fetch-roads-overpass.js) — bbox-scoped Overpass fetch, auto-tiles, 3 mirrors, retries.
- [scripts/stitch-roads.js](scripts/stitch-roads.js) — angle-based stroke stitcher; merges adjacent OSM ways along straight continuations (≤30° turn).

## Commands

- `pnpm dev` — dev server with HMR
- `pnpm build` — production build to `dist/`
- `pnpm preview` — serve the built `dist/` locally (needed if you want to view via a URL — opening `bundle.html` over `file://` won't work since the app fetches `/data/...`)
- `pnpm lint` — ESLint
