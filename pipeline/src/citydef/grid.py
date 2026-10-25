"""Per-city analysis grid: a local Lambert azimuthal equal-area (LAEA) grid
centred on the city, 100 m cells, one cell centred exactly on the seed point.

GHSL ships in World Mollweide, which is equal-area but shears shapes and
distances away from its central meridian (Tokyo sits 140° off it). Resampling
each city into its own LAEA keeps areas exact AND makes distances true to
~0.1% across the window, so radial profiles, extents and the equal-scale
overlay all read off the same metric frame — the frame the v2 viewer will use.
"""

from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.coords import disjoint_bounds
from rasterio.crs import CRS
from rasterio.features import rasterize
from rasterio.merge import merge
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject, transform_bounds

from citydef.config import CRS_MOLLWEIDE, RAW, WINDOW_HALF_M, WORK, City

RES = 100.0
N = int(2 * WINDOW_HALF_M / RES) + 1  # odd, so the seed is a cell centre
CENTRE = N // 2  # row == col index of the seed cell


@dataclass
class Layers:
    built: np.ndarray  # built-up surface, m² per 1 ha cell (0–10,000)
    pop: np.ndarray  # residents per cell
    smod: np.ndarray  # GHS-SMOD class (Degree of Urbanisation L2), uint8
    admin: np.ndarray  # bool, inside the city-proper administrative unit
    transform: Affine
    crs: CRS


def city_crs(city: City) -> CRS:
    return CRS.from_proj4(
        f"+proj=laea +lat_0={city.lat} +lon_0={city.lon} +datum=WGS84 +units=m +no_defs"
    )


def city_transform() -> Affine:
    half = WINDOW_HALF_M + RES / 2
    return Affine(RES, 0.0, -half, 0.0, -RES, half)


def mollweide_bounds(city: City, pad: float = 5_000.0) -> tuple[float, float, float, float]:
    half = WINDOW_HALF_M + RES / 2 + pad
    return transform_bounds(city_crs(city), CRS_MOLLWEIDE, -half, -half, half, half, densify_pts=41)


def _tif_paths(key: str) -> list[Path]:
    return sorted((RAW / key).rglob("*.tif"))


def warp_tiles(
    paths: list[Path],
    dst_crs: CRS,
    dst_transform: Affine,
    shape: tuple[int, int],
    resampling: Resampling,
    dtype: str,
    label: str = "",
) -> np.ndarray:
    """Mosaic the GHSL tiles under a destination grid and warp onto it.

    Source nodata is excluded from the resampling and becomes 0 (no built-up /
    no residents / SMOD water-or-nodata), which is the right reading for every
    layer used here.
    """
    h, w = shape
    left, top = dst_transform.c, dst_transform.f
    right, bottom = left + w * dst_transform.a, top + h * dst_transform.e
    bounds = transform_bounds(dst_crs, CRS_MOLLWEIDE, left - 5e3, bottom - 5e3, right + 5e3, top + 5e3,
                              densify_pts=41)
    srcs = [rasterio.open(p) for p in paths]
    try:
        hits = [s for s in srcs if not disjoint_bounds(s.bounds, bounds)]
        if not hits:
            raise FileNotFoundError(f"no source tiles cover {label}: {[p.name for p in paths]}")
        mosaic, mtrans = merge(hits, bounds=bounds)
        nodata = hits[0].nodata
        src_crs = hits[0].crs
    finally:
        for s in srcs:
            s.close()
    src = mosaic[0].astype("float64")
    if nodata is not None:
        src[src == nodata] = np.nan
    src[src < 0] = np.nan
    dst = np.full(shape, np.nan, dtype="float64")
    reproject(
        src,
        dst,
        src_transform=mtrans,
        src_crs=src_crs,
        src_nodata=np.nan,
        dst_transform=dst_transform,
        dst_crs=dst_crs,
        dst_nodata=np.nan,
        resampling=resampling,
    )
    return np.nan_to_num(dst, nan=0.0).astype(dtype)


def _warp_to_city(
    paths: list[Path], city: City, resampling: Resampling, dtype: str
) -> np.ndarray:
    return warp_tiles(paths, city_crs(city), city_transform(), (N, N), resampling, dtype, city.id)


def admin_mask(city: City) -> np.ndarray:
    path = RAW / "geoboundaries" / f"geoBoundaries-{city.admin.iso}-{city.admin.level}.geojson"
    gdf = gpd.read_file(path)
    sel = gdf[gdf["shapeName"].isin(city.admin.names)].to_crs(city_crs(city))
    # Same-named units elsewhere (Kings County, CA vs Brooklyn): keep only the
    # ones that reach into the analysis window.
    sel = sel[sel.distance(gpd.points_from_xy([0.0], [0.0])[0]) < WINDOW_HALF_M]
    missing = set(city.admin.names) - set(sel["shapeName"])
    if missing:
        raise ValueError(f"{city.id}: admin units not found near the city: {sorted(missing)}")
    return rasterize(
        ((geom, 1) for geom in sel.geometry),
        out_shape=(N, N),
        transform=city_transform(),
        fill=0,
        dtype="uint8",
    ).astype(bool)


def load_layers(city: City, refresh: bool = False) -> Layers:
    cache = WORK / f"{city.id}.npz"
    if cache.exists() and not refresh:
        z = np.load(cache)
        return Layers(z["built"], z["pop"], z["smod"], z["admin"], city_transform(), city_crs(city))
    built = _warp_to_city(_tif_paths("built_s"), city, Resampling.average, "float32")
    pop = _warp_to_city(_tif_paths("pop"), city, Resampling.average, "float32")
    smod = _warp_to_city(_tif_paths("smod"), city, Resampling.nearest, "uint8")
    admin = admin_mask(city)
    WORK.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cache, built=built, pop=pop, smod=smod, admin=admin)
    return Layers(built, pop, smod, admin, city_transform(), city_crs(city))
