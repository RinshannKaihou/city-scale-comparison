import { memo, useMemo, useState } from "react";
import type { Entry } from "./data";
import { dataUrl } from "./data";
import { slotHex } from "./palette";

interface Row {
  entry: Entry;
  slot: number;
}

const fmtInt = (v: number) => Math.round(v).toLocaleString();
const compact = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}K` : `${Math.round(v)}`);

// ---- bars ----------------------------------------------------------------------

interface BarSpec {
  key: string;
  title: string;
  note?: string;
  value: (e: Entry) => number;
  label: (v: number) => string;
  flag?: (e: Entry) => boolean; // ⚑ when the value rests on incomplete data
}

// Road metrics are gone from the panel: OpenStreetMap roads are not comparable
// between China and elsewhere (P3). Form now comes from buildings — GHSL
// volume city-wide, Overture footprints on sample windows.
const SECTIONS: { title: string; bars: BarSpec[] }[] = [
  {
    title: "规模",
    bars: [
      { key: "area", title: "面积", note: "km²", value: (e) => e.a.area_km2, label: fmtInt },
      { key: "pop", title: "人口", note: "百万", value: (e) => e.a.pop / 1e6, label: (v) => v.toFixed(1) },
    ],
  },
  {
    title: "强度",
    bars: [
      { key: "density", title: "人口密度", note: "人/km²", value: (e) => e.metrics.density, label: fmtInt },
      { key: "coverage", title: "建筑覆盖率", note: "建筑基底面积 ÷ 面积", value: (e) => e.metrics.coverage * 100, label: (v) => `${v.toFixed(0)}%` },
      {
        key: "volume",
        title: "体量密度",
        note: "m³/m²，建筑体量 ÷ 面积；÷ 3 ≈ 容积率",
        value: (e) => e.metrics.volume_density,
        label: (v) => v.toFixed(2),
      },
      { key: "height", title: "平均建筑高度", note: "m，体量 ÷ 基底面积", value: (e) => e.metrics.avg_height_m, label: (v) => v.toFixed(1) },
    ],
  },
  {
    title: "形态",
    bars: [
      {
        key: "footprint",
        title: "建筑尺度",
        note: "m²，基底面积的面积加权中位数",
        value: (e) => e.metrics.footprint_wmedian_m2,
        label: fmtInt,
        flag: (e) => e.metrics.bldg_incomplete,
      },
      {
        key: "cluster",
        title: "建筑群尺度",
        note: "m²，间距 <12 m 的建筑连成一片后的面积（加权中位数）",
        value: (e) => e.metrics.cluster_wmedian_m2,
        label: fmtInt,
        flag: (e) => e.metrics.bldg_incomplete,
      },
    ],
  },
];

function BarGroup({ spec, rows, hover, setHover }: { spec: BarSpec; rows: Row[]; hover: string | null; setHover: (id: string | null) => void }) {
  const max = Math.max(...rows.map((r) => spec.value(r.entry)), 1e-9);
  return (
    <div className="bar-group">
      <div className="bar-title">
        {spec.title}
        {spec.note && <span>{spec.note}</span>}
      </div>
      {rows.map(({ entry, slot }) => {
        const v = spec.value(entry);
        return (
          <div
            key={entry.id}
            className={`bar-row${hover && hover !== entry.id ? " dim" : ""}`}
            onMouseEnter={() => setHover(entry.id)}
            onMouseLeave={() => setHover(null)}
            title={`${entry.display}：${spec.label(v)}${spec.note ? ` ${spec.note}` : ""}`}
          >
            <span className="bar-name">{entry.short}</span>
            <span className="bar-track">
              <span className="bar" style={{ width: `${(v / max) * 100}%`, background: slotHex(slot) }} />
              <span className="bar-value">
                {spec.label(v)}
                {spec.flag?.(entry) && " ⚑"}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---- radial chart ----------------------------------------------------------------

type RadialKind = "pop" | "built" | "volume";

const RADIAL: Record<RadialKind, { label: string; series: (e: Entry) => number[]; log: boolean; fmt: (v: number) => string; tick: (v: number) => string }> = {
  pop: { label: "人口密度", series: (e) => e.radial.pop_density, log: true, fmt: (v) => `${fmtInt(v)} 人/km²`, tick: compact },
  built: { label: "建筑覆盖率", series: (e) => e.radial.built_share, log: false, fmt: (v) => `${(v * 100).toFixed(0)}%`, tick: (v) => `${Math.round(v * 100)}%` },
  volume: { label: "体量密度", series: (e) => e.radial.volume_density, log: false, fmt: (v) => `${v.toFixed(2)} m³/m²`, tick: (v) => `${v}` },
};

const W = 340;
const H = 210;
const M = { l: 40, r: 10, t: 10, b: 28 };
const X_MAX = 50; // km

function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function RadialChart({ rows, kind, hover, setHover }: { rows: Row[]; kind: RadialKind; hover: string | null; setHover: (id: string | null) => void }) {
  const [at, setAt] = useState<number | null>(null); // hovered ring index
  const spec = RADIAL[kind];
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;
  const yMax = spec.log ? 100_000 : niceMax(Math.max(1e-6, ...rows.flatMap((r) => spec.series(r.entry).slice(0, X_MAX))));
  const x = (km: number) => M.l + (km / X_MAX) * iw;
  const y = (v: number) =>
    spec.log ? M.t + ih * (1 - (Math.log10(Math.max(v, 100)) - 2) / (Math.log10(yMax) - 2)) : M.t + ih * (1 - v / yMax);
  const ticks = spec.log ? [100, 1000, 10_000, 100_000] : [0, 0.25, 0.5, 0.75, 1].map((f) => +(f * yMax).toFixed(3));

  // Where definition A stops covering most of the ring: the city's edge on this curve.
  const edge = (e: Entry) => {
    const i = e.radial.a_cover.findIndex((c) => c < 0.5);
    return i < 0 ? null : Math.min(i, X_MAX - 1);
  };

  const onMove = (ev: React.MouseEvent<SVGSVGElement>) => {
    const box = ev.currentTarget.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    const i = Math.floor(((px - M.l) / iw) * X_MAX);
    setAt(i >= 0 && i < X_MAX ? i : null);
  };

  const sorted = at === null ? [] : [...rows].sort((a, b) => spec.series(b.entry)[at] - spec.series(a.entry)[at]);

  return (
    <div className="radial">
      <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setAt(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={M.l - 6} y={y(t) + 3} className="tick" textAnchor="end">
              {spec.tick(t)}
            </text>
          </g>
        ))}
        {[0, 10, 20, 30, 40, 50].map((k) => (
          <text key={k} x={x(k)} y={H - M.b + 14} className="tick" textAnchor="middle">
            {k}
          </text>
        ))}
        <text x={M.l + iw / 2} y={H - 2} className="axis-label" textAnchor="middle">
          距传统中心 km
        </text>
        <line x1={M.l} x2={W - M.r} y1={M.t + ih} y2={M.t + ih} className="baseline" />
        {rows.map(({ entry, slot }) => {
          const s = spec.series(entry).slice(0, X_MAX);
          const d = s.map((v, i) => `${i ? "L" : "M"}${x(i + 0.5).toFixed(1)},${y(v).toFixed(1)}`).join("");
          const e = edge(entry);
          const dim = hover && hover !== entry.id;
          return (
            <g key={entry.id} opacity={dim ? 0.25 : 1} onMouseEnter={() => setHover(entry.id)} onMouseLeave={() => setHover(null)}>
              <path d={d} fill="none" stroke={slotHex(slot)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {e !== null && <circle cx={x(e + 0.5)} cy={y(s[e])} r={4} fill={slotHex(slot)} stroke="#fcfcfb" strokeWidth={2} />}
            </g>
          );
        })}
        {at !== null && <line x1={x(at + 0.5)} x2={x(at + 0.5)} y1={M.t} y2={M.t + ih} className="crosshair" />}
      </svg>
      {at !== null && (
        <div className="tooltip" style={{ left: `${(x(at + 0.5) / W) * 100}%` }}>
          <div className="tt-title">{at}–{at + 1} km</div>
          {sorted.map(({ entry, slot }) => (
            <div key={entry.id} className="tt-row">
              <span className="chip" style={{ background: slotHex(slot) }} />
              <span className="tt-name">{entry.short}</span>
              <span className="tt-val">{spec.fmt(spec.series(entry)[at])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- figure-ground ------------------------------------------------------------------

function FigureGround({ rows, hover, setHover }: { rows: Row[]; hover: string | null; setHover: (id: string | null) => void }) {
  return (
    <div className="fg-grid">
      {rows.map(({ entry, slot }) => (
        <figure
          key={entry.id}
          className={`fg${hover && hover !== entry.id ? " dim" : ""}`}
          onMouseEnter={() => setHover(entry.id)}
          onMouseLeave={() => setHover(null)}
        >
          <img src={dataUrl(entry.id, entry.files.figure_ground)} alt={`${entry.short} 中心 1.5 km 图底`} loading="lazy" />
          <figcaption>
            <span className="chip" style={{ background: slotHex(slot) }} />
            {entry.short}
            {entry.metrics.bldg_incomplete && " ⚑"}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

// ---- panel -----------------------------------------------------------------------

function MetricsPanelImpl({ entries, slots, epoch }: { entries: Entry[]; slots: Record<string, number>; epoch: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const [kind, setKind] = useState<RadialKind>("pop");
  const rows = useMemo(() => entries.map((entry) => ({ entry, slot: slots[entry.id] })), [entries, slots]);
  const bldgFlagged = rows.filter((r) => r.entry.metrics.bldg_incomplete);

  if (!rows.length) return <aside className="metrics empty">选择城市后显示指标</aside>;

  return (
    <aside className="metrics">
      <h2>指标</h2>
      <p className="sub">口径 A：GHSL 城市中心 {epoch}（≥1,500 人/km² 的连片 1 km 网格）</p>
      <div className="legend">
        {rows.map(({ entry, slot }) => (
          <span key={entry.id} className="legend-item" onMouseEnter={() => setHover(entry.id)} onMouseLeave={() => setHover(null)}>
            <span className="chip" style={{ background: slotHex(slot) }} />
            {entry.short}
          </span>
        ))}
      </div>
      {SECTIONS.map((sec) => (
        <section key={sec.title}>
          <h3>{sec.title}</h3>
          {sec.bars.map((spec) => (
            <BarGroup key={spec.key} spec={spec} rows={rows} hover={hover} setHover={setHover} />
          ))}
        </section>
      ))}

      <h3>城市中心图底</h3>
      <p className="foot">各城传统中心周围 1.5 × 1.5 km，同一比例尺；黑色为建筑基底（Overture）。</p>
      <FigureGround rows={rows} hover={hover} setHover={setHover} />

      <div className="radial-head">
        <h3>径向剖面</h3>
        <div className="seg">
          {(Object.keys(RADIAL) as RadialKind[]).map((k) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
              {RADIAL[k].label}
            </button>
          ))}
        </div>
      </div>
      <RadialChart rows={rows} kind={kind} hover={hover} setHover={setHover} />
      <p className="foot">
        每 1 km 环带的平均值（含水面、山地），以各城传统中心为圆心。圆点 = 口径 A 覆盖该环带不足一半处，可视为城市中心的边缘。
      </p>

      <p className="foot">
        建筑覆盖率、体量密度、平均高度：GHS-BUILT-S / GHS-BUILT-V 2020（卫星反演，全球同一口径，覆盖整个城市中心）。建筑尺度、建筑群尺度：Overture
        建筑轮廓在 9 个 2 × 2 km 抽样窗口（中心 + 城市中心内随机 8 个）上的合并统计。
      </p>
      {bldgFlagged.length > 0 && (
        <p className="foot flag">
          ⚑ {bldgFlagged.map((r) => `${r.entry.short} ${r.entry.metrics.bldg_completeness?.toFixed(2)}`).join("、")}：抽样窗口里
          Overture 建筑轮廓面积 ÷ 卫星估算的建成面积低于 0.65（多数城市约 0.75）。两套数据差异大，原因可能是 Overture
          缺小建筑（如中国城市），也可能是卫星在低密度郊区高估（如奥克兰、迈阿密）。建筑尺度、建筑群尺度的可信度因此较低。
        </p>
      )}
    </aside>
  );
}

// Props only change with the selection, not with pan/zoom/drag: skip the
// re-render on every map frame.
export const MetricsPanel = memo(MetricsPanelImpl);
