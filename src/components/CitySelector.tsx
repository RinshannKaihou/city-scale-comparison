import { useState, useMemo } from 'react';
import type { CityViewModel, Region } from '@/types/city';
import { REGION_ORDER } from '@/lib/regions';
import { RegionAccordion } from './RegionAccordion';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MapPin, RotateCcw, Search, Square, X } from 'lucide-react';

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

  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  // Filter cities by name (en/zh), country, or id. Empty query = no filter.
  const filteredCities = useMemo(() => {
    if (!normalizedQuery) return cities;
    return cities.filter((c) =>
      c.name.toLowerCase().includes(normalizedQuery) ||
      c.nameZh.toLowerCase().includes(normalizedQuery) ||
      c.country.toLowerCase().includes(normalizedQuery) ||
      c.id.toLowerCase().includes(normalizedQuery)
    );
  }, [cities, normalizedQuery]);

  const byRegion = useMemo(() => {
    const map = new Map<Region, CityViewModel[]>();
    for (const r of REGION_ORDER) map.set(r, []);
    for (const c of filteredCities) map.get(c.region)?.push(c);
    return map;
  }, [filteredCities]);

  const [expanded, setExpanded] = useState<Set<Region>>(() => {
    const s = new Set<Region>();
    for (const c of cities) if (c.visible) s.add(c.region);
    return s;
  });

  // When a query is active, force-expand any region with matches so results
  // are visible without manual expansion. Don't mutate `expanded` itself —
  // we want the user's manual collapse state to return when query is cleared.
  const effectiveExpanded = useMemo(() => {
    if (!normalizedQuery) return expanded;
    const next = new Set(expanded);
    for (const [region, list] of byRegion) {
      if (list.length > 0) next.add(region);
    }
    return next;
  }, [expanded, normalizedQuery, byRegion]);

  const toggleExpanded = (r: Region) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r); else next.add(r);
      return next;
    });
  };

  return (
    <div className="w-full md:w-72 h-full max-md:max-h-[85vh] bg-white md:border-r border-black/5 flex flex-col">
      <div className="p-4 border-b border-black/5">
        <h1 className="text-lg font-bold text-neutral-900 tracking-tight flex items-center gap-2">
          <MapPin className="w-5 h-5 text-neutral-400" />
          城市尺度对比
        </h1>
        <p className="text-xs text-neutral-400 mt-1">
          Equal-scale urban area comparison
        </p>
      </div>

      <div className="px-3 py-2 border-b border-black/5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-300 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 / Search cities"
            className="w-full pl-7 pr-7 py-1.5 text-xs bg-neutral-50 border border-transparent rounded-md focus:outline-none focus:border-neutral-300 focus:bg-white placeholder:text-neutral-300"
            aria-label="Search cities"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100"
              aria-label="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
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
                expanded={effectiveExpanded.has(region)}
                onToggleExpanded={() => toggleExpanded(region)}
                onToggleCity={onToggleCity}
                onToggleRegion={onToggleRegion}
              />
            );
          })}
          {normalizedQuery && filteredCities.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-neutral-400">
              没有匹配的城市
              <div className="text-[10px] text-neutral-300 mt-1">No matching cities</div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-black/5 text-[9px] text-neutral-300 text-center font-mono leading-relaxed">
        Data: Natural Earth<br />Urban built-up areas
      </div>
    </div>
  );
}
