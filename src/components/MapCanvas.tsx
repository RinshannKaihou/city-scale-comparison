import { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import type { CityViewModel } from '@/types/city';
import { CityMap } from './CityMap';

interface MapCanvasProps {
  cities: CityViewModel[];
  onOffsetChange: (id: string, offset: { x: number; y: number }) => void;
}

export function MapCanvas({ cities, onOffsetChange }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });

  // Measure container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const visibleCities = useMemo(
    () => cities.filter((c) => c.visible),
    [cities]
  );

  // Scale by the admin polygon's bounding box. This is a proxy for the
  // city's *stated* area (areaKm2 in the legend) — bbox linear dimensions
  // track sqrt(areaKm2) closely across the dataset. Using road-network
  // extent here collapses all cities into ≈ the same size because the
  // Overpass fetch radius (10–20 km) is fixed per city, not proportional
  // to urban size.
  const globalScale = useMemo(() => {
    if (visibleCities.length === 0) return 0.01;

    let maxHalfWidth = 0;
    let maxHalfHeight = 0;

    for (const city of visibleCities) {
      const centerLat = (city.bbox[0] + city.bbox[1]) / 2;
      const metersPerDegLon = 111320 * Math.cos(centerLat * (Math.PI / 180));
      const metersPerDegLat = 110540;
      const widthMeters = (city.bbox[3] - city.bbox[2]) * metersPerDegLon;
      const heightMeters = (city.bbox[1] - city.bbox[0]) * metersPerDegLat;
      if (widthMeters / 2 > maxHalfWidth) maxHalfWidth = widthMeters / 2;
      if (heightMeters / 2 > maxHalfHeight) maxHalfHeight = heightMeters / 2;
    }

    const padding = 0.75;
    const scaleX = (size.width * padding) / (maxHalfWidth * 2 || 1);
    const scaleY = (size.height * padding) / (maxHalfHeight * 2 || 1);
    return Math.min(scaleX, scaleY);
  }, [visibleCities, size]);

  // Scale indicator text
  const scaleText = useMemo(() => {
    if (globalScale <= 0) return '';
    const metersPerPixel = 1 / globalScale;
    if (metersPerPixel < 1000) {
      return `1 px ≈ ${Math.round(metersPerPixel)} m`;
    }
    return `1 px ≈ ${(metersPerPixel / 1000).toFixed(1)} km`;
  }, [globalScale]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, cityId: string) => {
      e.preventDefault();
      const city = cities.find((c) => c.id === cityId);
      if (!city) return;
      setDraggingId(cityId);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        offsetX: city.offset.x,
        offsetY: city.offset.y,
      };
    },
    [cities]
  );

  useEffect(() => {
    if (!draggingId) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      onOffsetChange(draggingId, {
        x: dragStartRef.current.offsetX + dx,
        y: dragStartRef.current.offsetY + dy,
      });
    };

    const handleMouseUp = () => {
      setDraggingId(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingId, onOffsetChange]);

  // Grid lines
  const gridSpacing = 100;
  const gridLinesX = Array.from(
    { length: Math.ceil(size.width / gridSpacing) + 1 },
    (_, i) => i * gridSpacing
  );
  const gridLinesY = Array.from(
    { length: Math.ceil(size.height / gridSpacing) + 1 },
    (_, i) => i * gridSpacing
  );

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-white">
      <svg width={size.width} height={size.height} className="block">
        {/* Background grid */}
        <g opacity={0.15}>
          {gridLinesX.map((x) => (
            <line
              key={`vx-${x}`}
              x1={x}
              y1={0}
              x2={x}
              y2={size.height}
              stroke="#000000"
              strokeWidth={0.5}
            />
          ))}
          {gridLinesY.map((y) => (
            <line
              key={`hy-${y}`}
              x1={0}
              y1={y}
              x2={size.width}
              y2={y}
              stroke="#000000"
              strokeWidth={0.5}
            />
          ))}
        </g>

        {/* Center crosshair */}
        <g opacity={0.12}>
          <line
            x1={size.width / 2}
            y1={0}
            x2={size.width / 2}
            y2={size.height}
            stroke="#000000"
            strokeWidth={0.5}
            strokeDasharray="4 4"
          />
          <line
            x1={0}
            y1={size.height / 2}
            x2={size.width}
            y2={size.height / 2}
            stroke="#000000"
            strokeWidth={0.5}
            strokeDasharray="4 4"
          />
        </g>

        {/* City maps */}
        <g transform={`translate(${size.width / 2}, ${size.height / 2})`}>
          {visibleCities.map((city) => (
            <CityMap
              key={city.id}
              city={city}
              globalScale={globalScale}
              onMouseDown={handleMouseDown}
              isDragging={draggingId === city.id}
            />
          ))}
        </g>
      </svg>

      {/* Scale indicator */}
      {scaleText && (
        <div className="absolute bottom-4 left-4 text-xs text-black/40 font-mono bg-white/70 border border-black/10 px-3 py-1.5 rounded backdrop-blur-sm">
          {scaleText}
        </div>
      )}

      {/* Legend */}
      {visibleCities.length > 0 && (
        <div className="absolute bottom-4 right-4 bg-white/70 border border-black/10 backdrop-blur-sm rounded px-4 py-3 max-w-[200px]">
          <div className="text-[10px] text-black/40 uppercase tracking-wider mb-2 font-mono">
            Visible Cities
          </div>
          <div className="space-y-1.5">
            {visibleCities.map((city) => (
              <div key={city.id} className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
                  style={{ backgroundColor: city.color }}
                />
                <span className="text-xs text-black/70 truncate">
                  {city.nameZh} ({city.name})
                </span>
                <span className="text-[10px] text-black/30 ml-auto shrink-0">
                  {city.areaKm2.toLocaleString()} km²
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hint */}
      {visibleCities.length > 0 && !draggingId && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-xs text-black/25 font-mono pointer-events-none">
          Drag city outlines to reposition • All cities are at equal scale
        </div>
      )}
    </div>
  );
}
