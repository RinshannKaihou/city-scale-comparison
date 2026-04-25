import { useState, useEffect, useRef } from 'react';
import type { CityViewModel, CityData, Region } from '@/types/city';
import { getCityColor } from '@/lib/colors';

const VISIBLE_CAP = 12;

export function useCityData() {
  const [cities, setCities] = useState<CityViewModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const warningTimerRef = useRef<number | null>(null);
  const loadedRef = useRef<Set<string>>(new Set());

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
      .then((data: CityData[]) => {
        const defaultOffsets: Record<string, { x: number; y: number }> = {
          beijing: { x: 0, y: 0 },
          shanghai: { x: -220, y: -160 },
          tokyo: { x: 240, y: -180 },
        };
        const viewModels: CityViewModel[] = data.map((city, i) => ({
          ...city,
          color: getCityColor(i),
          offset: defaultOffsets[city.id] || { x: 0, y: 0 },
          visible: i < 3,
        }));
        setCities(viewModels);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Load roads for visible cities
  useEffect(() => {
    const toLoad = cities.filter(
      (c) => c.visible && !c.roads && !loadedRef.current.has(c.id)
    );
    if (toLoad.length === 0) return;

    for (const c of toLoad) loadedRef.current.add(c.id);

    Promise.all(
      toLoad.map(async (city) => {
        try {
          const res = await fetch(`${import.meta.env.BASE_URL}data/roads-stitched/${city.id}.json`);
          if (!res.ok) return { id: city.id, roads: null };
          const roads = await res.json() as number[][][];
          return { id: city.id, roads };
        } catch {
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
