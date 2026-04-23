import type { CityViewModel } from '@/types/city';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Eye, EyeOff, MapPin, RotateCcw, CheckSquare, Square } from 'lucide-react';

interface CitySelectorProps {
  cities: CityViewModel[];
  onToggle: (id: string) => void;
  onReset: () => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export function CitySelector({
  cities,
  onToggle,
  onReset,
  onSelectAll,
  onClearAll,
}: CitySelectorProps) {
  const visibleCount = cities.filter((c) => c.visible).length;

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
          onClick={onSelectAll}
        >
          <CheckSquare className="w-3 h-3 mr-1" />
          全选
        </Button>
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

      <ScrollArea className="flex-1">
        <div className="px-2 pb-4 space-y-1">
          {cities.map((city) => (
            <button
              key={city.id}
              onClick={() => onToggle(city.id)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all
                ${
                  city.visible
                    ? 'bg-neutral-50 hover:bg-neutral-100'
                    : 'hover:bg-neutral-50/50 opacity-40'
                }
              `}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0 ring-1 ring-black/10"
                style={{
                  backgroundColor: city.visible ? city.color : 'transparent',
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-neutral-800 font-medium truncate">
                  {city.nameZh}
                </div>
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
              {city.visible ? (
                <Eye className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              ) : (
                <EyeOff className="w-3.5 h-3.5 text-neutral-200 shrink-0" />
              )}
            </button>
          ))}
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-black/5 text-[9px] text-neutral-300 text-center font-mono leading-relaxed">
        Data: Natural Earth
        <br />
        Urban built-up areas
      </div>
    </div>
  );
}
