import { useState, useEffect, useRef } from 'react';
import type { CityViewModel, CityData } from '@/types/city';
import { getCityColor } from '@/lib/colors';

export function useCityData() {
  const [cities, setCities] = useState<CityViewModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetch('/data/cities.json')
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
          const res = await fetch(`/data/roads-stitched/${city.id}.json`);
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
    setCities((prev) =>
      prev.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c))
    );
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

  const selectAll = () => {
    setCities((prev) => prev.map((c) => ({ ...c, visible: true })));
  };

  const clearAll = () => {
    setCities((prev) => prev.map((c) => ({ ...c, visible: false })));
  };

  return {
    cities,
    loading,
    error,
    toggleCity,
    setOffset,
    resetOffsets,
    selectAll,
    clearAll,
  };
}
