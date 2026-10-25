"""Download and unpack the raw inputs for the P1 study (idempotent).

Each dataset lands in its own directory under data/raw/; archives are unpacked
next to themselves. Nothing here parses data beyond the geoBoundaries API
response, so downloads stay inert until a reader opens them by path.
"""

import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

from citydef.config import CITIES, EPOCH, GEOBOUNDARIES_API, GHSL_FTP, RAW
from citydef.grid import mollweide_bounds

# GHSL 100 m Mollweide products ship as 1000 km tiles, 1-based rows/cols from
# the top-left corner (-18041000, 9000000).
TILE_M = 1_000_000
TILE_X0 = -18_041_000
TILE_Y0 = 9_000_000

GHSL_100M = {
    "built_s": f"GHS_BUILT_S_GLOBE_R2023A/GHS_BUILT_S_E{EPOCH}_GLOBE_R2023A_54009_100/V1-0/tiles/"
    f"GHS_BUILT_S_E{EPOCH}_GLOBE_R2023A_54009_100_V1_0_R{{r}}_C{{c}}.zip",
    "pop": f"GHS_POP_GLOBE_R2023A/GHS_POP_E{EPOCH}_GLOBE_R2023A_54009_100/V1-0/tiles/"
    f"GHS_POP_E{EPOCH}_GLOBE_R2023A_54009_100_V1_0_R{{r}}_C{{c}}.zip",
    # built-up volume, m³ per 1 ha cell (total, residential + non-residential)
    "built_v": f"GHS_BUILT_V_GLOBE_R2023A/GHS_BUILT_V_E{EPOCH}_GLOBE_R2023A_54009_100/V1-0/tiles/"
    f"GHS_BUILT_V_E{EPOCH}_GLOBE_R2023A_54009_100_V1_0_R{{r}}_C{{c}}.zip",
}
GHSL_GLOBAL = {
    "smod": f"GHS_SMOD_GLOBE_R2023A/GHS_SMOD_E{EPOCH}_GLOBE_R2023A_54009_1000/V2-0/"
    f"GHS_SMOD_E{EPOCH}_GLOBE_R2023A_54009_1000_V2_0.zip",
    "ucdb_mtuc": "GHS_UCDB_GLOBE_R2024A/GHS_UCDB_MTUC_GLOBE_R2024A/V1-2/GHS_UCDB_MTUC_GLOBE_R2024A_V1_2.zip",
}


def download(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "citydef-p1/0.1"})
    with urllib.request.urlopen(req, timeout=600) as res, open(tmp, "wb") as f:
        shutil.copyfileobj(res, f, length=1 << 20)
    tmp.rename(dest)
    print(f"  downloaded {dest.relative_to(RAW)} ({dest.stat().st_size / 1e6:.1f} MB)", flush=True)
    return dest


def unzip(archive: Path) -> Path:
    out = archive.with_suffix("")
    if not out.exists():
        with zipfile.ZipFile(archive) as z:
            z.extractall(out)
    return out


def tiles_for_cities() -> list[tuple[int, int]]:
    # Mollweide footprint of each city's local-LAEA window (sheared far from
    # the central meridian), so the tile set covers everything grid.py warps.
    tiles = set()
    for city in CITIES:
        left, bottom, right, top = mollweide_bounds(city)
        for x in (left, right):
            for y in (bottom, top):
                tiles.add((int((TILE_Y0 - y) // TILE_M) + 1, int((x - TILE_X0) // TILE_M) + 1))
    return sorted(tiles)


def fetch_tiles_for_bounds(mollweide_bounds_: tuple[float, float, float, float], keys=("built_s",)) -> None:
    """Make sure every 100 m tile under a Mollweide bbox is on disk."""
    left, bottom, right, top = mollweide_bounds_
    rows = range(int((TILE_Y0 - top) // TILE_M) + 1, int((TILE_Y0 - bottom) // TILE_M) + 2)
    cols = range(int((left - TILE_X0) // TILE_M) + 1, int((right - TILE_X0) // TILE_M) + 2)
    for r in rows:
        for c in cols:
            for key in keys:
                rel = GHSL_100M[key].format(r=r, c=c)
                unzip(download(f"{GHSL_FTP}/{rel}", RAW / key / Path(rel).name))


def fetch_ghsl() -> None:
    for key, rel in GHSL_GLOBAL.items():
        unzip(download(f"{GHSL_FTP}/{rel}", RAW / key / Path(rel).name))
    for r, c in tiles_for_cities():
        for key, pattern in GHSL_100M.items():
            rel = pattern.format(r=r, c=c)
            unzip(download(f"{GHSL_FTP}/{rel}", RAW / key / Path(rel).name))


def fetch_admin() -> None:
    for iso, level in sorted({(c.admin.iso, c.admin.level) for c in CITIES}):
        dest = RAW / "geoboundaries" / f"geoBoundaries-{iso}-{level}.geojson"
        if dest.exists():
            continue
        with urllib.request.urlopen(f"{GEOBOUNDARIES_API}/{iso}/{level}/", timeout=60) as res:
            meta = json.load(res)
        download(meta["gjDownloadURL"], dest)
        dest.with_suffix(".meta.json").write_text(json.dumps(meta, indent=2))


def main() -> None:
    which = set(sys.argv[1:]) or {"ghsl", "admin"}
    if "admin" in which:
        fetch_admin()
    if "ghsl" in which:
        fetch_ghsl()
    print("fetch complete", flush=True)


if __name__ == "__main__":
    main()
