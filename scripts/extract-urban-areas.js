// Match each city to its Natural Earth built-up urban area.
//
// Algorithm:
//   For each city, collect every polygon whose centroid is within
//   NEIGHBOR_RADIUS_DEG of the city center OR that strictly contains
//   the center. Output the union as a MultiPolygon (Polygon if only
//   one piece matched).
//
// Why collect nearby, not just "containing":
//   Natural Earth splits urban areas at water bodies. A city center
//   dropped into one narrow strait fragment (e.g. Lower Manhattan's
//   polygon at 49 km²) misses the other 90% of the metro. Collecting
//   a neighborhood stitches these pieces back together.
//
// The authoritative areaKm2 is the sum of each included feature's
// `area_sqkm` — this matches what we're actually drawing.
//
// Output: public/data/cities.json (overwrites existing).

import fs from 'fs';

const urbanAreas = JSON.parse(fs.readFileSync('./urban_areas.json', 'utf-8'));

const cities = [
  { id: 'beijing',     name: 'Beijing',     nameZh: '北京',   country: 'China',       lat: 39.9042,  lon: 116.4074 },
  { id: 'shanghai',    name: 'Shanghai',    nameZh: '上海',   country: 'China',       lat: 31.2304,  lon: 121.4737 },
  { id: 'tokyo',       name: 'Tokyo',       nameZh: '东京',   country: 'Japan',       lat: 35.6762,  lon: 139.6503 },
  { id: 'new-york',    name: 'New York',    nameZh: '纽约',   country: 'USA',         lat: 40.7128,  lon: -74.0060 },
  { id: 'london',      name: 'London',      nameZh: '伦敦',   country: 'UK',          lat: 51.5074,  lon: -0.1278  },
  { id: 'paris',       name: 'Paris',       nameZh: '巴黎',   country: 'France',      lat: 48.8566,  lon: 2.3522   },
  { id: 'moscow',      name: 'Moscow',      nameZh: '莫斯科', country: 'Russia',      lat: 55.7558,  lon: 37.6173  },
  { id: 'sydney',      name: 'Sydney',      nameZh: '悉尼',   country: 'Australia',   lat: -33.8688, lon: 151.2093 },
  { id: 'singapore',   name: 'Singapore',   nameZh: '新加坡', country: 'Singapore',   lat: 1.3521,   lon: 103.8198 },
  { id: 'dubai',       name: 'Dubai',       nameZh: '迪拜',   country: 'UAE',         lat: 25.2048,  lon: 55.2708  },
  { id: 'mumbai',      name: 'Mumbai',      nameZh: '孟买',   country: 'India',       lat: 19.0760,  lon: 72.8777  },
  { id: 'sao-paulo',   name: 'São Paulo',   nameZh: '圣保罗', country: 'Brazil',      lat: -23.5505, lon: -46.6333 },
  { id: 'cairo',       name: 'Cairo',       nameZh: '开罗',   country: 'Egypt',       lat: 30.0444,  lon: 31.2357  },
  { id: 'los-angeles', name: 'Los Angeles', nameZh: '洛杉矶', country: 'USA',         lat: 34.0522,  lon: -118.2437 },
  { id: 'seoul',       name: 'Seoul',       nameZh: '首尔',   country: 'South Korea', lat: 37.5665,  lon: 126.9780 },
  { id: 'xian',        name: "Xi'an",       nameZh: '西安',   country: 'China',       lat: 34.3416,  lon: 108.9398 },
];

// Collect any polygon whose centroid falls within this many degrees of
// the city center. ~0.4° ≈ 44 km at mid-latitudes — generous enough to
// reconnect water-split fragments, tight enough to not sweep up
// neighboring metros (e.g. Philadelphia when looking at NYC).
const NEIGHBOR_RADIUS_DEG = 0.4;

function ringCentroid(ring) {
  let sx = 0, sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return [sx / ring.length, sy / ring.length];
}

function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function simplifyRing(ring, targetPoints = 400) {
  if (ring.length <= targetPoints) return ring;
  const step = Math.ceil(ring.length / targetPoints);
  const out = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  const first = out[0];
  const last = out[out.length - 1];
  if (last[0] !== first[0] || last[1] !== first[1]) out.push(first);
  return out;
}

// Iterate each outer ring of a feature's geometry. Returns
// [{ ring, areaKm2 }] where areaKm2 is the feature's reported area
// split evenly across its sub-polygons (Natural Earth gives a single
// area_sqkm per feature).
function rings(feature) {
  const g = feature.geometry;
  if (!g) return [];
  const area = feature.properties.area_sqkm || 0;
  if (g.type === 'Polygon') {
    return [{ ring: g.coordinates[0], areaKm2: area }];
  }
  if (g.type === 'MultiPolygon') {
    const n = g.coordinates.length;
    return g.coordinates.map((poly) => ({ ring: poly[0], areaKm2: area / n }));
  }
  return [];
}

function collectCity(city) {
  const pt = [city.lon, city.lat];
  const collected = [];
  const seen = new Set(); // dedupe by feature index in case we touch it twice

  urbanAreas.features.forEach((feature, fi) => {
    const rs = rings(feature);
    if (rs.length === 0) return;
    let keep = false;
    for (const { ring } of rs) {
      if (pointInRing(pt, ring)) {
        keep = true;
        break;
      }
      const [cx, cy] = ringCentroid(ring);
      if (Math.hypot(cx - city.lon, cy - city.lat) <= NEIGHBOR_RADIUS_DEG) {
        keep = true;
        break;
      }
    }
    if (!keep) return;
    if (seen.has(fi)) return;
    seen.add(fi);
    for (const r of rs) collected.push(r);
  });

  return collected;
}

function ringsBbox(rings) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLat, maxLat, minLon, maxLon];
}

// Preserve rivers/coastline fields from the existing cities.json
// (they're not derived from Natural Earth).
const existing = fs.existsSync('./public/data/cities.json')
  ? JSON.parse(fs.readFileSync('./public/data/cities.json', 'utf-8'))
  : [];
const existingById = new Map(existing.map((c) => [c.id, c]));

const results = [];
const missing = [];

for (const city of cities) {
  const collected = collectCity(city);
  if (collected.length === 0) {
    console.warn(`  ✗ ${city.name}: no urban polygon found within ${NEIGHBOR_RADIUS_DEG}°`);
    missing.push(city.id);
    continue;
  }

  // Simplify each ring to keep the file small.
  const simplified = collected.map((c) => ({
    ring: simplifyRing(c.ring, 300),
    areaKm2: c.areaKm2,
  }));

  const bbox = ringsBbox(simplified.map((s) => s.ring));
  const totalAreaKm2 = Math.round(simplified.reduce((s, r) => s + r.areaKm2, 0));

  // GeoJSON output: Polygon when there's just one piece, MultiPolygon otherwise.
  const geojson =
    simplified.length === 1
      ? { type: 'Polygon', coordinates: [simplified[0].ring] }
      : {
          type: 'MultiPolygon',
          coordinates: simplified.map((s) => [s.ring]),
        };

  const totalPts = simplified.reduce((s, r) => s + r.ring.length, 0);
  console.log(
    `  ✓ ${city.name.padEnd(14)} area=${String(totalAreaKm2).padStart(6)} km²   ${String(simplified.length).padStart(2)} piece(s), ${String(totalPts).padStart(4)} pts`
  );

  const prev = existingById.get(city.id);
  const entry = {
    id: city.id,
    name: city.name,
    nameZh: city.nameZh,
    country: city.country,
    geojson,
    bbox,
    areaKm2: totalAreaKm2,
  };
  if (prev?.rivers) entry.rivers = prev.rivers;
  if (prev?.coastline) entry.coastline = prev.coastline;
  results.push(entry);
}

if (missing.length > 0) {
  console.warn(`\nUnmatched cities: ${missing.join(', ')} — preserving existing entries.`);
  for (const id of missing) {
    const prev = existingById.get(id);
    if (prev) results.push(prev);
  }
}

const ordered = cities
  .map((c) => results.find((r) => r.id === c.id))
  .filter(Boolean);

fs.writeFileSync('./public/data/cities.json', JSON.stringify(ordered, null, 2));
console.log(`\nWrote ${ordered.length} cities to public/data/cities.json`);
