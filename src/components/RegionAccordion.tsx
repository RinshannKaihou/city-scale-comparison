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
          {allVisible && (
            <svg viewBox="0 0 12 12" className="w-3 h-3 text-white">
              <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          )}
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
