# Regional City Grouping Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize the city sidebar into a 6-region collapsible accordion (China standalone, Asia incl. Oceania, Europe, North America, South America, Africa) so the catalog can grow to ~60–100 cities without navigation or runtime degradation.

**Architecture:** Grouping is a pure view-layer transform over the existing flat `cities` array. `useCityData` keeps flat state indexed by `id`; `CitySelector` groups by `city.region` for rendering. A new `RegionAccordion` component wraps each group. A soft visibility cap of 12 warns (not blocks) on overflow.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, shadcn/ui (accordion + checkbox primitives already installed), Radix, d3. No new dependencies.

**Design doc:** [docs/plans/2026-04-23-regional-city-grouping-design.md](./2026-04-23-regional-city-grouping-design.md)

---

## Preconditions

- **No git repo.** Before starting: `cd city-scale-compare && git init && git add -A && git commit -m "chore: baseline before regional grouping refactor"`. If skipped, treat each "commit" step below as a logical stopping point instead.
- **No test framework.** Verification is: `pnpm tsc -b` (type check), `pnpm lint`, and manual browser check via `pnpm dev`. No unit tests to write or run.
- **Dev server:** `pnpm dev` → http://localhost:5173. Keep it running during UI tasks; Vite HMR reloads on save.

---

## Task 1: Add `region` to types

**Files:**
- Modify: `src/types/city.ts`

**Step 1:** Open `src/types/city.ts` and add the `Region` union + `region` field on `CityData`.

```ts
export type Region =
  | 'china'
  | 'asia'
  | 'europe'
  | 'north-america'
  | 'south-america'
  | 'africa';

export interface CityData {
  // ... existing fields
  region: Region;
  // ...
}
```

Place `region` next to `country`.

**Step 2:** Run type check — it will fail because `cities.json` doesn't yet have `region`, but nothing in `src/` reads `city.region` yet so the compile error is expected only if TS treats the JSON import as structurally checked.

Run: `pnpm tsc -b`
Expected: either passes (JSON is typed as `any` via fetch), or fails only in hook layer — note errors but continue; Task 4 resolves them.

**Step 3:** Commit.

```bash
git add src/types/city.ts
git commit -m "feat(types): add Region union and region field to CityData"
```

---

## Task 2: Add region labels + ordering

**Files:**
- Create: `src/lib/regions.ts`

**Step 1:** Create the file with order + labels.

```ts
import type { Region } from '@/types/city';

export const REGION_ORDER: Region[] = [
  'china',
  'asia',
  'europe',
  'north-america',
  'south-america',
  'africa',
];

export const REGION_LABELS: Record<Region, { zh: string; en: string }> = {
  china:           { zh: '中国', en: 'China' },
  asia:            { zh: '亚洲', en: 'Asia' },
  europe:          { zh: '欧洲', en: 'Europe' },
  'north-america': { zh: '北美', en: 'North America' },
  'south-america': { zh: '南美', en: 'South America' },
  africa:          { zh: '非洲', en: 'Africa' },
};
```

**Step 2:** Type check.

Run: `pnpm tsc -b`
Expected: PASS (file is self-contained).

**Step 3:** Commit.

```bash
git add src/lib/regions.ts
git commit -m "feat(regions): add region order and bilingual labels"
```

---

## Task 3: Add `region` to city seeds in the extractor

**Files:**
- Modify: `scripts/extract-urban-areas.js`

**Step 1:** Open `scripts/extract-urban-areas.js`. Find the `cities` array (the seed list of 15 cities). Add `region: '<region-id>'` to each entry. Assignments for the existing 15:

| City | region |
|------|--------|
| beijing, shanghai, xian | `china` |
| tokyo, seoul, singapore, mumbai, dubai, sydney | `asia` |
| london, paris, moscow | `europe` |
| new-york, los-angeles | `north-america` |
| cairo | `africa` |
| sao-paulo | `south-america` |

**Step 2:** In the emit step at the bottom of the script (the loop that writes each city's output object), ensure `region: city.region` is included in the emitted object.

**Step 3:** Regenerate `cities.json`.

Run: `node scripts/extract-urban-areas.js`
Expected: prints matched urban polygons for each city; produces `public/data/cities.json` with `region` on every entry.

**Step 4:** Verify.

Run: `node -e "const c=require('./public/data/cities.json'); console.log(c.map(x=>x.id+':'+x.region).join('\n'))"`
Expected: every city has a region string.

**Step 5:** Commit.

```bash
git add scripts/extract-urban-areas.js public/data/cities.json
git commit -m "feat(data): add region field to city seeds and regenerate cities.json"
```

---

## Task 4: Hook — add VISIBLE_CAP + warning state

**Files:**
- Modify: `src/hooks/useCityData.ts`

**Step 1:** At the top of the hook file, add the constant.

```ts
const VISIBLE_CAP = 12;
```

**Step 2:** Add `warning` state and an auto-clearing setter.

```ts
const [warning, setWarning] = useState<string | null>(null);
const warningTimerRef = useRef<number | null>(null);

const flashWarning = (msg: string) => {
  setWarning(msg);
  if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current);
  warningTimerRef.current = window.setTimeout(() => setWarning(null), 4000);
};
```

Add `useRef` to the React imports if not already there.

**Step 3:** Modify `toggleCity` to flash warning when exceeding cap.

```ts
const toggleCity = (id: string) => {
  setCities((prev) => {
    const target = prev.find((c) => c.id === id);
    if (!target) return prev;
    const willBeVisible = !target.visible;
    if (willBeVisible) {
      const visibleCount = prev.filter((c) => c.visible).length;
      if (visibleCount >= VISIBLE_CAP) {
        flashWarning(`已选 ${visibleCount + 1} 个城市，叠加过多可能影响阅读`);
      }
    }
    return prev.map((c) => (c.id === id ? { ...c, visible: willBeVisible } : c));
  });
};
```

**Step 4:** Type check + lint.

Run: `pnpm tsc -b && pnpm lint`
Expected: PASS.

**Step 5:** Commit.

```bash
git add src/hooks/useCityData.ts
git commit -m "feat(hook): add VISIBLE_CAP soft warning to toggleCity"
```

---

## Task 5: Hook — add `toggleRegion`, remove `selectAll`

**Files:**
- Modify: `src/hooks/useCityData.ts`

**Step 1:** Add `toggleRegion` next to `toggleCity`.

```ts
import type { Region } from '@/types/city';

const toggleRegion = (region: Region, nextVisible: boolean) => {
  setCities((prev) => {
    const next = prev.map((c) =>
      c.region === region ? { ...c, visible: nextVisible } : c
    );
    if (nextVisible) {
      const visibleCount = next.filter((c) => c.visible).length;
      if (visibleCount > VISIBLE_CAP) {
        flashWarning(`已选 ${visibleCount} 个城市，叠加过多可能影响阅读`);
      }
    }
    return next;
  });
};
```

**Step 2:** Remove `selectAll` from the hook body and from the returned object. Keep `clearAll`.

**Step 3:** Return `warning` and `toggleRegion` from the hook.

```ts
return {
  cities,
  loading,
  error,
  warning,
  toggleCity,
  toggleRegion,
  setOffset,
  resetOffsets,
  clearAll,
};
```

**Step 4:** Type check + lint.

Run: `pnpm tsc -b && pnpm lint`
Expected: fails at `CitySelector.tsx` (still references `onSelectAll`). Will fix in Task 7.

**Step 5:** Commit.

```bash
git add src/hooks/useCityData.ts
git commit -m "feat(hook): add toggleRegion bulk toggle and remove selectAll"
```

---

## Task 6: Create `RegionAccordion` component

**Files:**
- Create: `src/components/RegionAccordion.tsx`

**Step 1:** Write the component. It takes pre-filtered cities for one region; parent (`CitySelector`) does the grouping.

```tsx
import type { CityViewModel, Region } from '@/types/city';
import { REGION_LABELS } from '@/lib/regions';
import { ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';

interface RegionAccordionProps {
  region: Region;
  cities: CityViewModel[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleCity: (id: string) => void;
  onToggleRegion: (region: Region, nextVisible: boolean) => void;
}

export function RegionAccordion({
  region,
  cities,
  expanded,
  onToggleExpanded,
  onToggleCity,
  onToggleRegion,
}: RegionAccordionProps) {
  const visibleCount = cities.filter((c) => c.visible).length;
  const allVisible = visibleCount === cities.length && cities.length > 0;
  const someVisible = visibleCount > 0 && !allVisible;
  const label = REGION_LABELS[region];

  const onCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleRegion(region, !allVisible);
  };

  return (
    <div className="mb-1">
      <div
        onClick={onToggleExpanded}
        className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-neutral-50 cursor-pointer select-none"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-neutral-800">{label.zh}</div>
          <div className="text-[10px] text-neutral-400">{label.en}</div>
        </div>
        <div className="text-[10px] text-neutral-400 font-mono shrink-0">
          {visibleCount} / {cities.length}
        </div>
        <button
          onClick={onCheckboxClick}
          className={`
            w-4 h-4 rounded border shrink-0 flex items-center justify-center
            ${allVisible ? 'bg-neutral-800 border-neutral-800'
              : someVisible ? 'bg-neutral-400 border-neutral-400'
              : 'border-neutral-300 bg-white'}
          `}
          aria-label={allVisible ? 'deselect region' : 'select region'}
        >
          {allVisible && <svg viewBox="0 0 12 12" className="w-3 h-3 text-white fill-current"><path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>}
          {someVisible && <div className="w-2 h-0.5 bg-white" />}
        </button>
      </div>

      {expanded && (
        <div className="pl-2 space-y-1 mt-1">
          {cities.map((city) => (
            <button
              key={city.id}
              onClick={() => onToggleCity(city.id)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all
                ${city.visible
                  ? 'bg-neutral-50 hover:bg-neutral-100'
                  : 'hover:bg-neutral-50/50 opacity-40'}
              `}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0 ring-1 ring-black/10"
                style={{ backgroundColor: city.visible ? city.color : 'transparent' }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-neutral-800 font-medium truncate">{city.nameZh}</div>
                <div className="text-[10px] text-neutral-400 truncate">
                  {city.name}, {city.country}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] text-neutral-400 font-mono">
                  {city.areaKm2.toLocaleString()}
                </div>
                <div className="text-[9px] text-neutral-300">km²</div>
              </div>
              {city.visible
                ? <Eye className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                : <EyeOff className="w-3.5 h-3.5 text-neutral-200 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2:** Type check.

Run: `pnpm tsc -b`
Expected: PASS (component is self-contained; `CitySelector` doesn't import it yet).

**Step 3:** Commit.

```bash
git add src/components/RegionAccordion.tsx
git commit -m "feat(ui): add RegionAccordion with tri-state region checkbox"
```

---

## Task 7: Refactor `CitySelector` to use accordion

**Files:**
- Modify: `src/components/CitySelector.tsx`

**Step 1:** Update props and replace the flat `cities.map` with a `REGION_ORDER.map`. Full rewrite of the component body is expected.

```tsx
import { useState, useMemo } from 'react';
import type { CityViewModel, Region } from '@/types/city';
import { REGION_ORDER } from '@/lib/regions';
import { RegionAccordion } from './RegionAccordion';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MapPin, RotateCcw, Square } from 'lucide-react';

interface CitySelectorProps {
  cities: CityViewModel[];
  warning: string | null;
  onToggleCity: (id: string) => void;
  onToggleRegion: (region: Region, nextVisible: boolean) => void;
  onReset: () => void;
  onClearAll: () => void;
}

export function CitySelector({
  cities,
  warning,
  onToggleCity,
  onToggleRegion,
  onReset,
  onClearAll,
}: CitySelectorProps) {
  const visibleCount = cities.filter((c) => c.visible).length;

  // Group cities by region
  const byRegion = useMemo(() => {
    const map = new Map<Region, CityViewModel[]>();
    for (const r of REGION_ORDER) map.set(r, []);
    for (const c of cities) map.get(c.region)?.push(c);
    return map;
  }, [cities]);

  // Default-expanded: any region containing a visible city at first mount
  const [expanded, setExpanded] = useState<Set<Region>>(() => {
    const s = new Set<Region>();
    for (const c of cities) if (c.visible) s.add(c.region);
    return s;
  });

  const toggleExpanded = (r: Region) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r); else next.add(r);
      return next;
    });
  };

  return (
    <div className="w-72 h-full bg-white border-r border-black/5 flex flex-col">
      <div className="p-4 border-b border-black/5">
        <h1 className="text-lg font-bold text-neutral-900 tracking-tight flex items-center gap-2">
          <MapPin className="w-5 h-5 text-neutral-400" />
          城市尺度对比
        </h1>
        <p className="text-xs text-neutral-400 mt-1">
          Equal-scale urban area comparison
        </p>
      </div>

      <div className="px-3 py-2 flex gap-2 border-b border-black/5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[10px] text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 px-2"
          onClick={onClearAll}
        >
          <Square className="w-3 h-3 mr-1" />
          清空
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[10px] text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 px-2 ml-auto"
          onClick={onReset}
        >
          <RotateCcw className="w-3 h-3 mr-1" />
          重置位置
        </Button>
      </div>

      <div className="px-4 py-2 text-[10px] text-neutral-300 uppercase tracking-wider font-mono">
        {visibleCount} / {cities.length} cities selected
      </div>

      {warning && (
        <div className="mx-3 mb-2 px-3 py-2 text-[11px] bg-amber-50 text-amber-700 rounded-md border border-amber-200">
          {warning}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="px-2 pb-4">
          {REGION_ORDER.map((region) => {
            const regionCities = byRegion.get(region) ?? [];
            if (regionCities.length === 0) return null;
            return (
              <RegionAccordion
                key={region}
                region={region}
                cities={regionCities}
                expanded={expanded.has(region)}
                onToggleExpanded={() => toggleExpanded(region)}
                onToggleCity={onToggleCity}
                onToggleRegion={onToggleRegion}
              />
            );
          })}
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-black/5 text-[9px] text-neutral-300 text-center font-mono leading-relaxed">
        Data: Natural Earth<br />Urban built-up areas
      </div>
    </div>
  );
}
```

**Step 2:** Type check — will fail at `App.tsx` (or wherever `CitySelector` is used) because props changed.

Run: `pnpm tsc -b`
Expected: FAIL at the `<CitySelector .../>` call site. Task 8 fixes it.

**Step 3:** Commit.

```bash
git add src/components/CitySelector.tsx
git commit -m "feat(ui): group CitySelector by region using RegionAccordion"
```

---

## Task 8: Wire new hook returns into `App.tsx`

**Files:**
- Modify: `src/App.tsx` (or wherever `useCityData` + `CitySelector` are wired)

**Step 1:** Locate the component that calls `useCityData()` and renders `<CitySelector>`.

Run: `grep -rn "useCityData\|CitySelector" src/ --include="*.tsx"`

**Step 2:** Update destructuring + props:

```tsx
const {
  cities, loading, error, warning,
  toggleCity, toggleRegion, setOffset, resetOffsets, clearAll,
} = useCityData();

// ...

<CitySelector
  cities={cities}
  warning={warning}
  onToggleCity={toggleCity}
  onToggleRegion={toggleRegion}
  onReset={resetOffsets}
  onClearAll={clearAll}
/>
```

Remove any `onSelectAll` references.

**Step 3:** Type check + lint.

Run: `pnpm tsc -b && pnpm lint`
Expected: PASS.

**Step 4:** Manual browser check.

Run: `pnpm dev` (if not already running) and open http://localhost:5173.

Verify:
- Sidebar shows 6 region accordions (empty ones hidden — only China, Asia, Europe, N.A., S.A., Africa should render with the existing 15 cities).
- China + Asia are expanded on load (because Beijing, Shanghai, Tokyo are visible).
- Clicking a region header expands/collapses it.
- Clicking the tri-state checkbox on a region selects/deselects all cities in that region.
- Clicking a city row still toggles that city.
- 清空 clears all. 重置位置 resets offsets.
- Map still renders Beijing/Shanghai/Tokyo by default.

**Step 5:** Commit.

```bash
git add src/App.tsx
git commit -m "feat(app): wire toggleRegion and warning into CitySelector"
```

---

## Task 9: Verify soft cap warning

**Files:** none (manual verification)

**Step 1:** In the browser, select cities until 12 are visible (e.g., click the Asia region checkbox — Asia has more than 12 once you add new cities, so for now use individual ticks across regions).

**Step 2:** Tick a 13th city.
Expected: amber warning banner appears below the "N / M cities selected" line with Chinese text. Banner auto-disappears after ~4 seconds. The 13th city IS still added (soft cap).

**Step 3:** Untick, re-tick. Warning re-flashes.

**Step 4:** No commit needed unless you tweak the warning text.

---

## Task 10 (optional, if adding new cities now): Seed + fetch new cities

Skip this task if you're only delivering the UI refactor in this pass.

**Files:**
- Modify: `scripts/extract-urban-areas.js` (append new city seeds with `region` set)

**Step 1:** Append new entries to the `cities` array. Each needs `id`, `name`, `nameZh`, `country`, `region`, `lat`, `lon`. Batch per region, 10–20 cities each.

**Step 2:** Run the full pipeline.

```bash
node scripts/extract-urban-areas.js
node scripts/fetch-roads-overpass.js    # multi-hour for a large batch
node scripts/stitch-roads.js
pnpm build
```

The fetcher skips cities whose `public/data/roads/<id>.json` already exists, so the batch is resumable across network blips.

**Step 3:** Spot-check in the browser. Each new region should populate; hidden cities don't download their road files.

**Step 4:** Commit in chunks per region to keep the history readable.

```bash
git add scripts/extract-urban-areas.js public/data/
git commit -m "feat(data): add <region> city seeds and fetch roads"
```

---

## Done criteria

- `pnpm tsc -b` passes.
- `pnpm lint` passes.
- Sidebar renders 6 region accordions with the correct groupings.
- Region tri-state checkbox selects/deselects all cities in the region.
- Warning banner appears when visible count exceeds 12 and auto-clears in 4s.
- Map canvas behavior (overlap, drag, scale) unchanged.
- No new npm dependencies.
