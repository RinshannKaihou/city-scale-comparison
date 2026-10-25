"""The candidate city definitions, each a boolean mask on the city grid.

A   GHSL urban centre (Degree of Urbanisation), the official GHS-UCDB polygon.
A*  the same rule re-derived from GHS-SMOD class 30 — a check that we read the
    official product the way it was built, not a separate definition.
A+  A plus the contiguous suburban / urban-cluster cells (SMOD 21–23).
B   built-up density threshold (Atlas of Urban Expansion style), the
    contiguous extent around the seed.
C   B cut to the city-proper administrative unit.
C+  every B-threshold patch ≥ 1 km² inside the administrative unit, including
    detached satellite towns — the closest analogue of China's 建成区 caliber.
"""

from dataclasses import dataclass
from functools import lru_cache

import geopandas as gpd
import numpy as np
from rasterio.features import rasterize
from scipy import ndimage

from citydef.config import (
    B_FILL_HOLES_HA,
    B_NEIGHBOURHOOD_RADIUS_M,
    EPOCH,
    RAW,
    SMOD_URBAN_CENTRE,
    SMOD_URBAN_PLUS,
    City,
)
from citydef.grid import CENTRE, RES, Layers, N, city_crs, city_transform

EIGHT = np.ones((3, 3), dtype=bool)
FOUR = ndimage.generate_binary_structure(2, 1)
C_PLUS_MIN_PATCH_HA = 100

UCDB = RAW / "ucdb_mtuc" / "GHS_UCDB_MTUC_GLOBE_R2024A_V1_2" / "GHS_UCDB_MTUC_GLOBE_R2024A.gpkg"


@dataclass
class UcdbEntry:
    id: int
    name: str
    area_km2: float  # official MT_UCA_KM2_<epoch>
    pop: float  # official MT_POP_TOT_<epoch>
    mask: np.ndarray


def component_at_centre(mask: np.ndarray, structure=EIGHT, search_m: float = 2_000) -> np.ndarray:
    """Connected component of `mask` that holds the seed.

    If the seed cell itself is off the mask (it sits in a park or on a river),
    take the nearest component within `search_m` instead.
    """
    labels, _ = ndimage.label(mask, structure)
    lab = labels[CENTRE, CENTRE]
    if lab == 0:
        r = int(search_m / RES)
        win = labels[CENTRE - r : CENTRE + r + 1, CENTRE - r : CENTRE + r + 1]
        ys, xs = np.nonzero(win)
        if len(ys) == 0:
            return np.zeros_like(mask)
        k = np.argmin((ys - r) ** 2 + (xs - r) ** 2)
        lab = win[ys[k], xs[k]]
    return labels == lab


def fill_small_holes(mask: np.ndarray, max_cells: int) -> np.ndarray:
    """Fill enclosed open space smaller than `max_cells` (Atlas "captured open space")."""
    holes = ndimage.binary_fill_holes(mask) & ~mask
    lab, n = ndimage.label(holes, FOUR)
    if n == 0:
        return mask
    sizes = ndimage.sum(holes, lab, index=np.arange(1, n + 1))
    small = np.zeros(n + 1, dtype=bool)
    small[1:] = sizes < max_cells
    return mask | small[lab]


# ---- A: GHSL urban centre ----------------------------------------------------


@lru_cache(maxsize=1)
def _ucdb_layers(epoch: int):
    pts = gpd.read_file(UCDB, layer="GHSL_UCDB_MTUC_GLOBE_R2024")
    polys = gpd.read_file(UCDB, layer=f"GHSL_UCDB_MTUC_{epoch}_GLOBE_R2024")
    return pts, polys


def definition_a(city: City, epoch: int = EPOCH) -> UcdbEntry:
    pts, polys = _ucdb_layers(epoch)
    local = polys.to_crs(city_crs(city))
    seed = gpd.points_from_xy([0.0], [0.0])[0]
    hit = local[local.contains(seed)]
    if hit.empty:  # seed in a gap of the 1 km grid: nearest centre within 2 km
        dist = local.distance(seed)
        hit = local[dist == dist.min()]
        if dist.min() > 2_000:
            raise ValueError(f"{city.id}: no urban centre within 2 km of the seed")
    uc_id = int(hit.iloc[0]["ID_UC_G0"])
    row = pts[pts["ID_MTUC_G0"] == uc_id].iloc[0]
    mask = rasterize(
        [(hit.iloc[0].geometry, 1)],
        out_shape=(N, N),
        transform=city_transform(),
        fill=0,
        dtype="uint8",
    ).astype(bool)
    return UcdbEntry(
        uc_id,
        str(row["GC_UCN_MAI_2025"]),
        float(row[f"MT_UCA_KM2_{epoch}"]),
        float(row[f"MT_POP_TOT_{epoch}"]),
        mask,
    )


def definition_a_smod(layers: Layers) -> np.ndarray:
    # Degree of Urbanisation joins urban-centre cells by edge (4-)contiguity.
    return component_at_centre(layers.smod == SMOD_URBAN_CENTRE, FOUR)


def definition_a_plus(layers: Layers) -> np.ndarray:
    return component_at_centre(np.isin(layers.smod, SMOD_URBAN_PLUS), FOUR)


# ---- B: built-up density threshold -------------------------------------------


def local_density(layers: Layers) -> np.ndarray:
    """Built-up share inside each cell's 1 km² circular neighbourhood."""
    share = np.clip(layers.built / 10_000.0, 0.0, 1.0)
    r = B_NEIGHBOURHOOD_RADIUS_M / RES
    k = int(np.ceil(r))
    yy, xx = np.mgrid[-k : k + 1, -k : k + 1]
    disk = (xx**2 + yy**2) <= r * r
    return ndimage.correlate(share, disk / disk.sum(), mode="constant", cval=0.0)


def definition_b(density: np.ndarray, threshold: float) -> np.ndarray:
    core = component_at_centre(density >= threshold, EIGHT)
    return fill_small_holes(core, B_FILL_HOLES_HA)  # 1 cell == 1 ha


# ---- C: built-up ∩ administrative unit ---------------------------------------


def definition_c(b_mask: np.ndarray, layers: Layers) -> np.ndarray:
    return b_mask & layers.admin


def definition_c_plus(density: np.ndarray, threshold: float, layers: Layers) -> np.ndarray:
    patches = (density >= threshold) & layers.admin
    lab, n = ndimage.label(patches, EIGHT)
    if n == 0:
        return patches
    sizes = ndimage.sum(patches, lab, index=np.arange(1, n + 1))
    keep = np.zeros(n + 1, dtype=bool)
    keep[1:] = sizes >= C_PLUS_MIN_PATCH_HA
    return fill_small_holes(keep[lab], B_FILL_HOLES_HA) & layers.admin
