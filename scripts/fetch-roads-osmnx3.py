import json
import osmnx as ox
import time

cities = [
    ("singapore", 1.3521, 103.8198, 7000),
    ("dubai", 25.2048, 55.2708, 9000),
    ("mumbai", 19.0760, 72.8777, 9000),
    ("sao-paulo", -23.5505, -46.6333, 12000),
    ("cairo", 30.0444, 31.2357, 9000),
    ("los-angeles", 34.0522, -118.2437, 13000),
    ("seoul", 37.5665, 126.9780, 12000),
]

with open("public/data/cities.json", "r") as f:
    cities_data = json.load(f)

for city_id, lat, lon, radius in cities:
    existing = next((c for c in cities_data if c["id"] == city_id), None)
    if existing and len(existing.get("roads", [])) >= 100:
        print(f"Skipping {city_id}, already has {len(existing['roads'])} segments")
        continue

    print(f"Fetching {city_id}...", flush=True)
    try:
        G = ox.graph_from_point(
            (lat, lon),
            dist=radius,
            network_type="drive",
            simplify=True,
            retain_all=True,
        )

        allowed = {"motorway", "motorway_link", "trunk", "trunk_link",
                   "primary", "primary_link", "secondary", "secondary_link"}
        edges_to_keep = []
        for u, v, k, data in G.edges(keys=True, data=True):
            hw = data.get("highway", "")
            if isinstance(hw, list):
                hw = hw[0]
            if hw in allowed:
                edges_to_keep.append((u, v, k))

        G_filtered = G.edge_subgraph(edges_to_keep).copy()
        gdf = ox.graph_to_gdfs(G_filtered, nodes=False, edges=True)

        lines = []
        for geom in gdf.geometry:
            coords = list(geom.coords)
            if len(coords) >= 2:
                line = [[c[0], c[1]] for c in coords]
                lines.append(line)

        lines.sort(key=lambda l: len(l), reverse=True)
        lines = lines[:800]

        simplified = []
        for line in lines:
            if len(line) <= 50:
                simplified.append(line)
            else:
                step = len(line) // 50 + 1
                simplified.append(line[::step])

        for c in cities_data:
            if c["id"] == city_id:
                c["roads"] = simplified
                print(f"  ✓ {len(simplified)} segments")
                break

    except Exception as e:
        print(f"  ✗ Error: {e}")

    with open("public/data/cities.json", "w") as f:
        json.dump(cities_data, f, indent=2)

    time.sleep(1)

print("\nDone!")
