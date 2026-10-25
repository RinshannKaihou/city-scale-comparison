"""P1 definition study: run every candidate definition for the five test
cities and write metrics, threshold sweep, radial profiles, boundaries and
figures to out/p1/.

    uv run python -I -m citydef.p1
"""

import json

import geopandas as gpd
import numpy as np
import pandas as pd
from rasterio.features import shapes
from shapely.geometry import shape
from shapely.ops import unary_union

from citydef import definitions, plots
from citydef.config import B_COMPARE, B_SWEEP, B_THRESHOLD, CITIES, EPOCH, OUT, ROOT
from citydef.definitions import (
    definition_a,
    definition_a_plus,
    definition_a_smod,
    definition_b,
    definition_c,
    definition_c_plus,
    local_density,
)
from citydef.grid import city_crs, city_transform, load_layers
from citydef.metrics import mask_metrics, radial_profile

REFERENCES = ROOT / "references" / "p1_reference_figures.csv"
EXPORTED = ("A", "A+", "B", "C", "C+")
TIME_EPOCHS = (1975, 1990, 2000, 2010, 2020, 2025, 2030)

# Pairs the old app split with bisector "shadow seeds": which urban centre does
# each one fall into under definition A? (name, UCDB country)
CONURBATION_PROBES = (
    ("Guangzhou", "China"), ("Shenzhen", "China"), ("Dongguan", "China"), ("Foshan", "China"),
    ("Hong Kong", "China"), ("Suzhou", "China"), ("Wuxi", "China"),
    ("Osaka", "Japan"), ("Kobe", "Japan"), ("Kyoto", "Japan"), ("Yokohama", "Japan"),
    ("Amsterdam", "Netherlands"), ("Rotterdam", "Netherlands"), ("The Hague", "Netherlands"),
    ("Washington", "United States"), ("Baltimore", "United States"),
)


def ucdb_tables(ucdb_ids: dict[str, int]) -> tuple[pd.DataFrame, pd.DataFrame]:
    pts = gpd.read_file(definitions.UCDB, layer="GHSL_UCDB_MTUC_GLOBE_R2024", ignore_geometry=True)
    ts = []
    for city_id, uc in ucdb_ids.items():
        row = pts[pts["ID_MTUC_G0"] == uc].iloc[0]
        for y in TIME_EPOCHS:
            ts.append({"city": city_id, "epoch": y, "area_km2": row[f"MT_UCA_KM2_{y}"],
                       "pop_m": round(row[f"MT_POP_TOT_{y}"] / 1e6, 3)})
    conurb = []
    names = pts["GC_UCN_LIS_2025"].fillna("").str.split("; ")
    for name, country in CONURBATION_PROBES:
        hit = pts[names.apply(lambda ns, n=name: n in ns) & (pts["GC_CNT_GAD_2025"] == country)]
        hit = hit.sort_values(f"MT_POP_TOT_{EPOCH}", ascending=False).head(1)  # largest namesake
        for _, r in hit.iterrows():
            conurb.append({"name": name, "ucdb_id": r["ID_MTUC_G0"], "uc_main_name": r["GC_UCN_MAI_2025"],
                           "area_km2": r[f"MT_UCA_KM2_{EPOCH}"], "pop_m": round(r[f"MT_POP_TOT_{EPOCH}"] / 1e6, 2),
                           "members": r["GC_UCN_LIS_2025"]})
    return pd.DataFrame(ts), pd.DataFrame(conurb)


def boundary_features(city, masks: dict, metrics: pd.DataFrame) -> list[dict]:
    """Vectorise masks on the city grid, simplify 50 m, return WGS84 features."""
    feats = []
    for key in EXPORTED:
        mask = masks[key]
        polys = [shape(g) for g, v in shapes(mask.astype("uint8"), mask=mask, transform=city_transform()) if v]
        if not polys:
            continue
        geom = unary_union(polys).simplify(50, preserve_topology=True)
        wgs = gpd.GeoSeries([geom], crs=city_crs(city)).to_crs(4326).iloc[0]
        m = metrics[(metrics.city == city.id) & (metrics.definition == key)].iloc[0]
        feats.append({
            "type": "Feature",
            "properties": {"city": city.id, "definition": key, "area_km2": m.area_km2, "pop_m": m.pop_m},
            "geometry": json.loads(gpd.GeoSeries([wgs]).to_json(drop_id=True))["features"][0]["geometry"],
        })
    return feats


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "boundaries").mkdir(exist_ok=True)
    metric_rows, sweep_rows, radial_frames, plot_data, ucdb_rows = [], [], [], {}, []

    for city in CITIES:
        layers = load_layers(city)
        density = local_density(layers)
        a = definition_a(city)
        b = definition_b(density, B_THRESHOLD)
        masks = {
            "A": a.mask,
            "A*": definition_a_smod(layers),
            "A+": definition_a_plus(layers),
            "B": b,
            "B_cmp": definition_b(density, B_COMPARE),
            "C": definition_c(b, layers),
            "C+": definition_c_plus(density, B_THRESHOLD, layers),
            "admin": layers.admin,
        }
        ucdb_rows.append({"city": city.id, "ucdb_id": a.id, "ucdb_name": a.name,
                          "official_area_km2": a.area_km2, "official_pop_m": round(a.pop / 1e6, 3)})
        for key, mask in masks.items():
            if key != "admin":
                metric_rows.append({"city": city.id, "definition": key} | mask_metrics(mask, layers))
        for thr in B_SWEEP:
            m = mask_metrics(definition_b(density, thr), layers)
            sweep_rows.append({"city": city.id, "threshold": thr} | m)
        prof = radial_profile(layers, {k: masks[k] for k in ("A", "A+", "B", "C")})
        radial_frames.append(pd.DataFrame(prof).assign(city=city.id))
        plot_data[city.id] = {"density": density, "smod": layers.smod, "masks": masks}
        print(f"  {city.id}: done", flush=True)

    metrics = pd.DataFrame(metric_rows)
    sweep = pd.DataFrame(sweep_rows)
    radial = pd.concat(radial_frames, ignore_index=True)
    metrics.to_csv(OUT / "metrics.csv", index=False)
    sweep.to_csv(OUT / "sweep_b.csv", index=False)
    radial.round(4).to_csv(OUT / "radial.csv", index=False)
    pd.DataFrame(ucdb_rows).to_csv(OUT / "ucdb_official.csv", index=False)
    timeseries, conurbations = ucdb_tables({r["city"]: r["ucdb_id"] for r in ucdb_rows})
    timeseries.to_csv(OUT / "ucdb_timeseries.csv", index=False)
    conurbations.to_csv(OUT / "ucdb_conurbations.csv", index=False)

    for city in CITIES:
        fc = {"type": "FeatureCollection", "features": boundary_features(city, plot_data[city.id]["masks"], metrics)}
        (OUT / "boundaries" / f"{city.id}.geojson").write_text(json.dumps(fc, separators=(",", ":")))

    refs = pd.read_csv(REFERENCES) if REFERENCES.exists() else pd.DataFrame(columns=["city", "short_label", "area_km2"])
    plots.fig_maps(CITIES, plot_data, metrics, OUT / "fig1_definition_maps.png")
    plots.fig_sweep(CITIES, sweep, metrics, refs, OUT / "fig2_b_threshold_sweep.png")
    plots.fig_radial(CITIES, radial, metrics, OUT / "fig3_radial_profiles.png")

    with pd.option_context("display.width", 200, "display.max_columns", 20):
        print(metrics[["city", "definition", "area_km2", "pop_m", "pop_density", "built_share", "n_parts",
                       "reach_p95_km", "proximity_index", "touches_window_edge"]].to_string(index=False))
    print(f"epoch {EPOCH}; wrote {OUT}")


if __name__ == "__main__":
    main()
