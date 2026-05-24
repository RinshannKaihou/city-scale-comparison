import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import type { CityViewModel, Region } from '@/types/city';
import { getCityColor } from '@/lib/colors';
import { encode as encodeUrl, decode as decodeUrl } from '@/lib/url-state';
import { CitiesArraySchema, RoadsSchema, formatZodError } from '@/lib/schemas';

const VISIBLE_CAP = 12;

export function useCityData() {
  const [cities, setCities] = useState<CityViewModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const warningTimerRef = useRef<number | null>(null);
  const loadedRef = useRef<Set<string>>(new Set());
  // Guards URL writes during initial mount. Only flips true after the
  // first cities-state has been derived from fetch + URL hash.
  const hydratedRef = useRef(false);
  const urlWriteTimerRef = useRef<number | null>(null);

  const flashWarning = (msg: string) => {
    setWarning(msg);
    if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current);
    warningTimerRef.current = window.setTimeout(() => setWarning(null), 4000);
  };

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/cities.json`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load city data');
        return res.json();
      })
      .then((raw) => {
        // Validate the bundled cities.json against the Zod schema. If
        // someone ships a malformed cities.json from the data pipeline,
        // we want a clear error here, not undefined-render downstream.
        const data = CitiesArraySchema.parse(raw);

        const defaultOffsets: Record<string, { x: number; y: number }> = {
          beijing: { x: 0, y: 0 },
          shanghai: { x: -220, y: -160 },
          tokyo: { x: 240, y: -180 },
        };
        const urlState = decodeUrl(window.location.hash);
        const urlVisible = urlState ? new Set(urlState.visible) : null;

        const viewModels: CityViewModel[] = data.map((city, i) => {
          const urlOffset = urlState?.offsets[city.id];
          return {
            ...city,
            color: getCityColor(i),
            offset: urlOffset ?? defaultOffsets[city.id] ?? { x: 0, y: 0 },
            visible: urlVisible ? urlVisible.has(city.id) : i < 3,
          };
        });
        setCities(viewModels);
        setLoading(false);
        hydratedRef.current = true;
      })
      .catch((err) => {
        if (err instanceof z.ZodError) {
          setError(`cities.json failed validation — ${formatZodError(err)}`);
        } else {
          setError(err.message);
        }
        setLoading(false);
      });
  }, []);

  // Write state back to URL (debounced so drag doesn't flood history).
  // Uses replaceState — no back-button entry per change.
  useEffect(() => {
    if (!hydratedRef.current || cities.length === 0) return;
    if (urlWriteTimerRef.current) window.clearTimeout(urlWriteTimerRef.current);
    urlWriteTimerRef.current = window.setTimeout(() => {
      const next = encodeUrl({
        visible: cities.filter((c) => c.visible).map((c) => c.id),
        offsets: Object.fromEntries(
          cities.map((c) => [c.id, c.offset])
        ),
      });
      if (next !== window.location.hash) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`);
      }
    }, 250);
  }, [cities]);

  // Load roads for visible cities
  useEffect(() => {
    const toLoad = cities.filter(
      (c) => c.visible && !c.roads && !loadedRef.current.has(c.id)
    );
    if (toLoad.length === 0) return;

    for (const c of toLoad) loadedRef.current.add(c.id);

    // Roads are fetched from a configurable base URL so the 250 MB of
    // road JSON can live off-repo. Default points at the data repo's
    // GitHub Pages site; override with VITE_ROADS_BASE_URL or .env.local
    // to fetch from a local public/data/roads-stitched/ instead.
    const roadsBase = import.meta.env.VITE_ROADS_BASE_URL
      ?? `${import.meta.env.BASE_URL}data/roads-stitched/`;

    Promise.all(
      toLoad.map(async (city) => {
        try {
          const res = await fetch(`${roadsBase}${city.id}.json`);
          if (!res.ok) {
            toast.error(`无法加载 ${city.nameZh} 路网`, {
              description: `${city.name} · HTTP ${res.status}`,
            });
            return { id: city.id, roads: null };
          }
          const raw = await res.json();
          // Validate road shape. Catches malformed JSON from the data
          // repo (e.g. someone uploads a non-array) before render.
          const roads = RoadsSchema.parse(raw);
          return { id: city.id, roads };
        } catch (err) {
          const desc = err instanceof z.ZodError
            ? `${city.name} · 数据格式错误: ${formatZodError(err)}`
            : err instanceof Error
              ? `${city.name} · ${err.message}`
              : `${city.name} · ${String(err)}`;
          toast.error(`无法加载 ${city.nameZh} 路网`, { description: desc });
          return { id: city.id, roads: null };
        }
      })
    ).then((results) => {
      setCities((prev) =>
        prev.map((c) => {
          const update = results.find((r) => r.id === c.id);
          if (update && update.roads) {
            return { ...c, roads: update.roads };
          }
          return c;
        })
      );
    });
  }, [cities]);

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

  const setOffset = (id: string, offset: { x: number; y: number }) => {
    setCities((prev) =>
      prev.map((c) => (c.id === id ? { ...c, offset } : c))
    );
  };

  const resetOffsets = () => {
    setCities((prev) =>
      prev.map((c) => ({ ...c, offset: { x: 0, y: 0 } }))
    );
  };

  const clearAll = () => {
    setCities((prev) => prev.map((c) => ({ ...c, visible: false })));
  };

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
}
