import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { OrthographicView, type PickingInfo } from "@deck.gl/core";
import type { Bounds, DataIndex, Entry } from "./data";
import { dataUrl, loadBoundary, loadIndex, loadManifest, loadRoads, loadStats } from "./data";
import type { EntryGeometry, LayerInput, Show } from "./layers";
import { buildLayers, GRID_STYLE, MINOR_MAX_MPP, overlayStyle } from "./layers";
import { MetricsPanel } from "./MetricsPanel";
import { assignSlots, MAX_SELECTED, OVERLAY_SLOTS, REGIONS, slotHex } from "./palette";

// Default framing: ±130 km around the anchor holds every entry, including the
// Pearl River Delta seen from Guangzhou (reach 126 km). Zoom is free.
const DEFAULT_HALF_M = 130_000;
const DEFAULT_SELECTED = ["tokyo", "paris", "beijing"];
const GAP = 8; // px between small-multiple panels

type Mode = "overlay" | "grid";

interface View {
  pan: [number, number]; // metres from each entry's anchor (shared by all panels)
  zoom: number;
}

interface Panel {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Bounds, b: Bounds) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const fitZoom = (w: number, h: number) => Math.log2(Math.min(w, h) / (2 * DEFAULT_HALF_M));

function niceLength(maxMetres: number): number {
  const p = 10 ** Math.floor(Math.log10(maxMetres));
  for (const m of [5, 2, 1]) if (m * p <= maxMetres) return m * p;
  return p;
}
const fmtLen = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);

/** Most-square grid of n panels in a w×h box. */
function gridLayout(ids: string[], w: number, h: number): Panel[] {
  const n = ids.length;
  if (!n) return [];
  let best = { cols: 1, rows: n, side: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const side = Math.min((w - GAP * (cols - 1)) / cols, (h - GAP * (rows - 1)) / rows);
    if (side > best.side) best = { cols, rows, side };
  }
  const pw = (w - GAP * (best.cols - 1)) / best.cols;
  const ph = (h - GAP * (best.rows - 1)) / best.rows;
  return ids.map((id, i) => ({ id, x: (i % best.cols) * (pw + GAP), y: Math.floor(i / best.cols) * (ph + GAP), width: pw, height: ph }));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

// City browser order: by region, or ranked by one metric (all entries, flat).
const SORTS: { key: string; label: string; value?: (e: Entry) => number; fmt?: (e: Entry) => string }[] = [
  { key: "region", label: "按区域" },
  { key: "area", label: "面积", value: (e) => e.a.area_km2, fmt: (e) => `${e.a.area_km2.toLocaleString()} km²` },
  { key: "pop", label: "人口", value: (e) => e.a.pop, fmt: (e) => `${(e.a.pop / 1e6).toFixed(1)} M` },
  { key: "density", label: "人口密度", value: (e) => e.metrics.density, fmt: (e) => `${e.metrics.density.toLocaleString()} /km²` },
  { key: "coverage", label: "建筑覆盖率", value: (e) => e.metrics.coverage, fmt: (e) => `${Math.round(e.metrics.coverage * 100)}%` },
  { key: "volume", label: "体量密度", value: (e) => e.metrics.volume_density, fmt: (e) => `${e.metrics.volume_density.toFixed(2)} m³/m²` },
  { key: "height", label: "平均建筑高度", value: (e) => e.metrics.avg_height_m, fmt: (e) => `${e.metrics.avg_height_m.toFixed(1)} m` },
  { key: "footprint", label: "建筑尺度", value: (e) => e.metrics.footprint_wmedian_m2, fmt: (e) => `${e.metrics.footprint_wmedian_m2.toLocaleString()} m²` },
  { key: "cluster", label: "建筑群尺度", value: (e) => e.metrics.cluster_wmedian_m2, fmt: (e) => `${e.metrics.cluster_wmedian_m2.toLocaleString()} m²` },
];

interface Group {
  region: string;
  label: string;
  items: Entry[];
}

// 78 rows that only change with the selection, search or sort — memoised so
// panning or dragging the map does not re-render the list every frame.
const CityBrowser = memo(function CityBrowser({
  groups,
  selected,
  slots,
  sort,
  onToggle,
}: {
  groups: Group[];
  selected: string[];
  slots: Record<string, number>;
  sort: (typeof SORTS)[number];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="browser">
      {groups.map((g) => (
        <div key={g.region}>
          <div className="group-title">{g.label}</div>
          {g.items.map((e, i) => {
            const on = selected.includes(e.id);
            const full = !on && selected.length >= MAX_SELECTED;
            return (
              <div key={e.id} className={`city${on ? " on" : ""}${full ? " full" : ""}`} onClick={() => !full && onToggle(e.id)}>
                {sort.value && <span className="rank">{i + 1}</span>}
                <span className="chip" style={{ background: on ? slotHex(slots[e.id]) : "transparent" }} />
                <span className="city-name">
                  {e.display}
                  {(sort.key === "footprint" || sort.key === "cluster") && e.metrics.bldg_incomplete && " ⚑"}
                </span>
                <span className="city-num">{sort.fmt ? sort.fmt(e) : `${e.a.area_km2.toLocaleString()} km²`}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
});

export default function App() {
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("overlay");
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTED);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("region");
  const [offsets, setOffsets] = useState<Record<string, [number, number]>>({});
  const [show, setShow] = useState<Show>({ roads: true, density: true, boundary: true });
  const [size, setSize] = useState({ width: 900, height: 800 });
  const [view, setView] = useState<View>({ pan: [0, 0], zoom: -8.6 });
  const [dragging, setDragging] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<{ fps: number; cpu: number } | null>(null);
  const [, setTick] = useState(0); // bumped when async geometry lands
  const geometry = useRef<Record<string, EntryGeometry>>({});
  const inflight = useRef(new Set<string>());
  const slotsRef = useRef<Record<string, number>>({});
  const dragRef = useRef<{ id: string; start: [number, number]; startOffset: [number, number] } | null>(null);
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadIndex().then(setIndex, (e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byId = useMemo(() => new Map(index?.entries.map((e) => [e.id, e]) ?? []), [index]);
  const selKey = selected.join();
  const slots = useMemo(() => (slotsRef.current = assignSlots(selected, slotsRef.current)), [selKey]);
  const shownIds = useMemo(
    () => (mode === "overlay" ? selected.filter((id) => slots[id] < OVERLAY_SLOTS) : selected),
    [mode, selKey, slots],
  );
  const shown = useMemo(() => shownIds.map((id) => byId.get(id)).filter((e): e is Entry => !!e), [shownIds, byId]);
  const selectedEntries = useMemo(() => selected.map((id) => byId.get(id)).filter((e): e is Entry => !!e), [selKey, byId]);
  const panels = useMemo(() => (mode === "grid" ? gridLayout(shownIds, size.width, size.height) : []), [mode, shownIds, size]);

  // Fit ±130 km in the canvas (overlay) or in one panel (grid).
  const fit = useCallback(() => {
    const box = mode === "grid" && panels[0] ? panels[0] : size;
    setView({ pan: [0, 0], zoom: fitZoom(box.width, box.height) });
  }, [mode, panels, size]);
  const fittedFor = useRef("");
  useEffect(() => {
    const key = `${mode}|${panels.length}|${Math.round(size.width / 50)}|${Math.round(size.height / 50)}`;
    if (size.width < 200 || fittedFor.current === key) return;
    fittedFor.current = key;
    fit();
  }, [mode, panels.length, size, fit]);

  // Manifest → boundary + major roads for every shown entry (≤4 MB each).
  useEffect(() => {
    const once = (key: string, job: () => Promise<void>) => {
      if (inflight.current.has(key)) return;
      inflight.current.add(key);
      job().then(() => setTick((t) => t + 1), (err) => console.error(key, err));
    };
    for (const entry of shown) {
      const g = (geometry.current[entry.id] ??= { minor: new Map() });
      once(`${entry.id}/boundary`, async () => {
        g.boundary = await loadBoundary(entry);
      });
      once(`${entry.id}/manifest`, async () => {
        g.manifest = await loadManifest(entry);
        g.major = await loadRoads(dataUrl(entry.id, g.manifest.roads.major.file));
      });
    }
  }, [shown]);

  const mpp = 2 ** -view.zoom;

  // Residential chunks on screen, per entry, in that entry's own frame. The
  // chunk list lives in each entry's manifest (a ref, filled asynchronously),
  // so its arrival is part of the memo key.
  const manifestsKey = shown.map((e) => (geometry.current[e.id]?.manifest ? 1 : 0)).join();
  const minorFiles = useMemo(() => {
    const out: Record<string, string[]> = {};
    if (mpp >= MINOR_MAX_MPP) return out;
    for (const entry of shown) {
      const chunks = geometry.current[entry.id]?.manifest?.roads.minor.chunks;
      if (!chunks) continue;
      const panel = panels.find((p) => p.id === entry.id);
      const w = panel?.width ?? size.width;
      const h = panel?.height ?? size.height;
      const [dx, dy] = mode === "overlay" ? (offsets[entry.id] ?? [0, 0]) : [0, 0];
      const cx = view.pan[0] - dx;
      const cy = view.pan[1] - dy;
      const local: Bounds = [cx - (w / 2) * mpp, cy - (h / 2) * mpp, cx + (w / 2) * mpp, cy + (h / 2) * mpp];
      out[entry.id] = chunks.filter((c) => overlaps(c.bounds, local)).map((c) => c.file);
    }
    return out;
  }, [shown, panels, size, mode, offsets, view.pan, mpp, manifestsKey]);

  // Fetch only once the view has held still for 150 ms, so zooming through
  // levels or switching modes does not request chunks for transient views.
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const entry of shown) {
        const g = geometry.current[entry.id];
        if (!g) continue;
        for (const file of minorFiles[entry.id] ?? []) {
          const key = `${entry.id}/${file}`;
          if (g.minor.has(file) || inflight.current.has(key)) continue;
          inflight.current.add(key);
          loadRoads(dataUrl(entry.id, file)).then((s) => {
            g.minor.set(file, s);
            setTick((t) => t + 1);
          });
        }
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [shown, minorFiles]);

  // Overlay drag: only the dragged city's model matrix changes (a uniform);
  // its geometry stays on the GPU untouched.
  const drag = useMemo(
    () => ({
      onDragStart: (id: string, info: PickingInfo) => {
        if (!info.coordinate) return false;
        dragRef.current = { id, start: [info.coordinate[0], info.coordinate[1]], startOffset: offsetsRef.current[id] ?? [0, 0] };
        setDragging(id);
        return true;
      },
      onDrag: (info: PickingInfo) => {
        const d = dragRef.current;
        if (!d || !info.coordinate) return !!d;
        const [x, y] = info.coordinate;
        setOffsets((o) => ({ ...o, [d.id]: [d.startOffset[0] + x - d.start[0], d.startOffset[1] + y - d.start[1]] }));
        return true;
      },
      onDragEnd: () => {
        const was = !!dragRef.current;
        dragRef.current = null;
        setDragging(null);
        return was;
      },
    }),
    [],
  );

  const inputs: LayerInput[] = shown.map((entry) => ({
    entry,
    style: mode === "overlay" ? overlayStyle(slots[entry.id]) : GRID_STYLE,
    offset: mode === "overlay" ? (offsets[entry.id] ?? [0, 0]) : [0, 0],
    minorFiles: minorFiles[entry.id] ?? [],
  }));
  const layers = buildLayers(inputs, geometry.current, show, mpp, mode === "overlay" ? drag : null);

  const target: [number, number, number] = [view.pan[0], view.pan[1], 0];
  const views =
    mode === "overlay"
      ? [new OrthographicView({ id: "main", flipY: false, controller: { dragPan: !dragging, doubleClickZoom: false, inertia: false } })]
      : panels.map(
          (p) => new OrthographicView({ id: `v:${p.id}`, x: p.x, y: p.y, width: p.width, height: p.height, flipY: false, controller: { doubleClickZoom: false, inertia: false } }),
        );
  const viewState =
    mode === "overlay" ? { main: { target, zoom: view.zoom } } : Object.fromEntries(panels.map((p) => [`v:${p.id}`, { target, zoom: view.zoom }]));

  const toggle = useCallback(
    (id: string) =>
      setSelected((v) => (v.includes(id) ? v.filter((x) => x !== id) : v.length >= MAX_SELECTED ? v : [...v, id])),
    [],
  );

  // Test hooks for scripts/bench.mjs.
  useEffect(() => {
    (window as unknown as { __p2: object }).__p2 = { setView, setSelected, setOffsets, setMode, setSortKey, loadStats, metrics, size };
  }, [metrics, size]);

  const q = norm(query);
  const sort = SORTS.find((s) => s.key === sortKey)!;
  const groups = useMemo(() => {
    const hits = (index?.entries ?? []).filter(
      (e) => !q || norm(e.display).includes(q) || norm(e.name_en).includes(q) || norm(e.country).includes(q),
    );
    if (!sort.value) {
      return REGIONS.map(([region, label]) => ({ region, label, items: hits.filter((e) => e.region === region) })).filter(
        (g) => g.items.length,
      );
    }
    const ranked = [...hits].sort((a, b) => sort.value!(b) - sort.value!(a));
    return [{ region: "ranked", label: `按${sort.label}从高到低`, items: ranked }];
  }, [index, q, sort]);

  const bar = niceLength(120 * mpp);
  if (error) return <div className="error">数据加载失败：{error}</div>;

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>城市尺度对比 v2</h1>
        <p className="sub">口径 A（GHSL 城市中心 {index?.ghsl_epoch ?? ""}）· {index?.entries.length ?? "…"} 个条目 · 同一比例尺</p>
        <div className="modes">
          <button className={mode === "overlay" ? "on" : ""} onClick={() => setMode("overlay")}>叠加（≤{OVERLAY_SLOTS} 城）</button>
          <button className={mode === "grid" ? "on" : ""} onClick={() => setMode("grid")}>并排</button>
        </div>

        <div className="section-title">
          已选 {selected.length}/{MAX_SELECTED}
          {selected.length > 0 && <button className="link" onClick={() => setSelected([])}>清空</button>}
        </div>
        <ul className="selected">
          {selectedEntries.map((e) => {
            const off = mode === "overlay" && slots[e.id] >= OVERLAY_SLOTS;
            return (
              <li key={e.id} className={off ? "off" : ""}>
                <span className="chip" style={{ background: slotHex(slots[e.id]) }} />
                <span className="sel-name">{e.display}</span>
                {e.metrics.minor_incomplete && <span className="tag" title="支路长度不到主干路：数据缺漏或本地标注习惯">⚑ 支路偏少</span>}
                {off && <span className="tag">未叠加</span>}
                <button className="x" onClick={() => toggle(e.id)} aria-label={`移除 ${e.short}`}>×</button>
              </li>
            );
          })}
        </ul>
        {mode === "overlay" && selected.length > OVERLAY_SLOTS && (
          <p className="note">叠加只画蓝、橙、青三色的城市：再多颜色就无法两两区分（含色弱）。全部城市请用「并排」。</p>
        )}

        <div className="find">
          <input className="search" placeholder="搜索城市 / 国家…" value={query} onChange={(ev) => setQuery(ev.target.value)} />
          <select className="sort" value={sortKey} onChange={(ev) => setSortKey(ev.target.value)} aria-label="排序">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <CityBrowser groups={groups} selected={selected} slots={slots} sort={sort} onToggle={toggle} />

        <div className="toggles">
          {(["roads", "density", "boundary"] as const).map((k) => (
            <label key={k}>
              <input type="checkbox" checked={show[k]} onChange={() => setShow((s) => ({ ...s, [k]: !s[k] }))} />
              {{ roads: "道路", density: "建筑覆盖率", boundary: "城市中心边界" }[k]}
            </label>
          ))}
        </div>
        <div className="buttons">
          {mode === "overlay" && <button onClick={() => setOffsets({})}>重置位置</button>}
          <button onClick={fit}>适配 ±130 km</button>
        </div>
        <p className="hint">
          {mode === "overlay" ? "拖动城市边界可移动该城；" : "各格同步平移、缩放，原点都是各城传统中心；"}
          滚轮缩放，小于 {MINOR_MAX_MPP} m/px 时按 8 km 分块加载支路。
        </p>
        <p className="credits">
          城市中心 / 人口 / 建筑覆盖率：GHSL (JRC) · 道路：Overture Maps {index?.overture ?? ""}（含 © OpenStreetMap 贡献者）
        </p>
      </aside>

      <main ref={containerRef} className="map">
        <DeckGL
          views={views}
          viewState={viewState}
          onViewStateChange={({ viewState: vs }) => {
            const v = vs as { target: number[]; zoom: number };
            setView({ pan: [v.target[0], v.target[1]], zoom: v.zoom });
          }}
          layerFilter={mode === "grid" ? ({ layer, viewport }) => layer.id.startsWith(`${viewport.id.slice(2)}-`) : undefined}
          layers={layers}
          getCursor={({ isHovering }) => (dragging ? "grabbing" : isHovering && mode === "overlay" ? "grab" : "default")}
          _onMetrics={(m) => setMetrics({ fps: m.fps, cpu: m.cpuTimePerFrame })}
        />
        {panels.map((p) => {
          const e = byId.get(p.id)!;
          return (
            <div key={p.id} className="panel" style={{ left: p.x, top: p.y, width: p.width, height: p.height }}>
              <div className="title">
                <b>
                  <span className="chip" style={{ background: slotHex(slots[e.id]) }} />
                  {e.display}
                  {e.metrics.minor_incomplete && <span className="tag">⚑ 支路偏少</span>}
                </b>
                <span>
                  {e.a.area_km2.toLocaleString()} km² · {(e.a.pop / 1e6).toFixed(1)} M 人 · {e.metrics.density.toLocaleString()} 人/km²
                </span>
              </div>
            </div>
          );
        })}
        <div className="scale">
          <div className="bar" style={{ width: bar / mpp }} />
          <span>
            {fmtLen(bar)} · 1 px ≈ {mpp >= 1000 ? `${(mpp / 1000).toFixed(2)} km` : `${Math.round(mpp)} m`}
          </span>
        </div>
        <div className="hud">
          {metrics ? `${metrics.fps.toFixed(0)} fps · CPU ${metrics.cpu.toFixed(1)} ms/帧` : "…"} · 已加载 {(loadStats.bytes / 1e6).toFixed(1)} MB / {loadStats.files} 个文件
          {mpp < MINOR_MAX_MPP ? " · 支路已启用" : ""}
        </div>
      </main>

      <MetricsPanel entries={selectedEntries} slots={slots} epoch={index?.ghsl_epoch ?? 2020} />
    </div>
  );
}
