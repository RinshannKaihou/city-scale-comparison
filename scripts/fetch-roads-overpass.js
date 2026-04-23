// Fetches city road networks from Overpass, bounded by each city's
// urban-area bbox (from public/data/cities.json).
//
// Behaviors worth knowing:
// - Fetches are bbox-scoped, not radius-scoped. This makes road coverage
//   match the city's urban polygon. Tokyo's Kanto bbox fetches roads
//   across ~130 km; Singapore's ~20 km. No more "small road cluster
//   inside a big polygon" mismatch.
// - Skips cities whose per-city file already contains a non-empty array,
//   so re-running only retries the failed ones.
// - Writes directly to per-city files after each successful fetch, so
//   partial progress is preserved across crashes or Ctrl+C.
// - Retries with exponential backoff, rotating through 3 Overpass
//   mirrors in case one is overloaded.

import fs from 'fs';
import path from 'path';

const CITIES_PATH = './public/data/cities.json';
const ROADS_DIR = './public/data/roads';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];
const QUERY_TIMEOUT_SEC = 300;
const CLIENT_TIMEOUT_MS = 420_000;
const BETWEEN_CITIES_MS = 8_000;
const RETRY_BACKOFF_MS = [15_000, 45_000, 120_000];

// Pad the city's bbox by ~2 km so roads ending right at the urban-area
// edge aren't clipped. Converted from degrees at the bbox's latitude.
const BBOX_PAD_KM = 2;

// If a city's bbox area exceeds this, split it into tiles. Tokyo's bbox
// is ~44,000 km² — a single Overpass query chokes on that volume of
// tertiary+secondary ways. Tiling keeps each request under the server's
// effective memory/time budget.
const MAX_TILE_KM2 = 12_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function distKm(lon1, lat1, lon2, lat2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function readExistingRoads(id) {
  const p = path.join(ROADS_DIR, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeRoadsFile(id, roads) {
  fs.mkdirSync(ROADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ROADS_DIR, `${id}.json`), JSON.stringify(roads));
}

async function fetchFromEndpoint(endpoint, query) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: '*/*',
        'User-Agent': 'CityScaleCompare/1.0',
      },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// cities.json bbox format: [minLat, maxLat, minLon, maxLon].
function paddedBbox(bbox) {
  const [minLat, maxLat, minLon, maxLon] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const degLat = BBOX_PAD_KM / 110.574;
  const degLon = BBOX_PAD_KM / (111.32 * Math.cos((midLat * Math.PI) / 180));
  return [minLat - degLat, minLon - degLon, maxLat + degLat, maxLon + degLon];
}

// Fetch a single tile. Returns Map<wayId, coords> so the caller can
// merge across tiles without duplicating ways that straddle a boundary
// (Overpass returns a way fully whenever any of its nodes falls inside
// the bbox, so the same way appears in both of two adjacent tiles).
async function fetchTile(s, w, n, e, label) {
  const query = `[out:json][timeout:${QUERY_TIMEOUT_SEC}];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)});
);
out body;
>;
out skel qt;`;

  const errors = [];
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      process.stdout.write(`    ${label} attempt ${attempt + 1} via ${new URL(endpoint).host}... `);
      const data = await fetchFromEndpoint(endpoint, query);

      const nodes = {};
      for (const el of data.elements) {
        if (el.type === 'node') nodes[el.id] = [el.lon, el.lat];
      }

      const ways = new Map();
      for (const el of data.elements) {
        if (el.type !== 'way' || !el.nodes) continue;
        const coords = [];
        for (const nid of el.nodes) {
          if (nodes[nid]) coords.push(nodes[nid]);
        }
        if (coords.length < 3) continue;
        let totalLen = 0;
        for (let i = 1; i < coords.length; i++) {
          totalLen += distKm(
            coords[i - 1][0], coords[i - 1][1],
            coords[i][0], coords[i][1]
          );
        }
        if (totalLen < 0.2) continue;
        ways.set(el.id, coords);
      }

      process.stdout.write(`ok (${ways.size} ways)\n`);
      return ways;
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'client timeout' : err.message;
      process.stdout.write(`${msg}\n`);
      errors.push(msg);
      const backoff = RETRY_BACKOFF_MS[attempt];
      if (backoff !== undefined) {
        console.log(`    retrying in ${backoff / 1000}s...`);
        await sleep(backoff);
      }
    }
  }
  console.error(`    tile ${label} failed: ${errors.join('; ')}`);
  return null;
}

// Compute a tile grid sized so each tile is ≤ MAX_TILE_KM2. Returns
// [{s, w, n, e, label}].
function planTiles(bbox) {
  const [s, w, n, e] = bbox;
  const midLat = (s + n) / 2;
  const hKm = (n - s) * 110.574;
  const wKm = (e - w) * 111.32 * Math.cos((midLat * Math.PI) / 180);
  const areaKm2 = hKm * wKm;
  if (areaKm2 <= MAX_TILE_KM2) {
    return [{ s, w, n, e, label: '1/1' }];
  }
  const k = Math.ceil(Math.sqrt(areaKm2 / MAX_TILE_KM2));
  const dLat = (n - s) / k;
  const dLon = (e - w) / k;
  const tiles = [];
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      tiles.push({
        s: s + i * dLat,
        w: w + j * dLon,
        n: s + (i + 1) * dLat,
        e: w + (j + 1) * dLon,
        label: `${i * k + j + 1}/${k * k}`,
      });
    }
  }
  return tiles;
}

async function fetchRoads(city) {
  const [s, w, n, e] = paddedBbox(city.bbox);
  const tiles = planTiles([s, w, n, e]);
  if (tiles.length > 1) {
    console.log(`    bbox too large; tiling into ${tiles.length} pieces`);
  }

  const merged = new Map();
  let anyFailed = false;
  for (const t of tiles) {
    const tileWays = await fetchTile(t.s, t.w, t.n, t.e, t.label);
    if (tileWays === null) {
      anyFailed = true;
      continue;
    }
    for (const [id, coords] of tileWays) merged.set(id, coords);
    if (tiles.length > 1) await sleep(BETWEEN_CITIES_MS / 2);
  }

  if (anyFailed && merged.size === 0) return null;
  if (anyFailed) {
    console.warn(`    ⚠ some tiles failed; using partial data (${merged.size} ways)`);
  }
  return Array.from(merged.values());
}

function simplifyLine(coords, targetPoints = 30) {
  if (coords.length <= targetPoints) return coords;
  const step = Math.ceil(coords.length / targetPoints);
  const simplified = [];
  for (let i = 0; i < coords.length; i += step) simplified.push(coords[i]);
  if ((coords.length - 1) % step !== 0) simplified.push(coords[coords.length - 1]);
  return simplified;
}

function bboxAreaKm2(bbox) {
  const [minLat, maxLat, minLon, maxLon] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const h = (maxLat - minLat) * 110.574;
  const w = (maxLon - minLon) * 111.32 * Math.cos((midLat * Math.PI) / 180);
  return Math.round(w * h);
}

async function main() {
  if (!fs.existsSync(CITIES_PATH)) {
    console.error(`Missing ${CITIES_PATH}. Run extract-urban-areas.js first.`);
    process.exit(1);
  }
  const cities = JSON.parse(fs.readFileSync(CITIES_PATH, 'utf-8'));

  console.log(`Fetching roads for ${cities.length} cities using urban-area bboxes.`);
  console.log(`  Overpass query timeout: ${QUERY_TIMEOUT_SEC}s`);
  console.log(`  Client abort timeout:   ${CLIENT_TIMEOUT_MS / 1000}s\n`);

  let skipped = 0;
  let succeeded = 0;
  let failed = 0;
  const failedIds = [];

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    const areaEstKm2 = bboxAreaKm2(city.bbox);
    const existing = readExistingRoads(city.id);
    if (existing && existing.length > 0) {
      console.log(`[${i + 1}/${cities.length}] ${city.id}: already has ${existing.length} ways, skipping`);
      skipped++;
      continue;
    }

    console.log(`[${i + 1}/${cities.length}] ${city.id}: fetching (bbox ≈ ${areaEstKm2} km²)...`);
    const lines = await fetchRoads(city);

    if (lines === null) {
      failed++;
      failedIds.push(city.id);
    } else {
      const simplified = lines.map((l) => simplifyLine(l, 30));
      writeRoadsFile(city.id, simplified);
      const totalPoints = simplified.reduce((s, l) => s + l.length, 0);
      const fileKb = Math.round(JSON.stringify(simplified).length / 1024);
      console.log(`  ✓ wrote ${simplified.length} ways, ${totalPoints} points (${fileKb} KB)`);
      succeeded++;
    }

    if (i < cities.length - 1) await sleep(BETWEEN_CITIES_MS);
  }

  console.log(`\nSummary: ${succeeded} fetched, ${skipped} skipped, ${failed} failed`);
  if (failedIds.length) {
    console.log(`Failed cities: ${failedIds.join(', ')}`);
    console.log('Re-run to retry; successful cities are preserved.');
    process.exit(1);
  }
}

main();
