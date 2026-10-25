"""Export the v2 viewer's data for every registry entry (references/entries.csv).

Per entry, everything in the entry's own LAEA frame (metres, origin = the main
city's traditional centre), so the browser does no projection at all:

  boundary.json     definition A polygon(s)
  builtup.png       building coverage (GHS-BUILT-S 2020, 100 m) inside A, as alpha
  roads_major.bin   motorway…tertiary, simplified 5 m, one file
  roads_minor/*.bin residential / living_street / unclassified, simplified 2 m,
                    in 8 km chunks the viewer loads only when zoomed in
  manifest.json     raster bounds + road file list (fetched when the entry is shown)
  record.json       index record: names, A stats, metrics, radial profile

and one index, cities.json, assembled from every record.json (small: no chunk
lists, so the city browser and metrics panel load in one request).

Binary road layout (little-endian), per .bin file:
  uint32 header_len | header JSON (utf-8, padded to 4 bytes) |
  per section: float32 [x0, y0, x1, y1, …] then uint32 path start indices

    uv run python -I -m citydef.export                 # all entries, skip done
    uv run python -I -m citydef.export tokyo paris     # just these (always redone)
    uv run python -I -m citydef.export --force         # redo everything
"""

import json
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import duckdb
import geopandas as gpd
import numpy as np
import shapely
from PIL import Image
from pyproj import CRS, Transformer
from rasterio.features import rasterize
from rasterio.transform import Affine
from rasterio.warp import Resampling, transform_bounds

from citydef import definitions, fetch
from citydef.buildings import building_metrics
from citydef.config import CRS_MOLLWEIDE, EPOCH, RAW, ROOT
from citydef.entries import Entry, load_entries
from citydef.grid import _tif_paths, warp_tiles

WEB_DATA = ROOT.parent / "web" / "public" / "data"
OVERTURE = "s3://overturemaps-us-west-2/release/2026-10-21.0/theme=transportation/type=segment/*"
OVERTURE_CACHE = RAW / "overture"
WORKERS = 3

# Width tiers. Footways, service roads, paths etc. are left out on purpose:
# in central Paris footways alone outweigh residential streets 5:1 by length.
TIERS = {
    0: ("motorway", "trunk"),
    1: ("primary", "secondary"),
    2: ("tertiary",),
    3: ("residential", "living_street", "unclassified"),
}
MAJOR_TIERS = (0, 1, 2)
MAJOR_TOL_M = 5.0
MINOR_TOL_M = 2.0
CHUNK_M = 8_000
RES = 100.0
RASTER_FULL_SHARE = 0.5  # building coverage that renders fully opaque
RADIAL_MAX_M = 60_000  # radial profile: 1 km rings out to here
# Residential streets are under-mapped in some regions (P2: Beijing 6.4k km of
# residential vs 11k km of main roads inside its urban centre; Tokyo 59k vs
# 24k). Where residential < main-road length, the viewer flags the entry and
# cross-city road metrics use main roads only.
MINOR_MAJOR_MIN = 1.0


def laea(e: Entry) -> CRS:
    return CRS.from_proj4(f"+proj=laea +lat_0={e.lat} +lon_0={e.lon} +datum=WGS84 +units=m +no_defs")


def urban_centre(e: Entry) -> tuple[shapely.Geometry, shapely.Geometry, dict]:
    """Definition A for the entry: (polygon in Mollweide, polygon in LAEA, UCDB stats)."""
    pts, polys = definitions._ucdb_layers(EPOCH)
    anchor = gpd.GeoSeries([shapely.Point(e.lon, e.lat)], crs=4326).to_crs(polys.crs).iloc[0]
    hit = polys[polys.contains(anchor)]
    if hit.empty:
        raise ValueError(f"{e.id}: anchor is not inside a {EPOCH} urban centre")
    row = pts[pts["ID_MTUC_G0"] == int(hit.iloc[0]["ID_UC_G0"])].iloc[0]
    local = gpd.GeoSeries([hit.iloc[0].geometry], crs=polys.crs).to_crs(laea(e)).iloc[0]
    stats = {
        "ucdb_id": int(row["ID_MTUC_G0"]),
        "ucdb_name": str(row["GC_UCN_MAI_2025"]),
        "area_km2": float(row[f"MT_UCA_KM2_{EPOCH}"]),
        "pop": float(row[f"MT_POP_TOT_{EPOCH}"]),
        "built_km2": round(float(row[f"MT_BUS_TOT_{EPOCH}"]) / 1e6, 1),
        "epoch": EPOCH,
    }
    return hit.iloc[0].geometry, local, stats


# ---- grid window (raster texture + metrics) --------------------------------------


def window(a_local) -> tuple[Affine, tuple[int, int]]:
    """100 m grid covering A and at least the radial-profile disc."""
    minx, miny, maxx, maxy = a_local.bounds
    left = np.floor(min(minx, -RADIAL_MAX_M) / RES) * RES - 1000
    bottom = np.floor(min(miny, -RADIAL_MAX_M) / RES) * RES - 1000
    right = np.ceil(max(maxx, RADIAL_MAX_M) / RES) * RES + 1000
    top = np.ceil(max(maxy, RADIAL_MAX_M) / RES) * RES + 1000
    shape = (int(round((top - bottom) / RES)), int(round((right - left) / RES)))
    return Affine(RES, 0, left, 0, -RES, top), shape


def window_mollweide_bounds(e: Entry, a_local) -> tuple[float, float, float, float]:
    t, (h, w) = window(a_local)
    return transform_bounds(laea(e), CRS_MOLLWEIDE, t.c, t.f - h * RES, t.c + w * RES, t.f, densify_pts=41)


# ---- roads ---------------------------------------------------------------------


def overture_roads(e: Entry, a_wgs84_bounds) -> tuple[np.ndarray, np.ndarray]:
    """(class, WKB) for every kept road segment touching A's bbox; cached."""
    cache = OVERTURE_CACHE / f"{e.id}.parquet"
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2'; SET geometry_always_xy = true; SET enable_progress_bar = false;")
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        w, s, east, n = a_wgs84_bounds
        classes = ", ".join(f"'{c}'" for tier in TIERS.values() for c in tier)
        tmp = cache.with_suffix(".part")
        con.execute(f"""
            COPY (
              SELECT class, ST_AsWKB(geometry) AS wkb
              FROM read_parquet('{OVERTURE}', hive_partitioning = 1)
              WHERE subtype = 'road' AND class IN ({classes})
                AND bbox.xmin < {east} AND bbox.xmax > {w} AND bbox.ymin < {n} AND bbox.ymax > {s}
            ) TO '{tmp}' (FORMAT parquet)
        """)
        tmp.rename(cache)
    res = con.execute(f"SELECT class, wkb FROM read_parquet('{cache}')").fetchnumpy()
    wkb = np.fromiter((bytes(b) for b in res["wkb"]), dtype=object, count=len(res["wkb"]))  # shapely rejects bytearray
    return np.asarray(res["class"], dtype=object), wkb


def to_local(geoms: np.ndarray, crs: CRS) -> np.ndarray:
    tr = Transformer.from_crs(4326, crs, always_xy=True)
    return shapely.transform(geoms, lambda xy: np.column_stack(tr.transform(xy[:, 0], xy[:, 1])))


def clip_lines(lines: np.ndarray, area: shapely.Geometry) -> np.ndarray:
    shapely.prepare(area)
    inside = shapely.within(lines, area)
    crossing = ~inside & shapely.intersects(lines, area)
    cut = shapely.get_parts(shapely.intersection(lines[crossing], area))
    return np.concatenate([lines[inside], cut[shapely.get_type_id(cut) == 1]])  # LineStrings only


def merge_and_simplify(lines: np.ndarray, tol: float) -> np.ndarray:
    if len(lines) == 0:
        return lines
    merged = shapely.get_parts(shapely.line_merge(shapely.multilinestrings(lines)))
    simple = shapely.simplify(merged, tol, preserve_topology=False)
    return simple[shapely.get_num_coordinates(simple) >= 2]


def encode(sections: list[tuple[dict, np.ndarray]]) -> bytes:
    """Pack (meta, LineString array) sections into the viewer's binary layout."""
    blobs, metas, offset = [], [], 0
    for meta, lines in sections:
        coords = shapely.get_coordinates(lines).astype("<f4")
        counts = shapely.get_num_coordinates(lines)
        starts = np.concatenate([[0], np.cumsum(counts)[:-1]]).astype("<u4")
        pos_b, starts_b = coords.ravel().tobytes(), starts.tobytes()
        metas.append(meta | {"paths": int(len(lines)), "vertices": int(len(coords)),
                             "pos_offset": offset, "starts_offset": offset + len(pos_b)})
        blobs += [pos_b, starts_b]
        offset += len(pos_b) + len(starts_b)
    header = json.dumps({"sections": metas}, separators=(",", ":")).encode()
    header += b" " * (-len(header) % 4)
    return np.uint32(len(header)).astype("<u4").tobytes() + header + b"".join(blobs)


def export_roads(e: Entry, a_local, a_moll, out: Path) -> tuple[dict, dict]:
    a_wgs = gpd.GeoSeries([a_moll], crs=CRS_MOLLWEIDE).to_crs(4326).total_bounds
    classes, wkb = overture_roads(e, tuple(a_wgs))
    lines = to_local(shapely.from_wkb(wkb), laea(e))
    tier_of = {c: t for t, cs in TIERS.items() for c in cs}
    tiers = np.array([tier_of[c] for c in classes], dtype=np.int8)

    km, sections = {}, []
    for t in MAJOR_TIERS:
        part = merge_and_simplify(clip_lines(lines[tiers == t], a_local), MAJOR_TOL_M)
        sections.append(({"tier": t}, part))
        km[t] = float(shapely.length(part).sum()) / 1000
    (out / "roads_major.bin").write_bytes(encode(sections))

    minor = merge_and_simplify(clip_lines(lines[tiers == 3], a_local), MINOR_TOL_M)
    km[3] = float(shapely.length(minor).sum()) / 1000
    b = shapely.bounds(minor)
    ci = np.floor((b[:, 0] + b[:, 2]) / 2 / CHUNK_M).astype(int)
    cj = np.floor((b[:, 1] + b[:, 3]) / 2 / CHUNK_M).astype(int)
    (out / "roads_minor").mkdir(exist_ok=True)
    for old in (out / "roads_minor").glob("*.bin"):
        old.unlink()
    chunks = []
    for i, j in sorted(set(zip(ci.tolist(), cj.tolist()))):
        sel = (ci == i) & (cj == j)
        bb = [float(b[sel, 0].min()), float(b[sel, 1].min()), float(b[sel, 2].max()), float(b[sel, 3].max())]
        name = f"roads_minor/{i}_{j}.bin"
        blob = encode([({"tier": 3}, minor[sel])])
        (out / name).write_bytes(blob)
        chunks.append({"file": name, "bounds": [round(v) for v in bb], "bytes": len(blob),
                       "vertices": int(shapely.get_num_coordinates(minor[sel]).sum())})
    manifest = {"major": {"file": "roads_major.bin", "bytes": (out / "roads_major.bin").stat().st_size},
                "minor": {"chunk_m": CHUNK_M, "chunks": chunks}}
    return manifest, km


# ---- rasters + metrics -------------------------------------------------------------


def grid_layers(e: Entry, a_local) -> dict:
    transform, shape = window(a_local)
    warp = lambda key: warp_tiles(_tif_paths(key), laea(e), transform, shape, Resampling.average, "float32", e.id)  # noqa: E731
    inside = rasterize([(a_local, 1)], out_shape=shape, transform=transform, fill=0, dtype="uint8").astype(bool)
    # built: footprint m² per ha · vol: building volume m³ per ha · pop: residents per ha
    return {"transform": transform, "shape": shape, "built": warp("built_s"), "vol": warp("built_v"),
            "pop": warp("pop"), "a": inside}


def write_builtup_png(g: dict, a_local, out: Path) -> dict:
    """Coverage texture cropped to A (+1 km), transparent outside A."""
    t = g["transform"]
    minx, miny, maxx, maxy = a_local.bounds
    c0 = int((np.floor(minx / RES) * RES - 1000 - t.c) / RES)
    c1 = int((np.ceil(maxx / RES) * RES + 1000 - t.c) / RES)
    r0 = int((t.f - (np.ceil(maxy / RES) * RES + 1000)) / RES)
    r1 = int((t.f - (np.floor(miny / RES) * RES - 1000)) / RES)
    built, inside = g["built"][r0:r1, c0:c1], g["a"][r0:r1, c0:c1]
    alpha = np.clip(built / 10_000.0 / RASTER_FULL_SHARE, 0, 1) ** 0.8 * 255 * inside
    rgba = np.zeros(built.shape + (4,), dtype=np.uint8)
    rgba[..., :3] = 255  # white, tinted in the viewer
    rgba[..., 3] = alpha.astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(out / "builtup.png", optimize=True)
    left, top = t.c + c0 * RES, t.f - r0 * RES
    return {"file": "builtup.png", "bounds": [left, top - (r1 - r0) * RES, left + (c1 - c0) * RES, top],
            "bytes": (out / "builtup.png").stat().st_size}


def grid_metrics(g: dict) -> tuple[dict, dict]:
    """Shape metrics of A and the radial profile around the anchor."""
    t, (h, w) = g["transform"], g["shape"]
    xs = t.c + (np.arange(w) + 0.5) * RES
    ys = t.f - (np.arange(h) + 0.5) * RES
    dist = np.hypot(xs[None, :], ys[:, None])
    a = g["a"]
    area = a.sum() * RES * RES / 1e6
    da = dist[a] / 1000.0
    yy, xx = np.nonzero(a)
    cy, cx = ys[yy].mean(), xs[xx].mean()
    mean_to_centroid = np.hypot(xs[xx] - cx, ys[yy] - cy).mean() / 1000.0
    r_eq = np.sqrt(area / np.pi)
    built_a, vol_a = float(g["built"][a].sum()), float(g["vol"][a].sum())
    shape_m = {
        "reach_p95_km": round(float(np.percentile(da, 95)), 1),
        "eq_diameter_km": round(float(2 * r_eq), 1),
        # Angel et al. (2010) proximity index: 1 = disc, lower = stretched / fragmented
        "proximity_index": round(float((2 / 3) * r_eq / mean_to_centroid), 3),
        # GHS-BUILT-V / GHS-BUILT-S inside A: mean building height (m), and
        # volume per unit land (m³/m²; ÷ ~3 m storey height ≈ floor-area ratio)
        "avg_height_m": round(vol_a / built_a, 1) if built_a else None,
        "volume_density": round(vol_a / (area * 1e6), 2),
    }
    nr = RADIAL_MAX_M // 1000
    ring = (dist // 1000).astype(int)
    m = ring < nr
    r = ring[m]
    cells = np.bincount(r, minlength=nr).astype(float)
    radial = {
        "ring_km": 1,
        "pop_density": np.round(np.bincount(r, weights=g["pop"][m], minlength=nr) / (cells * RES * RES / 1e6)).astype(int).tolist(),
        "built_share": np.round(np.bincount(r, weights=g["built"][m], minlength=nr) / (cells * RES * RES), 3).tolist(),
        "volume_density": np.round(np.bincount(r, weights=g["vol"][m], minlength=nr) / (cells * RES * RES), 2).tolist(),
        "a_cover": np.round(np.bincount(r, weights=a[m].astype(float), minlength=nr) / cells, 2).tolist(),
    }
    return shape_m, radial


def boundary_json(a_local) -> dict:
    a = shapely.simplify(a_local, 20.0)
    polys = []
    for p in shapely.get_parts(a):
        rings = [np.round(np.asarray(p.exterior.coords)).astype(int).tolist()]
        rings += [np.round(np.asarray(h.coords)).astype(int).tolist() for h in p.interiors]
        polys.append(rings)
    return {"polygons": polys}


# ---- per entry ------------------------------------------------------------------


def export_entry(e: Entry, redo_roads: bool = True) -> dict:
    t0 = time.time()
    out = WEB_DATA / e.id
    out.mkdir(parents=True, exist_ok=True)
    a_moll, a_local, stats = urban_centre(e)
    (out / "boundary.json").write_text(json.dumps(boundary_json(a_local), separators=(",", ":")))
    g = grid_layers(e, a_local)
    raster = write_builtup_png(g, a_local, out)
    shape_m, radial = grid_metrics(g)
    bldg = building_metrics(e.id, a_local, laea(e), g, out)

    old = out / "record.json"
    if redo_roads or not old.exists() or not (out / "manifest.json").exists():
        roads, km = export_roads(e, a_local, a_moll, out)
        major_km = km[0] + km[1] + km[2]
        ratio = km[3] / major_km if major_km else 0.0
        road_m = {
            "major_road_km": round(major_km),
            "major_road_density": round(major_km / stats["area_km2"], 2),  # km per km²
            "minor_road_km": round(km[3]),
            "minor_major_ratio": round(ratio, 2),
            "minor_incomplete": ratio < MINOR_MAJOR_MIN,
        }
    else:  # building/volume-only refresh: keep the road files and their numbers
        roads = json.loads((out / "manifest.json").read_text())["roads"]
        prev = json.loads(old.read_text())["metrics"]
        road_m = {k: prev[k] for k in ("major_road_km", "major_road_density", "minor_road_km",
                                       "minor_major_ratio", "minor_incomplete")}
    (out / "manifest.json").write_text(json.dumps({"raster": raster, "roads": roads}, separators=(",", ":")))

    record = {
        "id": e.id, "short": e.short_zh, "display": e.display_zh, "name_en": e.name_en,
        "country": e.country, "region": e.region, "anchor": [e.lon, e.lat],
        "bounds": [round(v) for v in a_local.bounds],
        "a": stats,
        "metrics": {
            "density": round(stats["pop"] / stats["area_km2"]),
            "coverage": round(stats["built_km2"] / stats["area_km2"], 3),
            **road_m,
            **shape_m,
            **bldg,
        },
        "radial": radial,
        "files": {"boundary": "boundary.json", "manifest": "manifest.json", "figure_ground": "figure_ground.png"},
        "sizes": {"overview_bytes": roads["major"]["bytes"] + raster["bytes"],
                  "minor_bytes": sum(c["bytes"] for c in roads["minor"]["chunks"]),
                  "minor_chunks": len(roads["minor"]["chunks"])},
        "seconds": round(time.time() - t0, 1),
    }
    (out / "record.json").write_text(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
    return record


def write_index(entries: list[Entry]) -> Path:
    records = []
    for e in entries:
        p = WEB_DATA / e.id / "record.json"
        if p.exists():
            records.append(json.loads(p.read_text()))
    index = {"entries": records, "crs": "per-entry LAEA, metres, origin = anchor",
             "overture": OVERTURE.split("/")[4], "ghsl_epoch": EPOCH}
    path = WEB_DATA / "cities.json"
    path.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    return path


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    redo_roads = "--no-roads" not in sys.argv
    entries = load_entries()
    if args:
        todo = [e for e in entries if e.id in args]
    else:
        todo = [e for e in entries if force or not (WEB_DATA / e.id / "record.json").exists()]

    # GHSL tiles first, sequentially, so parallel workers never race on downloads.
    for e in todo:
        _, a_local, _ = urban_centre(e)
        l, b, r, t = window_mollweide_bounds(e, a_local)
        fetch.fetch_tiles_for_bounds((l - 10e3, b - 10e3, r + 10e3, t + 10e3), keys=("built_s", "pop", "built_v"))
    print(f"tiles ready; exporting {len(todo)} entries with {WORKERS} workers"
          f"{'' if redo_roads else ' (roads kept)'}", flush=True)

    with ProcessPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(export_entry, e, redo_roads): e for e in todo}
        for f in as_completed(futures):
            e = futures[f]
            try:
                r = f.result()
                m = r["metrics"]
                print(f"  ✓ {e.id:14s} {r['seconds']:5.1f}s  A {r['a']['area_km2']:>6,.0f} km²  "
                      f"height {m['avg_height_m']} m  vol {m['volume_density']} m³/m²  "
                      f"bldg {m['footprint_wmedian_m2']} m²  cluster {m['cluster_wmedian_m2']} m²  "
                      f"complete {m['bldg_completeness']}{'  ⚑bldg' if m['bldg_incomplete'] else ''}", flush=True)
            except Exception as exc:  # keep going; report at the end
                print(f"  ✗ {e.id}: {exc!r}", flush=True)
    print(f"wrote {write_index(entries)}")


if __name__ == "__main__":
    main()
