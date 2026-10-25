"""Cities, data sources and method parameters for the P1 definition study.

Every number that shapes a boundary lives here, so the report can print the
exact parameters it was produced with.
"""

from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # .../pipeline
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
OUT = ROOT / "out" / "p1"

# GHSL grids are World Mollweide (EPSG:54009), an equal-area projection, so a
# 100 m cell is exactly 1 ha and areas are cell counts — no planar shortcuts.
CRS_MOLLWEIDE = "ESRI:54009"
EPOCH = 2020  # last GHSL epoch that is an estimate rather than a projection

GHSL_FTP = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL"
GEOBOUNDARIES_API = "https://www.geoboundaries.org/api/current/gbOpen"

# Half-width of the analysis window around each city centre. Large enough to
# hold the Tokyo–Yokohama conurbation, which runs ~70 km from Tokyo Station.
WINDOW_HALF_M = 110_000


@dataclass(frozen=True)
class AdminSpec:
    """The 'city proper' used by definition C: built-up ∩ administrative unit."""

    iso: str
    level: str
    names: tuple[str, ...]  # shapeName values to union
    label: str  # what the unit is, for the report


@dataclass(frozen=True)
class City:
    id: str
    name: str
    name_zh: str
    lon: float  # traditional centre (city hall / landmark), used as the seed
    lat: float
    centre_label: str
    admin: AdminSpec
    notes: tuple[str, ...] = field(default_factory=tuple)


CITIES: tuple[City, ...] = (
    City(
        "beijing", "Beijing", "北京", 116.3976, 39.9054, "Tiananmen Square",
        AdminSpec("CHN", "ADM1", ("Beijing Municipality",), "北京市 (municipality, all 16 districts)"),
    ),
    City(
        "chongqing", "Chongqing", "重庆", 106.5770, 29.5576, "Jiefangbei",
        AdminSpec("CHN", "ADM1", ("Chongqing Municipality",), "重庆市 (municipality, 26 districts + 12 counties)"),
    ),
    City(
        "tokyo", "Tokyo", "东京", 139.7671, 35.6812, "Tokyo Station",
        AdminSpec("JPN", "ADM1", ("Tokyo",), "東京都 (Tokyo Metropolis)"),
    ),
    City(
        "paris", "Paris", "巴黎", 2.3488, 48.8534, "Point zéro, Notre-Dame",
        AdminSpec("FRA", "ADM2", ("Paris",), "Ville de Paris (commune = département 75)"),
    ),
    City(
        "new-york", "New York", "纽约", -74.0060, 40.7128, "City Hall",
        AdminSpec(
            "USA", "ADM2", ("New York", "Kings", "Queens", "Bronx", "Richmond"),
            "New York City (5 boroughs = 5 counties)",
        ),
    ),
)

# ---- Definition A: GHSL urban centre (Degree of Urbanisation) --------------
# GHS-SMOD class 30 = urban centre: contiguous 1 km² cells with ≥1,500
# inhabitants/km² (or dense built-up), ≥50,000 inhabitants, gaps filled.
SMOD_URBAN_CENTRE = 30
# A+ widens A with the contiguous L2 urban-cluster and suburban/peri-urban
# cells (≥300 inhabitants/km²): 21 suburban, 22 semi-dense, 23 dense cluster.
SMOD_URBAN_PLUS = (21, 22, 23, 30)

# ---- Definition B: built-up density threshold -------------------------------
# Atlas of Urban Expansion style: a 100 m cell's "local built-up density" is the
# built-up share inside its 1 km² walking-distance circle (r = 564 m). Cells
# at or above the threshold, connected to the centre, form the urban extent.
# GHS-BUILT-S measures building footprint, not impervious surface, so the
# Atlas's 25%/50% cut-offs do not transfer: inside the GHSL urban centres the
# median local footprint share is only 0.19–0.30. 0.10 is a compromise, not a
# principled value: at 0.05 Beijing, Tokyo and New York run into the window
# edge, and at 0.075 Tokyo already spreads to ~10,000 km² (P1 sweep).
B_NEIGHBOURHOOD_RADIUS_M = 564.0
B_THRESHOLD = 0.10
B_COMPARE = 0.20  # second level drawn on the maps to show the sensitivity
B_SWEEP = (0.05, 0.075, 0.10, 0.125, 0.15, 0.175, 0.20, 0.25, 0.30, 0.40)
B_FILL_HOLES_HA = 200  # enclosed open space below this is "captured" (Atlas)

# Radial profiles: 1 km rings out to the window edge.
RING_WIDTH_M = 1_000
RING_MAX_M = 100_000
