import { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Download, Image as ImageIcon } from 'lucide-react';
import type { CityViewModel } from '@/types/city';
import {
  buildRoadsGeom,
  computeGlobalScale,
  drawScene,
  getCityGeom,
  hitTest,
  type GeomCache,
  type Layout,
} from '@/lib/map-render';
import { exportPng, exportSvg } from '@/lib/export-map';

interface MapCanvasProps {
  cities: CityViewModel[];
  onOffsetChange: (id: string, offset: { x: number; y: number }) => void;
}

export function MapCanvas({ cities, onOffsetChange }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Projected/LOD geometry per city, keyed by id. Persists across renders and
  // visibility toggles so re-showing a city is instant. Never in React state —
  // this is the whole point of the canvas rewrite.
  const cacheRef = useRef<GeomCache>(new Map());
  const rafRef = useRef<number | null>(null);
  const buildRafRef = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const dragStartRef = useRef({
    x: 0,
    y: 0,
    offsetX: 0,
    offsetY: 0,
    pointerId: -1,
  });

  const visibleCities = useMemo(() => cities.filter((c) => c.visible), [cities]);

  const globalScale = useMemo(
    () => computeGlobalScale(cities, size.width, size.height),
    [cities, size],
  );

  const layout: Layout = useMemo(
    () => ({ width: size.width, height: size.height, globalScale }),
    [size, globalScale],
  );

  // Latest state mirrored into refs so the self-scheduling paint/build loops
  // (rAF callbacks) always read current values without re-subscribing. Synced
  // inside the effect below (mutating refs during render is disallowed).
  const citiesRef = useRef(cities);
  const layoutRef = useRef(layout);

  // Measure container size.
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

  // Stable imperative paint — reads refs, so it never goes stale.
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = layoutRef.current;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, citiesRef.current, layoutRef.current, cacheRef.current, {
      background: '#ffffff',
    });
  }, []);

  // Coalesce all redraw triggers (toggle, drag, roads build, resize) into one
  // rAF per frame. A hidden tab pauses rAF, so paint synchronously in that
  // case — otherwise the canvas would go stale (or never paint) while
  // backgrounded (also true of the headless preview).
  const schedulerPaint = useCallback(() => {
    if (rafRef.current != null) return;
    if (typeof requestAnimationFrame === 'undefined' || document.hidden) {
      paint();
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      paint();
    });
  }, [paint]);

  // Repaint when devicePixelRatio changes (window dragged to a display with
  // different scaling). paint() sizes the backing store from dpr, but neither
  // ResizeObserver (CSS size unchanged) nor any state change fires for this.
  // The media query matches only the current dpr, so re-subscribe after each
  // change.
  useEffect(() => {
    let mql: MediaQueryList | null = null;
    function onChange() {
      schedulerPaint();
      subscribe();
    }
    function subscribe() {
      mql?.removeEventListener('change', onChange);
      mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mql.addEventListener('change', onChange);
    }
    subscribe();
    return () => mql?.removeEventListener('change', onChange);
  }, [schedulerPaint]);

  // Sync refs, repaint, and drive the road-build pump whenever state changes.
  // Refs are set here (not during render) so the async rAF callbacks read the
  // latest values. The pump builds the heavy road geometry for ONE pending
  // city per frame, then repaints and reschedules — spreading a bulk
  // region-toggle (16+ cities) across frames instead of freezing the main
  // thread in a single multi-second build. A hidden tab pauses rAF, so it
  // falls back to building synchronously (a backgrounded tab / the headless
  // preview never sees a frozen UI anyway).
  useEffect(() => {
    citiesRef.current = cities;
    layoutRef.current = layout;
    schedulerPaint();

    // Self-recursive local pump; reads refs, so it stays current even if a
    // prior effect's pump is still in flight.
    const pump = () => {
      buildRafRef.current = null;
      const cache = cacheRef.current;
      const scale = layoutRef.current.globalScale;
      for (const city of citiesRef.current) {
        if (!city.visible || !city.roads) continue;
        const geom = getCityGeom(cache, city, scale);
        if (geom.roads) continue;
        geom.roads = buildRoadsGeom(
          city.roads,
          city.bbox,
          scale,
          geom.boundary.minSegPx,
        );
        paint();
        if (typeof requestAnimationFrame === 'undefined' || document.hidden) {
          pump();
        } else {
          buildRafRef.current = requestAnimationFrame(pump);
        }
        return;
      }
    };

    // Kick the pump only if one isn't already scheduled.
    if (buildRafRef.current == null) pump();
  }, [cities, layout, schedulerPaint, paint]);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (buildRafRef.current != null) cancelAnimationFrame(buildRafRef.current);
      // Null the refs after cancelling: schedulerPaint and the pump kick guard
      // on them, and a cancelled rAF never runs the callback that would reset
      // them — StrictMode's simulated unmount would otherwise wedge both loops
      // for the rest of the session.
      rafRef.current = null;
      buildRafRef.current = null;
    },
    [],
  );

  const scaleText = useMemo(() => {
    if (globalScale <= 0) return '';
    const metersPerPixel = 1 / globalScale;
    if (metersPerPixel < 1000) return `1 px ≈ ${Math.round(metersPerPixel)} m`;
    return `1 px ≈ ${(metersPerPixel / 1000).toFixed(1)} km`;
  }, [globalScale]);

  const pointerPos = (e: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const { x, y } = pointerPos(e);
      const id = hitTest(cities, layout, cacheRef.current, x, y);
      if (!id) return;
      const city = cities.find((c) => c.id === id);
      if (!city) return;
      e.preventDefault();
      // setPointerCapture can throw for a pointer the browser no longer
      // considers active; a failed capture shouldn't abort the drag.
      try {
        canvasRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      setDraggingId(id);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        offsetX: city.offset.x,
        offsetY: city.offset.y,
        pointerId: e.pointerId,
      };
    },
    [cities, layout],
  );

  // Hover cursor feedback when not dragging.
  const handlePointerMoveHover = useCallback(
    (e: React.PointerEvent) => {
      if (draggingId) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { x, y } = pointerPos(e);
      const id = hitTest(cities, layout, cacheRef.current, x, y);
      canvas.style.cursor = id ? 'grab' : 'default';
    },
    [cities, layout, draggingId],
  );

  useEffect(() => {
    if (!draggingId) return;

    const handleMove = (e: PointerEvent) => {
      if (e.pointerId !== dragStartRef.current.pointerId) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      onOffsetChange(draggingId, {
        x: dragStartRef.current.offsetX + dx,
        y: dragStartRef.current.offsetY + dy,
      });
    };
    const handleEnd = (e: PointerEvent) => {
      if (e.pointerId !== dragStartRef.current.pointerId) return;
      canvasRef.current?.releasePointerCapture?.(e.pointerId);
      setDraggingId(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
    };
  }, [draggingId, onOffsetChange]);

  const handleExport = useCallback(
    async (format: 'png' | 'svg') => {
      setExporting(true);
      try {
        if (format === 'png') {
          await exportPng(cities, layout, cacheRef.current, scaleText);
        } else {
          exportSvg(cities, layout, cacheRef.current, scaleText);
        }
      } catch (err) {
        toast.error('Export failed', {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setExporting(false);
      }
    },
    [cities, layout, scaleText],
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-white"
    >
      <canvas
        ref={canvasRef}
        className="block"
        style={{
          width: size.width,
          height: size.height,
          touchAction: 'none',
          cursor: draggingId ? 'grabbing' : 'default',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMoveHover}
      />

      {/* Scale indicator */}
      {scaleText && visibleCities.length > 0 && (
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
              <br />
              Drag any city outline to align with another.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
