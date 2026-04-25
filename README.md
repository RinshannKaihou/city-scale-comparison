# City Scale Compare · 城市尺度对比

Overlap the urban footprints of **79 world cities** at the same geographic scale — boundary polygons and full street networks — to make cross-city size comparisons that satellite views and Wikipedia infoboxes can't.

![Screenshot](./final-screenshot.png)

## Why this exists

Stand-alone city maps lie about size. A render of Tokyo at "good detail" and a render of Singapore at "good detail" are usually drawn at completely different scales — your eye reads them as comparable when they aren't. This tool draws every city at the **same km-per-pixel** so the comparison is honest.

The boundary isn't an administrative line, either. Political boundaries are useless for this kind of comparison (Tokyo Metropolis is 2,194 km² vs. NYC's 783 km², which makes Tokyo look smaller than its actual built-up footprint). Instead this project uses **Natural Earth's night-lights urban polygons** — the actual lit-up built environment — and **OpenStreetMap road networks** within each polygon's bounding box.

## Live cities (79 total)

Grouped into **6 regions** in the sidebar:

| Region | Count | Notable |
|---|---|---|
| China (中国) | 16 | Beijing, Shanghai, Shenzhen, Hong Kong, Chongqing, Tianjin … |
| Asia (亚洲, incl. Oceania) | 18 | Tokyo, Seoul, Mumbai, Jakarta, Delhi, Sydney, Auckland … |
| Europe (欧洲) | 15 | London, Paris, Moscow, Istanbul, Berlin, Madrid, Rome … |
| North America (北美) | 12 | New York, LA, Chicago, Mexico City, Toronto, Houston … |
| South America (南美) | 9 | São Paulo, Buenos Aires, Rio, Lima, Santiago … |
| Africa (非洲) | 9 | Cairo, Lagos, Johannesburg, Nairobi, Cape Town … |

## Stack

- **Frontend** — React 19 + TypeScript + Vite + Tailwind CSS, with shadcn/ui primitives.
- **Rendering** — d3-geo for projection math, raw SVG for the overlap canvas.
- **Data** — Natural Earth `ne_10m_urban_areas` for boundaries, Overpass API (OSM) for roads.

## Quick start

```bash
pnpm install
pnpm dev              # dev server with HMR
# → http://localhost:5173
```

Other scripts:

```bash
pnpm build            # production build (tsc -b && vite build) → dist/
pnpm preview          # serve dist/ locally
pnpm lint             # ESLint
```

The app reads `public/data/cities.json` once at startup, then **lazy-loads each city's road file only when you toggle it visible** — so opening the sidebar with 79 cities is instant; only what you select is downloaded.

## Using the app

1. **Toggle cities** in the sidebar's regional accordions (China + Asia auto-expanded by default).
2. **Drag** any city overlay to align landmarks for easier comparison. Hit "重置位置" to reset.
3. **Region tri-state checkbox** on each accordion header bulk-toggles every city in that region.
4. A **soft warning** appears if you select more than 12 cities at once — the visualization stays readable up to ~10–12 overlapping cities. The warning doesn't block; just suggests.

## Data pipeline

Three stages, all idempotent. Run in order from the project root:

```bash
node scripts/extract-urban-areas.js    # Natural Earth → public/data/cities.json
node scripts/fetch-roads-overpass.js   # Overpass    → public/data/roads/<id>.json
node scripts/stitch-roads.js           # roads/      → public/data/roads-stitched/<id>.json
```

What each does:

- **extract-urban-areas** — for each city seed (lat/lon + region), collects every Natural Earth urban polygon within 0.4° (~44 km) and unions them. This stitches back together polygons that Natural Earth split at water (NYC's Hudson, Sydney's harbour, Hong Kong's bays).
- **fetch-roads-overpass** — bbox-scoped Overpass queries for `motorway/trunk/primary/secondary/tertiary`. Three-mirror rotation, exponential backoff. **Auto-tiles** any bbox > 8,000 km² (Tokyo's 44k km² Kanto blob splits into a 3×3 grid). Skip-if-exists makes the script resumable across rate-limit interruptions. Supports `--region=<id>` for phased fetching.
- **stitch-roads** — angle-based stroke stitcher. OSM ways are fragmented at every intersection; this merges adjacent ways along straight continuations (≤30° turn) so roads look like roads in the render, not like ladder rungs. ~25–35% polyline-count reduction on average.

### Adding a city

1. Append a seed to the `cities` array in [`scripts/extract-urban-areas.js`](scripts/extract-urban-areas.js):
   ```js
   { id: 'kyoto', name: 'Kyoto', nameZh: '京都', country: 'Japan',
     region: 'asia', lat: 35.0116, lon: 135.7681 },
   ```
   Required fields: `id`, `name`, `nameZh`, `country`, `region`, `lat`, `lon`. Region must be one of `china | asia | europe | north-america | south-america | africa`.

2. Run the pipeline. Skip-if-exists means only the new city actually fetches:
   ```bash
   node scripts/extract-urban-areas.js
   node scripts/fetch-roads-overpass.js
   node scripts/stitch-roads.js
   ```

3. If the extractor reports `✗ <name>: no urban polygon found within 0.4°`, your seed lat/lon is too far from any Natural Earth polygon. Either move the seed closer to the urban core or check the metro really has a Natural Earth night-lights footprint (some smaller cities don't).

## Layout

```
src/
  components/
    CitySelector.tsx        # sidebar: region accordions + warning banner
    RegionAccordion.tsx     # one collapsible region group
    CityMap.tsx             # per-city SVG group (boundary, clipped roads, label)
    MapCanvas.tsx           # global scale, drag handling, grid/legend chrome
  hooks/
    useCityData.ts          # loads cities.json, lazy-fetches roads, owns visibility
  lib/
    regions.ts              # REGION_ORDER + bilingual labels
    colors.ts               # per-city color palette
  types/city.ts             # CityData / CityViewModel
scripts/
  extract-urban-areas.js    # seeds + Natural Earth → cities.json
  fetch-roads-overpass.js   # Overpass scraping
  stitch-roads.js           # ways → continuous polylines
public/data/
  cities.json               # 79 cities, geometry + metadata (~400 KB)
  roads/<id>.json           # raw fetched roads, per city
  roads-stitched/<id>.json  # post-stitch polylines, the file the app actually reads
```

## Non-obvious conventions

A few things that look like bugs but aren't:

- **`bbox` is `[minLat, maxLat, minLon, maxLon]`** — not the GeoJSON `[W, S, E, N]` convention. Everything in this repo uses this order; don't swap.
- **Geometry is `Polygon | MultiPolygon`.** Cities split by water (NYC, Hong Kong) come out as MultiPolygon; single-piece cities as Polygon. Consumers must handle both.
- **`areaKm2` is the area of the drawn polygon**, not an external "official" city size — it's summed from Natural Earth's `area_sqkm` over all matched features. Intentional: linear dimensions track √areaKm2, which is what makes the equal-scale comparison meaningful.
- **`MAX_TILE_KM2 = 8000`** in the fetcher. Originally 12,000; lowered after Overpass started returning truncated JSON for ~10k km² single-tile queries. Most large metros now split 2×2 or 3×3.
- **Stitcher quantization is 1 cm** (`QUANT = 1e7`). OSM node coordinates match exactly at shared endpoints — there's no tolerance fallback. If neighboring cities' ways don't stitch, the upstream fetch missed the connecting way, usually at a bbox boundary.

## Repository size

`public/data/` is **~525 MB** (264 MB raw roads + 258 MB stitched). The largest single file is `tokyo.json` at 27 MB. The data is committed so the app runs out of the box — no API keys, no separate data download. If repo size becomes an issue, candidates for moving out:

- The `roads/` raw directory — only `roads-stitched/` is read at runtime.
- Git LFS for files > 10 MB.

## Credits

- **Boundaries** — [Natural Earth](https://www.naturalearthdata.com/) `ne_10m_urban_areas` (public domain).
- **Roads** — © OpenStreetMap contributors, queried via [Overpass API](https://overpass-api.de/) (ODbL).
- **UI primitives** — [shadcn/ui](https://ui.shadcn.com/) (MIT).
