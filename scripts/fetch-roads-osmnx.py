import json
import osmnx as ox
import time

cities = [
    ("beijing", 39.9042, 116.4074, 18000),
    ("shanghai", 31.2304, 121.4737, 15000),
    ("tokyo", 35.6762, 139.6503, 15000),
    ("new-york", 40.7128, -74.0060, 13000),
    ("london", 51.5074, -0.1278, 13000),
    ("paris", 48.8566, 2.3522, 13000),
    ("moscow", 55.7558, 37.6173, 15000),
    ("sydney", -33.8688, 151.2093, 10000),
    ("singapore", 1.3521, 103.8198, 8000),
    ("dubai", 25.2048, 55.2708, 10000),
    ("mumbai", 19.0760, 72.8777, 10000),
    ("sao-paulo", -23.5505, -46.6333, 13000),
    ("cairo", 30.0444, 31.2357, 10000),
    ("los-angeles", 34.0522, -118.2437, 15000),
    ("seoul", 37.5665, 126.9780, 13000),
]

with open("public/data/cities.json", "r") as f:
    cities_data = json.load(f)

for city_id, lat, lon, radius in cities:
    print(f"Fetching {city_id}...", flush=True)
    try:
        G = ox.graph_from_point(
            (lat, lon),
            dist=radius,
            network_type="drive",
            simplify=True,
            retain_all=True,
        )

        # Filter edges by highway type
        allowed = {"motorway", "motorway_link", "trunk", "trunk_link", 
                   "primary", "primary_link", "secondary", "secondary_link"}
        edges_to_keep = []
        for u, v, k, data in G.edges(keys=True, data=True):
            hw = data.get("highway", "")
            if isinstance(hw, list):
                hw = hw[0]
            if hw in allowed:
                edges_to_keep.append((u, v, k))

        # Create subgraph with filtered edges
        G_filtered = G.edge_subgraph(edges_to_keep).copy()

        # Convert to GeoDataFrame
        gdf = ox.graph_to_gdfs(G_filtered, nodes=False, edges=True)

        lines = []
        for geom in gdf.geometry:
            coords = list(geom.coords)
            if len(coords) >= 2:
                line = [[c[0], c[1]] for c in coords]
                lines.append(line)

        # Sort by length, keep top 800
        lines.sort(key=lambda l: len(l), reverse=True)
        lines = lines[:800]

        # Simplify each line to max 50 points
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

    # Save progress after each city
    with open("public/data/cities.json", "w") as f:
        json.dump(cities_data, f, indent=2)

    time.sleep(1)

print("\nDone!")
