"""P1 figures: equal-scale definition maps, B-threshold sweep, radial profiles.

Palette: the dataviz reference instance. Definitions keep one hue per family
everywhere (A blue, B orange, C aqua — validated all-pairs, light surface);
variants inside a family differ by line style, not by a new hue.
"""

import geopandas as gpd
import numpy as np
import pandas as pd
import matplotlib
import matplotlib.patches
from scipy import ndimage

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402

from citydef.config import B_COMPARE, B_THRESHOLD, WINDOW_HALF_M  # noqa: E402

SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_2 = "#52514e"
MUTED = "#898781"
GRID = "#e1e0d9"
WATER = "#e6edf3"
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"

plt.rcParams.update(
    {
        "font.family": "sans-serif",
        "font.sans-serif": ["PingFang SC", "Hiragino Sans GB", "Arial Unicode MS", "DejaVu Sans"],
        "axes.unicode_minus": False,
        "font.size": 9,
        "axes.edgecolor": GRID,
        "axes.linewidth": 0.8,
        "axes.labelcolor": INK_2,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "text.color": INK,
        "figure.facecolor": SURFACE,
        "axes.facecolor": SURFACE,
        "savefig.facecolor": SURFACE,
    }
)

HALF_KM = WINDOW_HALF_M / 1000.0
EXTENT = [-HALF_KM - 0.05, HALF_KM + 0.05, -HALF_KM - 0.05, HALF_KM + 0.05]

DASH = (0, (3, 2))
# (mask key, colour, linestyle, linewidth, filled, legend label). The filled
# entry is the row's definition proper; dashed outlines are its variants.
ROWS = (
    ("A 官方城市中心族（GHSL Degree of Urbanisation）", (
        ("A", BLUE, "-", 1.3, True, "A 城市中心（GHS-UCDB 2020，≥1,500 人/km²）"),
        ("A+", BLUE, DASH, 0.9, False, "A+ 城市中心 + 相连郊区（SMOD 21–30，≥300 人/km²）"),
    )),
    ("B 建筑密度阈值（1 km² 邻域建筑覆盖率）", (
        ("B", ORANGE, "-", 1.3, True, f"B 覆盖率 ≥ {B_THRESHOLD:.0%} 的连片区"),
        ("B_cmp", ORANGE, DASH, 0.9, False, f"B 覆盖率 ≥ {B_COMPARE:.0%} 的连片区"),
    )),
    ("C 建成区 ∩ 行政区", (
        ("admin", MUTED, "-", 0.7, False, "行政边界（city proper）"),
        ("C", AQUA, "-", 1.3, True, f"C  B（≥{B_THRESHOLD:.0%}）的连片区 ∩ 行政区"),
        ("C+", AQUA, DASH, 0.9, False, "C+ 行政区内全部 B 斑块（≥1 km²，含卫星城）"),
    )),
)


def _basemap(density: np.ndarray, smod: np.ndarray) -> np.ndarray:
    """Grey ramp of local built-up density over the surface; water tinted."""
    t = np.clip(density / 0.4, 0.0, 1.0) ** 0.8
    surface = np.array(matplotlib.colors.to_rgb(SURFACE))
    ink = np.array(matplotlib.colors.to_rgb(INK_2))
    rgb = surface + (ink - surface) * t[..., None]
    water = (smod == 10) & (density < 0.02)
    rgb[water] = matplotlib.colors.to_rgb(WATER)
    return rgb


def _outline(ax, mask: np.ndarray, color, ls, lw, filled: bool):
    if not mask.any():
        return
    # Display-only smoothing (~250 m) so 1 km staircases don't read as noise;
    # every number in the report comes from the unsmoothed mask.
    soft = ndimage.gaussian_filter(mask.astype(float), 2.5)
    kw = dict(extent=EXTENT, origin="upper")
    if filled:
        ax.contourf(soft, levels=[0.5, 2.0], colors=[color], alpha=0.12, **kw)
    ax.contour(soft, levels=[0.5], colors=[color], linestyles=[ls], linewidths=lw, **kw)


def _fmt_area(row: pd.Series) -> str:
    if row is None or not row["area_km2"]:
        return "0 km²"
    s = f"{row['area_km2']:,.0f} km² · {row['pop_m']:.1f} M人"
    return s + "（触及窗口边缘）" if row["touches_window_edge"] else s


def fig_maps(cities, data: dict, metrics: pd.DataFrame, path):
    fig, axes = plt.subplots(3, len(cities), figsize=(3.3 * len(cities), 3.3 * 3 + 1.3))
    for col, city in enumerate(cities):
        d = data[city.id]
        base = _basemap(d["density"], d["smod"])
        for row, (row_label, items) in enumerate(ROWS):
            ax = axes[row, col]
            ax.imshow(base, extent=EXTENT, origin="upper", interpolation="nearest")
            lines = []
            for key, color, ls, lw, filled, _ in items:
                _outline(ax, d["masks"][key], color, ls, lw, filled)
                if key != "admin":
                    m = metrics[(metrics.city == city.id) & (metrics.definition == key)].iloc[0]
                    lines.append(f"{key.replace('_cmp', f'≥{B_COMPARE:.0%}')}: {_fmt_area(m)}")
            ax.plot(0, 0, "o", ms=4, mfc=INK, mec=SURFACE, mew=1.2)
            ax.text(-HALF_KM + 4, HALF_KM - 4, "\n".join(lines), va="top", ha="left", fontsize=7,
                    color=INK, linespacing=1.4,
                    bbox=dict(boxstyle="round,pad=0.35", fc=SURFACE, ec="none", alpha=0.85))
            # 50 km scale bar, bottom-left
            ax.plot([-HALF_KM + 8, -HALF_KM + 58], [-HALF_KM + 8] * 2, color=INK, lw=1.5,
                    solid_capstyle="butt")
            ax.text(-HALF_KM + 33, -HALF_KM + 11, "50 km", ha="center", fontsize=7, color=INK)
            ax.set_xlim(EXTENT[:2])
            ax.set_ylim(EXTENT[2:])
            ax.set_xticks([])
            ax.set_yticks([])
            if row == 0:
                ax.set_title(f"{city.name_zh} {city.name}", fontsize=11, color=INK, pad=6)
            if col == 0:
                ax.set_ylabel(row_label, fontsize=9, color=INK_2, labelpad=8)
    handles = [Line2D([], [], color=c, ls=ls, lw=lw) for _, items in ROWS for _, c, ls, lw, _, _ in items]
    labels = [lab for _, items in ROWS for *_, lab in items]
    fig.legend(handles, labels, loc="lower center", ncol=4, frameon=False, fontsize=8,
               handlelength=3, columnspacing=1.6)
    fig.suptitle(
        "五城三口径对比 · 同一比例尺（每格 220 × 220 km，以城市传统中心为原点的等积方位投影）· "
        "底图：1 km² 邻域建筑覆盖率（GHS-BUILT-S 2020）",
        fontsize=10, color=INK_2, y=0.995,
    )
    fig.tight_layout(rect=(0, 0.06, 1, 0.98))
    fig.savefig(path, dpi=150)
    plt.close(fig)


def _right_labels(ax, items, x_end=0.41, min_gap_dec=0.2):
    """Label horizontal lines just past the right edge; when values crowd,
    push labels apart (log space) and tie each back with a leader line."""
    items = sorted(items)
    placed = []
    for value, _ in items:
        y = np.log10(value)
        if placed and y - placed[-1] < min_gap_dec:
            y = placed[-1] + min_gap_dec
        placed.append(y)
    for (value, text), y in zip(items, placed):
        moved = abs(y - np.log10(value)) > 0.01
        ax.annotate(
            text, xy=(x_end, value), xytext=(x_end + 0.03, 10**y), textcoords="data", fontsize=7.5,
            color=INK_2, va="center", ha="left", annotation_clip=False,
            arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.6, shrinkA=0, shrinkB=2) if moved else None,
        )


def fig_sweep(cities, sweep: pd.DataFrame, metrics: pd.DataFrame, refs: pd.DataFrame, path):
    fig, axes = plt.subplots(1, len(cities), figsize=(3.7 * len(cities), 3.9), sharey=True)
    for ax, city in zip(axes, cities):
        s = sweep[sweep.city == city.id].sort_values("threshold")
        s = s[s.area_km2 > 0]
        ok, cut = s[~s.touches_window_edge], s[s.touches_window_edge]
        ax.plot(s.threshold, s.area_km2, color=ORANGE, lw=2, solid_joinstyle="round")
        ax.plot(ok.threshold, ok.area_km2, "o", ms=6, mfc=ORANGE, mec=SURFACE, mew=1.5)
        ax.plot(cut.threshold, cut.area_km2, "o", ms=6, mfc=SURFACE, mec=ORANGE, mew=1.5)
        # Largest one-step drop in the usable range (≤25%, extent still a city,
        # not its last dense blocks): where the contiguous fabric breaks apart.
        th, ar, edge = s.threshold.values, s.area_km2.values, s.touches_window_edge.values
        steps = [
            (ar[i] / ar[i + 1], i)
            for i in range(len(ar) - 1)
            if th[i + 1] <= 0.25 and ar[i] >= 100 and not edge[i]
        ]
        if steps:
            ratio, i = max(steps)
            if ratio >= 2:
                ax.annotate(f"×{ratio:.1f}", xy=(th[i + 1], ar[i + 1]), xytext=(7, 4),
                            textcoords="offset points", fontsize=8.5, color=INK, va="bottom")
        labels = []
        for key, ls in (("A", "-"), ("A+", DASH)):
            m = metrics[(metrics.city == city.id) & (metrics.definition == key)].iloc[0]
            ax.axhline(m.area_km2, color=BLUE, ls=ls, lw=1.2)
            labels.append((m.area_km2, f"{key} {m.area_km2:,.0f}{'*' if m.touches_window_edge else ''}"))
        for _, ref in refs[(refs["city"] == city.id) & (refs["plot"] == 1)].iterrows():
            ax.axhline(ref.area_km2, color=MUTED, lw=0.8)
            labels.append((ref.area_km2, f"{ref.short_label} {ref.area_km2:,.0f}"))
        _right_labels(ax, labels)
        ax.set_yscale("log")
        ax.set_xlim(0.04, 0.41)
        ax.set_ylim(3, 30_000)
        ax.set_xticks([0.05, 0.1, 0.15, 0.2, 0.3, 0.4])
        ax.set_xticklabels(["5%", "10%", "15%", "20%", "30%", "40%"])
        ax.grid(True, axis="y", color=GRID, lw=0.6)
        ax.set_title(f"{city.name_zh} {city.name}", fontsize=10, color=INK)
        ax.set_xlabel("B 阈值：1 km² 邻域建筑覆盖率")
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)
    axes[0].set_ylabel("连片面积 km²（对数）")
    handles = [
        Line2D([], [], color=ORANGE, lw=2, marker="o", ms=6, mfc=ORANGE, mec=SURFACE),
        Line2D([], [], color=ORANGE, lw=0, marker="o", ms=6, mfc=SURFACE, mec=ORANGE),
        Line2D([], [], color=BLUE, lw=1.2),
        Line2D([], [], color=BLUE, lw=1.2, ls=DASH),
        Line2D([], [], color=MUTED, lw=0.8),
    ]
    labels = ["B 连片面积", "空心 / *：触及 220 km 窗口边缘（已连成区域网，面积被截断）", "A 城市中心",
              "A+ 城市中心 + 相连郊区", "外部统计口径（见报告表 3）"]
    fig.legend(handles, labels, loc="lower center", ncol=5, frameon=False, fontsize=8)
    fig.suptitle("B 口径对阈值的敏感性：阈值每变一档，连片面积可能骤变数倍（×n 标出最大一跳）",
                 fontsize=10, color=INK_2)
    fig.tight_layout(rect=(0, 0.08, 0.95, 0.95))
    fig.subplots_adjust(wspace=0.55)
    fig.savefig(path, dpi=150)
    plt.close(fig)


SHORT_FLAGS = {
    "seed_outside": "点在外", "shared_uc": "同城", "exceeds_window": "超窗",
    "name_mismatch": "名不符", "satellite": "卫星", "small": "偏小",
    "polycentric": "多核", "cross_border": "跨境",
}


def fig_atlas(df: pd.DataFrame, panels: dict, window_km: float, path, half_km: float = 90.0, ncols: int = 10):
    """Every old city's urban centre (A) at one scale, largest first."""
    order = df.sort_values(["uc_area_km2", "id"], ascending=[False, True]).reset_index(drop=True)
    nrows = int(np.ceil(len(order) / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(1.95 * ncols, 2.1 * nrows + 0.9))
    lim = half_km * 1000
    for ax in axes.flat:
        ax.set_axis_off()
    for i, r in order.iterrows():
        ax = axes.flat[i]
        p = panels[r.id]
        if p["coast"] is not None and not p["coast"].empty:
            p["coast"].plot(ax=ax, color=MUTED, lw=0.4)
        others = p["local"][p["local"].uc_id != r.uc_id]
        if not others.empty:
            others.plot(ax=ax, color=GRID, lw=0)
        mine = p["local"][p["local"].uc_id == r.uc_id]
        mine.plot(ax=ax, color=BLUE, alpha=0.3, lw=0)
        mine.boundary.plot(ax=ax, color=BLUE, lw=0.7)
        if p["old"] is not None:
            # matplotlib directly: geopandas expands a dash tuple per part of a
            # MultiLineString and chokes on it.
            for line in getattr(p["old"].boundary, "geoms", [p["old"].boundary]):
                xs, ys = line.xy
                ax.plot(xs, ys, color=INK_2, lw=0.5, ls=DASH)
        ax.plot(0, 0, "o", ms=3, mfc=INK, mec=SURFACE, mew=0.8)
        ax.set_xlim(-lim, lim)
        ax.set_ylim(-lim, lim)
        ax.set_aspect("equal")
        ax.set_axis_on()
        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_xlabel("")  # geopandas labels projected axes "Easting [metre]"
        ax.set_ylabel("")
        for s in ax.spines.values():
            s.set_color(GRID)
        flags = [SHORT_FLAGS[k] for k in SHORT_FLAGS if r[k]]
        ax.set_title(f"{r.name_zh}  {r.uc_area_km2:,.0f} km²\n" + ("！" + "·".join(flags) if flags else " "),
                     fontsize=7.5, color=INK, pad=3, linespacing=1.3)
    first = axes.flat[0]
    first.plot([-lim + 8e3, -lim + 58e3], [-lim + 8e3] * 2, color=INK, lw=1.2, solid_capstyle="butt")
    first.text(-lim + 33e3, -lim + 12e3, "50 km", ha="center", fontsize=6.5, color=INK)
    handles = [
        matplotlib.patches.Patch(facecolor=matplotlib.colors.to_rgba(BLUE, 0.3), edgecolor=BLUE, lw=0.7),
        matplotlib.patches.Patch(facecolor=GRID, edgecolor="none"),
        Line2D([], [], color=INK_2, lw=0.6, ls=DASH),
        Line2D([], [], marker="o", ls="", ms=4, mfc=INK, mec=SURFACE),
    ]
    labels = ["A：该城中心点所在的城市中心（GHS-UCDB 2020）", "附近其他城市中心", "旧版多边形（NE 2002 + 启发式）", "旧版中心点"]
    fig.legend(handles, labels, loc="lower center", ncol=4, frameon=False, fontsize=8)
    fig.suptitle(
        f"旧版 {len(order)} 城在口径 A 下的城市中心 · 同一比例尺（每格 {2 * half_km:.0f} × {2 * half_km:.0f} km）· 按面积排序\n"
        f"！标记：同城 = 多城落进同一城市中心 · 超窗 = 外沿超出 ±{window_km:.0f} km · 卫星 = 30 km 内有人口 ≥2 倍的城市中心 · "
        "多核 = 50 km 内城市中心人口 <70% 在本城 · 跨境 = 国界处被截断（另有点在外 / 名不符 / 偏小三类，本次 0 例）",
        fontsize=9, color=INK_2, y=0.998, linespacing=1.6,
    )
    fig.tight_layout(rect=(0, 0.025, 1, 0.975))
    fig.savefig(path, dpi=130)
    plt.close(fig)


def fig_radial(cities, radial: pd.DataFrame, metrics: pd.DataFrame, path):
    xmax = 100
    fig, axes = plt.subplots(1, len(cities), figsize=(3.3 * len(cities), 3.8), sharey=True)
    marks = (("A", BLUE, "-"), ("A+", BLUE, DASH), ("B", ORANGE, "-"), ("C", AQUA, "-"))
    for ax, city in zip(axes, cities):
        r = radial[radial.city == city.id]
        ax.plot(r.ring_km + 0.5, r.pop_density.clip(lower=1), color=INK_2, lw=2)
        for level, label in ((1500, "1,500"), (300, "300")):
            ax.axhline(level, color=MUTED, lw=0.7)
            ax.text(1, level * 0.9, f"{label}/km²", fontsize=7, color=MUTED, ha="left", va="top")
        placed = []
        for key, color, ls in sorted(
            marks, key=lambda k: metrics[(metrics.city == city.id) & (metrics.definition == k[0])].reach_p95_km.iloc[0]
        ):
            reach = metrics[(metrics.city == city.id) & (metrics.definition == key)].reach_p95_km.iloc[0]
            x = min(reach, xmax - 0.5)
            ax.axvline(x, color=color, ls=ls, lw=1.3)
            # lowest label row not taken by a neighbour within 6 km
            taken = {t for px, t in placed if abs(px - x) < 6}
            tier = next(t for t in range(len(marks)) if t not in taken)
            placed.append((x, tier))
            ax.text(x, 52_000 / (2.1**tier), f" {key}{'→' if reach > xmax else ''}", fontsize=7.5,
                    color=INK, ha="left", va="top")
        ax.set_yscale("log")
        ax.set_ylim(30, 60_000)
        ax.set_xlim(0, xmax)
        ax.grid(True, axis="y", color=GRID, lw=0.6)
        ax.set_title(f"{city.name_zh} {city.name}", fontsize=10, color=INK)
        ax.set_xlabel("距传统中心（km）")
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)
    axes[0].set_ylabel("环带人口密度（人/km²，对数）")
    handles = [Line2D([], [], color=INK_2, lw=2)] + [Line2D([], [], color=c, ls=ls, lw=1.3) for _, c, ls in marks]
    labels = ["1 km 环带人口密度（GHS-POP 2020）", "A 外沿", "A+ 外沿", f"B（≥{B_THRESHOLD:.0%}）外沿", "C 外沿"]
    fig.legend(handles, labels, loc="lower center", ncol=5, frameon=False, fontsize=8)
    fig.suptitle("密度梯度与各口径的外沿（外沿 = 该口径 95% 面积所在的半径；→ 表示超出 100 km）",
                 fontsize=10, color=INK_2)
    fig.tight_layout(rect=(0, 0.08, 1, 0.95))
    fig.savefig(path, dpi=150)
    plt.close(fig)
