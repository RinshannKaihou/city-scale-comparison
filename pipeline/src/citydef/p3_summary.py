"""P3 summary: every exported entry's record → one table + headline numbers.

    uv run python -I -m citydef.p3_summary
"""

import json

import pandas as pd

from citydef.config import ROOT
from citydef.entries import load_entries
from citydef.export import WEB_DATA

OUT = ROOT / "out" / "p3"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rows, missing = [], []
    for e in load_entries():
        p = WEB_DATA / e.id / "record.json"
        if not p.exists():
            missing.append(e.id)
            continue
        r = json.loads(p.read_text())
        m, a, s = r["metrics"], r["a"], r["sizes"]
        edge = next((i for i, c in enumerate(r["radial"]["a_cover"]) if c < 0.5), None)
        rows.append({
            "id": r["id"], "display": r["display"], "region": r["region"], "country": r["country"],
            "area_km2": a["area_km2"], "pop_m": round(a["pop"] / 1e6, 2), "density": m["density"],
            "coverage": m["coverage"], "major_road_density": m["major_road_density"],
            "minor_major_ratio": m["minor_major_ratio"], "minor_incomplete": m["minor_incomplete"],
            "reach_p95_km": m["reach_p95_km"], "proximity_index": m["proximity_index"],
            "avg_height_m": m.get("avg_height_m"), "volume_density": m.get("volume_density"),
            "footprint_wmedian_m2": m.get("footprint_wmedian_m2"), "cluster_wmedian_m2": m.get("cluster_wmedian_m2"),
            "bldg_per_km2": m.get("bldg_per_km2"), "bldg_completeness": m.get("bldg_completeness"),
            "bldg_incomplete": m.get("bldg_incomplete"),
            "a_edge_km": edge, "centre_density": r["radial"]["pop_density"][0],
            "overview_mb": round(s["overview_bytes"] / 1e6, 2), "minor_mb": round(s["minor_bytes"] / 1e6, 2),
            "minor_chunks": s["minor_chunks"], "seconds": r["seconds"],
        })
    df = pd.DataFrame(rows)
    df.to_csv(OUT / "metrics_all.csv", index=False)

    pd.set_option("display.width", 220)
    pd.set_option("display.max_rows", 200)
    print(f"{len(df)} entries exported; missing: {missing or 'none'}")
    print(f"data: overview {df.overview_mb.sum():.0f} MB, minor {df.minor_mb.sum():.0f} MB, "
          f"chunks {df.minor_chunks.sum()}, export time {df.seconds.sum() / 60:.0f} min (sum of workers)")
    flagged = df[df.minor_incomplete].sort_values("minor_major_ratio")
    print(f"\nminor roads incomplete (ratio < 1): {len(flagged)}")
    print(flagged[["display", "country", "minor_major_ratio", "major_road_density"]].to_string(index=False))
    print("\nby region: ratio median / flagged count")
    print(df.groupby("region").agg(ratio_median=("minor_major_ratio", "median"), flagged=("minor_incomplete", "sum"),
                                   n=("id", "count")).to_string())
    cols = ["display", "area_km2", "pop_m", "density", "coverage", "major_road_density", "reach_p95_km", "proximity_index"]
    print("\ndensest 8:")
    print(df.nlargest(8, "density")[cols].to_string(index=False))
    print("\nsparsest 8:")
    print(df.nsmallest(8, "density")[cols].to_string(index=False))
    print("\nhighest coverage 5 / lowest 5:")
    print(df.nlargest(5, "coverage")[cols].to_string(index=False))
    print(df.nsmallest(5, "coverage")[cols].to_string(index=False))
    print("\nmain-road density highest 5 / lowest 5:")
    print(df.nlargest(5, "major_road_density")[cols].to_string(index=False))
    print(df.nsmallest(5, "major_road_density")[cols].to_string(index=False))

    # ---- P4: building-based form -------------------------------------------------
    if df["avg_height_m"].notna().any():
        b = ["display", "density", "coverage", "volume_density", "avg_height_m", "footprint_wmedian_m2",
             "cluster_wmedian_m2", "bldg_completeness"]
        print("\nbuilding completeness (Overture / GHSL footprint) by region: median / flagged / n")
        print(df.groupby("region").agg(median=("bldg_completeness", "median"), flagged=("bldg_incomplete", "sum"),
                                       n=("id", "count")).round(2).to_string())
        print("\nbuilding data flagged:", ", ".join(df[df.bldg_incomplete].sort_values("bldg_completeness")
                                                   .apply(lambda r: f"{r.display} {r.bldg_completeness}", axis=1)))
        for col, label in (("volume_density", "volume density"), ("avg_height_m", "avg height"),
                           ("footprint_wmedian_m2", "building scale"), ("cluster_wmedian_m2", "cluster scale")):
            print(f"\n{label} highest 6 / lowest 6:")
            print(df.nlargest(6, col)[b].to_string(index=False))
            print(df.nsmallest(6, col)[b].to_string(index=False))
        print("\nregion medians:")
        print(df.groupby("region")[["volume_density", "avg_height_m", "footprint_wmedian_m2", "cluster_wmedian_m2"]]
              .median().round(1).to_string())


if __name__ == "__main__":
    main()
