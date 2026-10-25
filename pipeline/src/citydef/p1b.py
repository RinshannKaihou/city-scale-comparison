"""P1b: run definition A (GHSL urban centre, 2020) over every city of the old
app and flag anything that needs a human decision before A is adopted.

    uv run python -I -m citydef.p1b

Vector-only: works from the GHS-UCDB polygons and attributes, so no extra
raster download. Writes out/p1b/ (per-city table, anomaly list, atlas).
"""

import json
import re
import unicodedata

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from pyproj import CRS
from shapely.geometry import Point, box, shape

from citydef import definitions, plots
from citydef.config import EPOCH, ROOT

OLD_REPO = ROOT.parents[1] / "city-scale-compare"
OLD_SEEDS_CSV = ROOT / "references" / "old_cities.csv"
OUT = ROOT / "out" / "p1b"

# ---- Anomaly rules (each one is a sentence in the report) --------------------
WINDOW_KM = 110  # P1 analysis / display half-window
SNAP_KM = 3  # seed outside A, but an urban centre this close: a placement slip
SATELLITE_RADIUS_KM = 30  # look for a bigger urban centre this close ...
SATELLITE_POP_RATIO = 2.0  # ... with at least this many times the population
SMALL_POP = 1_000_000  # a "world city" whose urban centre is this small needs a look
REGION_RADIUS_KM = 50  # the matched centre should hold most urban-centre people this close
REGION_SHARE_MIN = 0.70
BORDER_KM = 10  # UCDB splits urban centres at national borders: a foreign one this close

FLAG_LABELS = {
    "seed_outside": "中心点不在任何城市中心内",
    "shared_uc": "多城落进同一城市中心",
    "exceeds_window": f"城市中心超出 ±{WINDOW_KM} km 窗口",
    "name_mismatch": "城市中心名称不含该城市名",
    "satellite": f"{SATELLITE_RADIUS_KM} km 内有人口 ≥{SATELLITE_POP_RATIO:g} 倍的城市中心",
    "small": f"城市中心人口 < {SMALL_POP / 1e6:g} M",
    "polycentric": f"区域多核：{REGION_RADIUS_KM} km 内城市中心人口只有 <{REGION_SHARE_MIN:.0%} 在本城市中心",
    "cross_border": f"边界 {BORDER_KM} km 内有别国的城市中心（UCDB 按国界切开）",
}

_SEED_RE = re.compile(
    r"\{\s*id:\s*'(?P<id>[^']+)',\s*name:\s*(?P<q>['\"])(?P<name>.+?)(?P=q),\s*nameZh:\s*'(?P<name_zh>[^']+)',"
    r"\s*country:\s*'(?P<country>[^']+)',\s*region:\s*'(?P<region>[^']+)',"
    r"\s*lat:\s*(?P<lat>-?[\d.]+),\s*lon:\s*(?P<lon>-?[\d.]+)(?P<tail>[^}]*)\}"
)


def import_old_seeds() -> pd.DataFrame:
    """One-off: lift the seed list out of the old extractor (parsed as text,
    never executed — the old script rewrites cities.json when run)."""
    if OLD_SEEDS_CSV.exists():
        return pd.read_csv(OLD_SEEDS_CSV)
    src = (OLD_REPO / "scripts" / "extract-urban-areas.js").read_text(encoding="utf-8")
    block = src[src.index("const cities = [") : src.index("\n];", src.index("const cities = ["))]
    rows = []
    for m in _SEED_RE.finditer(block):
        rows.append({
            "id": m["id"], "name": m["name"], "name_zh": m["name_zh"], "country": m["country"],
            "region": m["region"], "lat": float(m["lat"]), "lon": float(m["lon"]),
            "display": "display: false" not in m["tail"],
        })
    old = json.loads((OLD_REPO / "public" / "data" / "cities.json").read_text(encoding="utf-8"))
    old_area = {c["id"]: c["areaKm2"] for c in old}
    df = pd.DataFrame(rows)
    df["old_area_km2"] = df["id"].map(old_area)
    OLD_SEEDS_CSV.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OLD_SEEDS_CSV, index=False)
    return df


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _laea(lon: float, lat: float) -> CRS:
    return CRS.from_proj4(f"+proj=laea +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m +no_defs")


def load_ucdb() -> gpd.GeoDataFrame:
    pts = gpd.read_file(definitions.UCDB, layer="GHSL_UCDB_MTUC_GLOBE_R2024", ignore_geometry=True)
    polys = gpd.read_file(definitions.UCDB, layer=f"GHSL_UCDB_MTUC_{EPOCH}_GLOBE_R2024")
    attrs = pts[["ID_MTUC_G0", "GC_UCN_MAI_2025", "GC_UCN_LIS_2025", "GC_CNT_GAD_2025",
                 f"MT_UCA_KM2_{EPOCH}", f"MT_POP_TOT_{EPOCH}"]]
    polys = polys.merge(attrs, left_on="ID_UC_G0", right_on="ID_MTUC_G0", how="left")
    return polys.rename(columns={
        "ID_UC_G0": "uc_id", "GC_UCN_MAI_2025": "uc_name", "GC_UCN_LIS_2025": "uc_members",
        "GC_CNT_GAD_2025": "uc_country", f"MT_UCA_KM2_{EPOCH}": "uc_area_km2", f"MT_POP_TOT_{EPOCH}": "uc_pop",
    })


def match_city(city: pd.Series, ucs: gpd.GeoDataFrame) -> tuple[dict, gpd.GeoDataFrame]:
    """Containing (or nearest) urban centre for one seed, measured in the
    seed's own LAEA so distances are true."""
    t = gpd.GeoSeries([Point(city.lon, city.lat)], crs=4326).to_crs(ucs.crs).iloc[0]
    # Generous Mollweide box: its shear far from the central meridian
    # distorts distances by up to ~2x, and we only need ≤ WINDOW_KM in truth.
    near = ucs.iloc[ucs.sindex.query(box(t.x - 400e3, t.y - 400e3, t.x + 400e3, t.y + 400e3))]
    local = near.to_crs(_laea(city.lon, city.lat))
    seed = Point(0.0, 0.0)
    dist_km = local.distance(seed) / 1000.0
    local = local.assign(dist_km=dist_km).sort_values("dist_km")
    inside = local[local.dist_km == 0]
    hit = inside.iloc[0] if len(inside) else local.iloc[0]

    coords = shapely.get_coordinates(hit.geometry)
    reach_km = float(np.hypot(coords[:, 0], coords[:, 1]).max()) / 1000.0
    c = hit.geometry.centroid
    ring = local[(local.dist_km <= SATELLITE_RADIUS_KM) & (local.uc_id != hit.uc_id)]
    bigger = ring[ring.uc_pop >= SATELLITE_POP_RATIO * hit.uc_pop].sort_values("uc_pop", ascending=False)
    region = local[local.dist_km <= REGION_RADIUS_KM]
    # 244 small 2020 centres (≤38 km²) are gone by 2025 and so have no row in
    # the 2025-keyed attribute table; they carry no name/country — skip them.
    named = local[local.uc_country.notna()]
    neighbours = named[(named.dist_km <= REGION_RADIUS_KM) & (named.uc_id != hit.uc_id)]
    neighbours = neighbours.sort_values("uc_pop", ascending=False).head(2)
    # Border adjacency is measured edge to edge (Brazzaville touches Kinshasa
    # across the river), not from the seed.
    abroad = named[named.uc_country != hit.uc_country]
    gap_km = abroad.distance(hit.geometry) / 1000.0
    foreign = abroad.assign(gap_km=gap_km)[gap_km <= BORDER_KM].sort_values("gap_km")

    names = [_norm(n) for n in str(hit.uc_members or hit.uc_name).split("; ")] + [_norm(str(hit.uc_name))]
    key = _norm(city["name"])
    name_ok = any(key in n or (n and n in key) for n in names)

    rec = {
        "id": city.id, "name": city["name"], "name_zh": city.name_zh, "region": city.region,
        "seed_lat": city.lat, "seed_lon": city.lon,
        "uc_id": int(hit.uc_id), "uc_name": hit.uc_name, "uc_country": hit.uc_country,
        "uc_area_km2": float(hit.uc_area_km2), "uc_pop_m": round(float(hit.uc_pop) / 1e6, 2),
        "seed_inside": bool(len(inside)), "seed_dist_km": round(float(hit.dist_km), 2),
        "reach_km": round(reach_km, 1), "centroid_offset_km": round(float(np.hypot(c.x, c.y)) / 1000.0, 1),
        "name_ok": name_ok,
        "bigger_uc_nearby": "" if bigger.empty else
            f"{bigger.iloc[0].uc_name} ({bigger.iloc[0].uc_pop / 1e6:.1f} M, {bigger.iloc[0].dist_km:.0f} km)",
        "region_ucs": int(len(region)),
        "region_share": round(float(hit.uc_pop) / float(region.uc_pop.sum()), 2),
        "top_neighbours": "；".join(
            f"{n.uc_name} {n.uc_pop / 1e6:.1f} M（{n.dist_km:.0f} km）" for n in neighbours.itertuples()
        ),
        "foreign_uc_nearby": "" if foreign.empty else
            f"{foreign.iloc[0].uc_name}, {foreign.iloc[0].uc_country}（边界相距 {foreign.iloc[0].gap_km:.1f} km）",
        "old_area_km2": city.old_area_km2,
    }
    return rec, local


def flag(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    shared = df.groupby("uc_id")["id"].transform("count") > 1
    df["seed_outside"] = ~df.seed_inside
    df["shared_uc"] = shared & df.seed_inside
    df["exceeds_window"] = df.reach_km > WINDOW_KM
    df["name_mismatch"] = ~df.name_ok
    df["satellite"] = df.bigger_uc_nearby != ""
    df["small"] = df.uc_pop_m < SMALL_POP / 1e6
    df["polycentric"] = (df.region_share < REGION_SHARE_MIN) & ~df.satellite
    df["cross_border"] = df.foreign_uc_nearby != ""
    df["flags"] =df.apply(lambda r: ",".join(k for k in FLAG_LABELS if r[k]), axis=1)
    df["old_over_new"] = (df.old_area_km2 / df.uc_area_km2).round(2)
    return df


def suggestion(r: pd.Series) -> str:
    tips = []
    if r.seed_outside:
        if r.seed_dist_km <= SNAP_KM:
            tips.append(f"中心点偏出 {r.seed_dist_km:.1f} km，就近吸附到 {r.uc_name} 即可")
        else:
            tips.append(f"最近的城市中心 {r.uc_name} 在 {r.seed_dist_km:.0f} km 外：核对中心点坐标")
    if r.satellite:
        tips.append(f"中心点可能落在卫星城；附近更大的是 {r.bigger_uc_nearby}")
    if r.shared_uc:
        tips.append("与同组城市合并展示，或用 A ∩ 行政区拆分")
    if r.name_mismatch and not r.seed_outside:
        tips.append(f"所属城市中心名为 {r.uc_name}：确认这就是该城")
    if r.exceeds_window:
        tips.append(f"外沿 {r.reach_km:.0f} km：v2 的等比例视窗或缩放上限要容得下")
    if r.small and not (r.seed_outside or r.satellite):
        tips.append("城市中心偏小：可能被地形或水体切碎，核对附近独立的城市中心")
    if r.polycentric:
        tips.append(f"{REGION_RADIUS_KM} km 内有 {r.region_ucs} 个城市中心，本城只占 {r.region_share:.0%} 人口："
                    "面积与人口按 A 计会显著偏小，界面需说明")
    if r.cross_border:
        tips.append(f"国界对面紧邻 {r.foreign_uc_nearby}，A 在国界处截断")
    return "；".join(tips)


def old_polygons() -> dict:
    path = OLD_REPO / "public" / "data" / "cities.json"
    if not path.exists():
        return {}
    return {c["id"]: shape(c["geojson"]) for c in json.loads(path.read_text(encoding="utf-8"))}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    seeds = import_old_seeds()
    cities = seeds[seeds.display].reset_index(drop=True)
    ucs = load_ucdb()
    coast = gpd.read_file(OLD_REPO / "ne_10m_coastline.shp") if (OLD_REPO / "ne_10m_coastline.shp").exists() else None
    old = old_polygons()

    recs, panels = [], {}
    for _, city in cities.iterrows():
        rec, local = match_city(city, ucs)
        recs.append(rec)
        crs = _laea(city.lon, city.lat)
        panels[city.id] = {
            "local": local[local.dist_km < WINDOW_KM][["uc_id", "geometry"]],
            "old": gpd.GeoSeries([old[city.id]], crs=4326).to_crs(crs).iloc[0] if city.id in old else None,
            "coast": coast.clip(box(city.lon - 3, city.lat - 3, city.lon + 3, city.lat + 3)).to_crs(crs)
            if coast is not None else None,
        }
    df = flag(pd.DataFrame(recs))
    df["suggestion"] = df.apply(suggestion, axis=1)
    df.to_csv(OUT / "a_all_cities.csv", index=False)

    groups = df[df.shared_uc].groupby(["uc_id", "uc_name"]).agg(
        cities=("name_zh", "、".join), area_km2=("uc_area_km2", "first"), pop_m=("uc_pop_m", "first")
    ).reset_index()
    groups.to_csv(OUT / "a_shared_groups.csv", index=False)

    plots.fig_atlas(df, panels, WINDOW_KM, OUT / "fig_atlas_a.png")

    print(f"{len(df)} cities; flagged: {int((df["flags"] != '').sum())}")
    for k, label in FLAG_LABELS.items():
        ids = df[df[k]].name_zh.tolist()
        print(f"  {label}: {len(ids)}  {'、'.join(ids)}")


if __name__ == "__main__":
    main()
