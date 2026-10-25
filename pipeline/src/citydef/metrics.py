"""Size, density, distribution and shape metrics for a definition mask.

All on the city's LAEA grid: 1 cell = 1 ha exactly, distances true to ~0.1%.
"""

import math

import numpy as np
from scipy import ndimage

from citydef.config import RING_MAX_M, RING_WIDTH_M
from citydef.definitions import EIGHT
from citydef.grid import CENTRE, RES, Layers, N

_YY, _XX = np.indices((N, N))
DIST_KM = np.hypot(_YY - CENTRE, _XX - CENTRE) * RES / 1000.0  # from the seed

_METRIC_KEYS = (
    "area_km2", "pop_m", "pop_density", "built_km2", "built_share", "n_parts",
    "largest_part_share", "eq_diameter_km", "reach_p95_km", "reach_max_km",
    "proximity_index", "centroid_offset_km", "touches_window_edge",
)


def touches_edge(mask: np.ndarray) -> bool:
    return bool(mask[0].any() or mask[-1].any() or mask[:, 0].any() or mask[:, -1].any())


def mask_metrics(mask: np.ndarray, layers: Layers) -> dict:
    cells = int(mask.sum())
    if cells == 0:
        return dict.fromkeys(_METRIC_KEYS, None) | {"area_km2": 0.0, "touches_window_edge": False}
    area = cells * 0.01
    pop = float(layers.pop[mask].sum())
    built = float(layers.built[mask].sum()) / 1e6

    lab, n_parts = ndimage.label(mask, EIGHT)
    sizes = ndimage.sum(mask, lab, index=np.arange(1, n_parts + 1))

    ys, xs = np.nonzero(mask)
    cy, cx = ys.mean(), xs.mean()
    mean_to_centroid = float(np.hypot(ys - cy, xs - cx).mean()) * RES / 1000.0
    r_eq = math.sqrt(area / math.pi)
    d_seed = DIST_KM[mask]

    return {
        "area_km2": round(area, 1),
        "pop_m": round(pop / 1e6, 3),
        "pop_density": round(pop / area),  # residents per km²
        "built_km2": round(built, 1),
        "built_share": round(built / area, 3),
        "n_parts": int(n_parts),
        "largest_part_share": round(float(sizes.max()) / cells, 3),
        "eq_diameter_km": round(2 * r_eq, 1),
        "reach_p95_km": round(float(np.percentile(d_seed, 95)), 1),
        "reach_max_km": round(float(d_seed.max()), 1),
        # Angel et al. (2010) proximity index: mean distance to the centre of
        # an equal-area circle (2r/3) over the shape's mean distance to its
        # centroid. 1 = disc; lower = more stretched or fragmented.
        "proximity_index": round((2.0 / 3.0) * r_eq / mean_to_centroid, 3),
        "centroid_offset_km": round(math.hypot(cy - CENTRE, cx - CENTRE) * RES / 1000.0, 1),
        "touches_window_edge": touches_edge(mask),
    }


def radial_profile(layers: Layers, masks: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """Per 1 km ring around the seed: density, built-up share, definition coverage."""
    nr = int(RING_MAX_M // RING_WIDTH_M)
    ring = (DIST_KM * 1000.0 // RING_WIDTH_M).astype(int)
    inside = ring < nr
    r = ring[inside]
    cells = np.bincount(r, minlength=nr).astype(float)
    out = {
        "ring_km": np.arange(nr) * RING_WIDTH_M / 1000.0,
        "pop_density": np.bincount(r, weights=layers.pop[inside], minlength=nr) / (cells * 0.01),
        "built_share": np.bincount(r, weights=layers.built[inside], minlength=nr) / (cells * 10_000.0),
    }
    for key, m in masks.items():
        out[f"cover_{key}"] = np.bincount(r, weights=m[inside].astype(float), minlength=nr) / cells
    return out
