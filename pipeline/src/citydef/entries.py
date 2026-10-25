"""The v2 entry registry: one row per comparable unit (a definition-A urban
centre), stored as references/entries.csv.

`build_registry()` derived it once from the old app's 79 seeds with the P1b
decisions applied:
  * Guangzhou + Shenzhen share one urban centre → a single entry "珠三角",
    anchored on its UCDB main name (Guangzhou).
  * Display name = main name + "（含 X、Y）" for members that are well-known
    cities in their own right (separate municipalities, ~1 M+ or
    internationally recognised). Plain suburbs/districts are not listed.
  * Anchors are traditional centres; two old seeds that had been nudged to
    feed the old matcher are restored (Miami, Istanbul).
After that the CSV is the source of truth — edit it, not this file.

    uv run python -I -m citydef.entries      # (re)build the CSV
"""

from dataclasses import dataclass

import pandas as pd

from citydef.config import ROOT

REGISTRY = ROOT / "references" / "entries.csv"
OLD_SEEDS = ROOT / "references" / "old_cities.csv"


@dataclass(frozen=True)
class Entry:
    id: str
    short_zh: str
    display_zh: str
    name_en: str
    country: str
    region: str
    lon: float  # traditional centre: projection origin + overlay anchor
    lat: float


ANCHORS = {
    "beijing": (116.3976, 39.9054),  # Tiananmen Square
    "chongqing": (106.5770, 29.5576),  # Jiefangbei
    "tokyo": (139.7671, 35.6812),  # Tokyo Station
    "paris": (2.3488, 48.8534),  # Point zéro, Notre-Dame
    "new-york": (-74.0060, 40.7128),  # City Hall
    "miami": (-80.1937, 25.7743),  # Downtown (old seed was nudged north)
    "istanbul": (28.9784, 41.0082),  # historic peninsula (old seed sat in the Bosphorus)
}

DISPLAY = {
    "prd": "珠三角（含广州、深圳、佛山、东莞、中山）",
    "tokyo": "东京（含横滨、川崎、埼玉、千叶）",
    "osaka": "大阪（含神户、京都）",
    "suzhou": "苏州（含无锡）",
    "hangzhou": "杭州（含绍兴）",
    "taipei": "台北（含新北、桃园、基隆）",
    "seoul": "首尔（含仁川、水原、高阳）",
    "san-francisco": "旧金山（含圣何塞、奥克兰）",
    "dubai": "迪拜（含沙迦、阿治曼）",
    "delhi": "德里（含古尔冈、诺伊达、加济阿巴德）",
    "jakarta": "雅加达（含勿加泗、丹格朗、德波、茂物）",
    "new-york": "纽约（含纽瓦克、泽西城）",
    "miami": "迈阿密（含劳德代尔堡）",
    "mumbai": "孟买（含塔那、新孟买）",
    "cairo": "开罗（含吉萨）",
    "manila": "马尼拉（含奎松城、加洛干）",
    "los-angeles": "洛杉矶（含长滩、阿纳海姆）",
    "ho-chi-minh": "胡志明市（含边和）",
    "lima": "利马（含卡亚俄）",
    "kuala-lumpur": "吉隆坡（含巴生、八打灵再也）",
    "toronto": "多伦多（含密西沙加、布兰普顿）",
    "athens": "雅典（含比雷埃夫斯）",
    "boston": "波士顿（含剑桥）",
}


def build_registry() -> pd.DataFrame:
    old = pd.read_csv(OLD_SEEDS)
    old = old[old["display"]].copy()
    rows = []
    for r in old.itertuples():
        if r.id == "shenzhen":
            continue  # merged into prd
        eid = "prd" if r.id == "guangzhou" else r.id
        lon, lat = ANCHORS.get(eid, (r.lon, r.lat))
        short = "珠三角" if eid == "prd" else r.name_zh
        rows.append({
            "id": eid, "short_zh": short, "display_zh": DISPLAY.get(eid, short),
            "name_en": "Pearl River Delta" if eid == "prd" else r.name,
            "country": r.country, "region": r.region, "lon": lon, "lat": lat,
        })
    df = pd.DataFrame(rows)
    df.to_csv(REGISTRY, index=False)
    return df


def load_entries() -> list[Entry]:
    df = pd.read_csv(REGISTRY)
    return [Entry(**{k: getattr(r, k) for k in Entry.__dataclass_fields__}) for r in df.itertuples()]


if __name__ == "__main__":
    df = build_registry()
    print(f"{len(df)} entries → {REGISTRY}")
    print(df.region.value_counts().to_dict())
