"""Building-scale form metrics from Overture buildings, measured on samples.

A full-city Overture building query costs hours for the largest metros (P4
probe: 3–8 s per 25 km²), so each entry is measured on 9 windows of 2 × 2 km:
one on the anchor — also exported as the figure-ground thumbnail — and 8 drawn
uniformly at random inside definition A (at least 1 km from its edge; fixed
seed per entry, so reruns are identical). Buildings are pooled across windows.

Medians are area-weighted ("half of all footprint area sits in buildings at
least this big"): robust to missing sheds and to under-mapped small buildings,
which a count median is not. Completeness = Overture footprint area / GHSL
(satellite) built-up surface in the same windows; P4 probe: Beijing 0.71,
Chongqing 0.67 vs Tokyo 0.96, Paris 1.08, New York 1.15.
"""

import zlib
from pathlib import Path

import duckdb
import numpy as np
import shapely
from PIL import Image
from pyproj import CRS, Transformer
from rasterio.features import rasterize
from rasterio.transform import Affine
from scipy import ndimage

OVERTURE_BUILDINGS = "s3://overturemaps-us-west-2/release/2026-10-21.0/theme=buildings/type=building/*"
WINDOW_M = 2_000
N_RANDOM = 8
CLUSTER_RES = 2.0  # m per pixel for the cluster raster
CLOSE_M = 6.0  # closing radius: buildings less than 12 m apart join one cluster
FG_HALF_M = 750  # figure-ground thumbnail: 1.5 × 1.5 km around the anchor
FG_RES = 2.0
COMPLETENESS_MIN = 0.65  # P4 pilot: well-mapped London/Berlin/Paris/NYC/Tokyo sit at 0.73–0.77 (GHSL built-up surface
# runs ~1.3× real footprints); Beijing 0.62, Chongqing 0.61 — flag below ~85% of that level
GRID_RES = 100.0  # the entry's GHSL grid

_con: duckdb.DuckDBPyConnection | None = None


def connection() -> duckdb.DuckDBPyConnection:
    """One connection per worker process, so Parquet footers are fetched once."""
    global _con
    if _con is None:
        _con = duckdb.connect()
        _con.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;")
        _con.execute("SET s3_region='us-west-2'; SET geometry_always_xy = true; SET enable_progress_bar = false;")
        _con.execute("SET enable_http_metadata_cache = true;")
    return _con


def sample_centres(entry_id: str, a_local) -> list[tuple[float, float]]:
    inner = a_local.buffer(-WINDOW_M / 2)
    if inner.is_empty or inner.area < WINDOW_M**2:
        inner = a_local
    shapely.prepare(inner)
    rng = np.random.default_rng(zlib.crc32(entry_id.encode()))
    minx, miny, maxx, maxy = inner.bounds
    pts = [(0.0, 0.0)]
    for _ in range(20_000):
        if len(pts) == 1 + N_RANDOM:
            break
        x, y = rng.uniform(minx, maxx), rng.uniform(miny, maxy)
        if shapely.contains_xy(inner, x, y):
            pts.append((float(x), float(y)))
    return pts


def fetch_window(crs: CRS, cx: float, cy: float, half: float) -> np.ndarray:
    """Overture building polygons (local metres) whose centroid is in the square."""
    to_wgs = Transformer.from_crs(crs, 4326, always_xy=True)
    xs, ys = to_wgs.transform([cx - half, cx + half, cx + half, cx - half], [cy - half, cy - half, cy + half, cy + half])
    w, s, e, n = min(xs), min(ys), max(xs), max(ys)
    rows = connection().execute(f"""
        SELECT ST_AsWKB(geometry) FROM read_parquet('{OVERTURE_BUILDINGS}', hive_partitioning = 1)
        WHERE bbox.xmin < {e} AND bbox.xmax > {w} AND bbox.ymin < {n} AND bbox.ymax > {s}
    """).fetchall()
    if not rows:
        return np.array([], dtype=object)
    geoms = shapely.from_wkb([bytes(r[0]) for r in rows])
    to_local = Transformer.from_crs(4326, crs, always_xy=True)
    local = shapely.transform(geoms, lambda xy: np.column_stack(to_local.transform(xy[:, 0], xy[:, 1])))
    local = local[np.isin(shapely.get_type_id(local), (3, 6))]  # Polygon / MultiPolygon
    c = shapely.centroid(local)
    keep = (np.abs(shapely.get_x(c) - cx) <= half) & (np.abs(shapely.get_y(c) - cy) <= half)
    return local[keep]


def clusters(polys: np.ndarray, cx: float, cy: float, half: float) -> np.ndarray:
    """Areas (m²) of building clusters after a 6 m closing, edge clusters dropped."""
    n = int(round(2 * half / CLUSTER_RES))
    if len(polys) == 0:
        return np.array([])
    t = Affine(CLUSTER_RES, 0, cx - half, 0, -CLUSTER_RES, cy + half)
    mask = rasterize(((p, 1) for p in polys), out_shape=(n, n), transform=t, fill=0, dtype="uint8").astype(bool)
    r = int(round(CLOSE_M / CLUSTER_RES))
    yy, xx = np.mgrid[-r : r + 1, -r : r + 1]
    closed = ndimage.binary_closing(mask, structure=(xx**2 + yy**2) <= r * r) | mask
    lab, k = ndimage.label(closed, structure=np.ones((3, 3), dtype=bool))
    if k == 0:
        return np.array([])
    sizes = np.bincount(lab.ravel(), minlength=k + 1).astype(float)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    keep = np.ones(k + 1, dtype=bool)
    keep[0] = False
    keep[edge] = False
    return sizes[keep] * CLUSTER_RES * CLUSTER_RES


def weighted_median(values: np.ndarray, weights: np.ndarray) -> float | None:
    if len(values) == 0 or weights.sum() <= 0:
        return None
    order = np.argsort(values)
    cum = np.cumsum(weights[order])
    return float(values[order][np.searchsorted(cum, cum[-1] / 2)])


def ghsl_footprint(g: dict, cx: float, cy: float, half: float) -> float:
    """GHS-BUILT-S built-up surface (m²) in the square, from the entry's 100 m grid."""
    t = g["transform"]
    c0 = int(round((cx - half - t.c) / GRID_RES))
    c1 = int(round((cx + half - t.c) / GRID_RES))
    r0 = int(round((t.f - (cy + half)) / GRID_RES))
    r1 = int(round((t.f - (cy - half)) / GRID_RES))
    return float(g["built"][max(r0, 0) : r1, max(c0, 0) : c1].sum())


def figure_ground_png(polys: np.ndarray, out: Path) -> str:
    """Black footprints on transparent, 2 m/px, 1.5 × 1.5 km around the anchor."""
    n = int(round(2 * FG_HALF_M / FG_RES))
    t = Affine(FG_RES, 0, -FG_HALF_M, 0, -FG_RES, FG_HALF_M)
    near = polys[shapely.intersects(polys, shapely.box(-FG_HALF_M, -FG_HALF_M, FG_HALF_M, FG_HALF_M))] if len(polys) else polys
    mask = (
        rasterize(((p, 255) for p in near), out_shape=(n, n), transform=t, fill=0, dtype="uint8")
        if len(near)
        else np.zeros((n, n), np.uint8)
    )
    la = np.zeros((n, n, 2), dtype=np.uint8)
    la[..., 0] = 26  # ink
    la[..., 1] = mask
    Image.fromarray(la, "LA").save(out / "figure_ground.png", optimize=True)
    return "figure_ground.png"


def building_metrics(entry_id: str, a_local, crs: CRS, g: dict, out: Path) -> dict:
    half = WINDOW_M / 2
    areas, cl, n_total, overture_m2, ghsl_m2, windows = [], [], 0, 0.0, 0.0, 0
    for i, (cx, cy) in enumerate(sample_centres(entry_id, a_local)):
        polys = fetch_window(crs, cx, cy, half)
        if i == 0:
            figure_ground_png(polys, out)
        a = shapely.area(polys) if len(polys) else np.array([])
        areas.append(a)
        cl.append(clusters(polys, cx, cy, half))
        n_total += len(polys)
        overture_m2 += float(a.sum())
        ghsl_m2 += ghsl_footprint(g, cx, cy, half)
        windows += 1
    a = np.concatenate(areas) if areas else np.array([])
    c = np.concatenate(cl) if cl else np.array([])
    completeness = overture_m2 / ghsl_m2 if ghsl_m2 > 0 else None
    return {
        "bldg_windows": windows,
        "bldg_count": int(n_total),
        "bldg_per_km2": round(n_total / (windows * (WINDOW_M / 1000) ** 2)),
        "footprint_wmedian_m2": round(weighted_median(a, a) or 0),
        "footprint_median_m2": round(float(np.median(a))) if len(a) else 0,
        "cluster_wmedian_m2": round(weighted_median(c, c) or 0),
        "bldg_completeness": round(completeness, 2) if completeness is not None else None,
        "bldg_incomplete": completeness is not None and completeness < COMPLETENESS_MIN,
    }
