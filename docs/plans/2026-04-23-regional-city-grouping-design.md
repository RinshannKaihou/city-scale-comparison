# Regional City Grouping — Design

Date: 2026-04-23

## Goal

Reorganize the city sidebar from a flat ~15-city list into a collapsible accordion of six regions, to support scaling the city catalog to ~60–100 cities without degrading navigation or runtime performance.

## Regions

Six parents, in display order:

1. **China** — standalone (Beijing, Shanghai, Xi'an, Guangzhou, Shenzhen, Chengdu, Hangzhou, …)
2. **Asia** — includes Oceania (Tokyo, Seoul, Singapore, Mumbai, Dubai, Sydney, Melbourne, Auckland, …)
3. **Europe** — London, Paris, Moscow, Berlin, Madrid, Rome, Istanbul, …
4. **North America** — New York, Los Angeles, Chicago, Toronto, Mexico City, …
5. **South America** — São Paulo, Buenos Aires, Rio, Lima, Bogotá, …
6. **Africa** — Cairo, Lagos, Johannesburg, Nairobi, Casablanca, …

Middle East cities are folded into the neighboring region by geography (Dubai → Asia, Istanbul → Europe, Cairo → Africa) rather than carving a sparse 5th group.

## Architecture

Grouping is a **pure view-layer transform** over the existing flat `cities` array. The `useCityData` hook continues to own flat state indexed by `id`; `CitySelector` groups by `city.region` for rendering. This preserves the existing lazy-loading contract (road files fetch only on `visible`) and avoids touching `CityMap` / `MapCanvas`.

## Data model

Add `region` to each city seed in `scripts/extract-urban-areas.js` and pass it through to `public/data/cities.json`.

```ts
// src/types/city.ts
export type Region =
  | 'china'
  | 'asia'
  | 'europe'
  | 'north-america'
  | 'south-america'
  | 'africa';

export interface CityData {
  id: string;
  name: string;
  nameZh: string;
  country: string;
  region: Region;           // new
  lat: number;
  lon: number;
  areaKm2: number;
  bbox: [number, number, number, number];
  geojson: Polygon | MultiPolygon;
  // …existing fields
}
```

New file `src/lib/regions.ts`:

```ts
export const REGION_ORDER: Region[] = [
  'china', 'asia', 'europe', 'north-america', 'south-america', 'africa',
];

export const REGION_LABELS: Record<Region, { zh: string; en: string }> = {
  china:          { zh: '中国',     en: 'China' },
  asia:           { zh: '亚洲',     en: 'Asia' },
  europe:         { zh: '欧洲',     en: 'Europe' },
  'north-america':{ zh: '北美',     en: 'North America' },
  'south-america':{ zh: '南美',     en: 'South America' },
  africa:         { zh: '非洲',     en: 'Africa' },
};
```

## Hook changes — `useCityData.ts`

Three additions:

- **`VISIBLE_CAP = 12`** constant.
- **Soft-cap guard in `toggleCity`**: when flipping a city to visible and `visibleCount >= 12`, set a transient `warning` string; still flip (soft cap, not hard block).
- **`toggleRegion(region, nextVisible)`**: bulk set `visible` for every city whose `region === region`. If the resulting total exceeds 12, set `warning` once (not per city).
- **`warning: string | null`** returned by the hook; auto-cleared after ~4s by a `setTimeout` inside the setter.

`selectAll` is removed from the returned API. `clearAll` stays.

## UI — `CitySelector.tsx` + new `RegionAccordion.tsx`

Replace the flat `cities.map` in the scroll area with a `REGION_ORDER.map` rendering one `<RegionAccordion>` per region.

**`RegionAccordion` props**: `region`, `cities` (already filtered to this region), `expanded`, `onToggleExpanded`, `onToggleCity`, `onToggleRegion`.

**Header row** (always rendered):
- Chevron (`ChevronDown` expanded / `ChevronRight` collapsed)
- Region label: `nameZh` primary, `en` secondary
- Count pill: `visibleInRegion / totalInRegion`
- Tri-state checkbox (all / some / none) — clicking calls `onToggleRegion`
- Clicking the non-checkbox area toggles expanded

**Expanded body**: reuse the existing per-city `<button>` markup verbatim (color dot, `nameZh` + `name, country`, `areaKm2`, eye icon). No visual change per row.

**Default-expanded regions**: any region containing at least one city with `visible === true` on initial mount. With today's defaults (Beijing, Shanghai, Tokyo), that's China and Asia. Subsequent expand/collapse is uncommitted in-memory state.

**Warning banner**: below the existing `"N / M cities selected"` line, render `{warning}` in amber (e.g., `bg-amber-50 text-amber-700`) when non-null.

**Header control strip**: remove 全选 button; keep 清空 and 重置位置.

No new dependencies. `ChevronDown` / `ChevronRight` come from the existing `lucide-react` import.

## Data pipeline

Only one change: the `cities` seed array in `scripts/extract-urban-areas.js` gets a `region` field per entry, and the emit step copies it into each output object. No changes to `fetch-roads-overpass.js` or `stitch-roads.js`.

Adding the ~60–80 new cities follows the existing "Adding a city" flow in `CLAUDE.md`. Network cost is the dominant factor: Overpass rate limits + Tokyo-style auto-tiling mean a multi-hour fetch for a large batch. The fetcher's skip-if-exists behavior makes this resumable.

## Out of scope (deferred)

- Search/filter input across cities — orthogonal to grouping; add later if the accordion alone feels slow to navigate.
- Persisting expanded/collapsed accordion state to `localStorage` — polish, not load-bearing.
- Reorganizing `defaultOffsets` in `useCityData.ts` for cities in non-Asian regions — cosmetic, tackle when new cities actually land.
- Hard visibility cap — soft warning is sufficient; revisit if users routinely ignore it.

## Files touched

- **Edit** — `src/types/city.ts` (add `Region`, extend `CityData`)
- **Add** — `src/lib/regions.ts` (order + labels)
- **Edit** — `src/hooks/useCityData.ts` (add `VISIBLE_CAP`, `toggleRegion`, `warning`; remove `selectAll`)
- **Edit** — `src/components/CitySelector.tsx` (group by region; remove 全选; render warning)
- **Add** — `src/components/RegionAccordion.tsx`
- **Edit** — `scripts/extract-urban-areas.js` (add `region` to seeds + emit)
- **Regenerated** — `public/data/cities.json` (via pipeline)
