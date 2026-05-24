import { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Download, Image as ImageIcon } from 'lucide-react';
import type { CityViewModel } from '@/types/city';
import { CityMap } from './CityMap';
import { exportPng, exportSvg } from '@/lib/export-svg';

interface MapCanvasProps {
  cities: CityViewModel[];
  onOffsetChange: (id: string, offset: { x: number; y: number }) => void;
}

export function MapCanvas({ cities, onOffsetChange }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const dragStartRef = useRef({
    x: 0,
    y: 0,
    offsetX: 0,
    offsetY: 0,
    pointerId: -1,
    target: null as Element | null,
  });

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

  // Pointer Events handle mouse, touch, and pen with one API. We capture the
  // pointer on pointerdown so a finger straying off the city hit-area keeps
  // dragging. touch-action: none on the SVG (below) tells the browser not to
  // interpret the gesture as a pan/zoom.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent, cityId: string) => {
      e.preventDefault();
      const city = cities.find((c) => c.id === cityId);
      if (!city) return;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      setDraggingId(cityId);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        offsetX: city.offset.x,
        offsetY: city.offset.y,
        pointerId: e.pointerId,
        target,
      };
    },
    [cities]
  );

  useEffect(() => {
    if (!draggingId) return;

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerId !== dragStartRef.current.pointerId) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      onOffsetChange(draggingId, {
        x: dragStartRef.current.offsetX + dx,
        y: dragStartRef.current.offsetY + dy,
      });
    };

    const handlePointerEnd = (e: PointerEvent) => {
      if (e.pointerId !== dragStartRef.current.pointerId) return;
      const { target, pointerId } = dragStartRef.current;
      if (target && target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      setDraggingId(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, [draggingId, onOffsetChange]);

  const handleExport = useCallback(
    async (format: 'png' | 'svg') => {
      if (!svgRef.current) return;
      setExporting(true);
      try {
        if (format === 'png') {
          await exportPng(svgRef.current, scaleText);
        } else {
          exportSvg(svgRef.current, scaleText);
        }
      } catch (err) {
        toast.error(`Export failed`, {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setExporting(false);
      }
    },
    [scaleText]
  );

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
      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        className="block"
        style={{ touchAction: 'none' }}
      >
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
              onPointerDown={handlePointerDown}
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

      {/* Export toolbar */}
      {visibleCities.length > 0 && (
        <div className="absolute top-4 right-4 flex gap-1 bg-white/70 border border-black/10 backdrop-blur-sm rounded">
          <button
            onClick={() => handleExport('png')}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100/70 disabled:opacity-50 disabled:cursor-wait rounded-l"
            aria-label="Export current view as PNG"
            title="Export as PNG (2× scale)"
          >
            <ImageIcon className="w-3 h-3" />
            PNG
          </button>
          <button
            onClick={() => handleExport('svg')}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100/70 disabled:opacity-50 disabled:cursor-wait rounded-r border-l border-black/5"
            aria-label="Export current view as SVG"
            title="Export as SVG (vector)"
          >
            <Download className="w-3 h-3" />
            SVG
          </button>
        </div>
      )}

      {/* Empty state */}
      {visibleCities.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center max-w-sm px-6">
            <div className="text-neutral-400 text-sm mb-2">
              选择左侧城市开始对比
            </div>
            <div className="text-neutral-300 text-xs font-mono leading-relaxed">
              Open the sidebar and toggle cities to overlap them at equal scale.
              <br />Drag any city outline to align with another.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
