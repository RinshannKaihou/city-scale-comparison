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

  const byRegion = useMemo(() => {
    const map = new Map<Region, CityViewModel[]>();
    for (const r of REGION_ORDER) map.set(r, []);
    for (const c of cities) map.get(c.region)?.push(c);
    return map;
  }, [cities]);

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
