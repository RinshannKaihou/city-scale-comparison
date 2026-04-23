import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const citiesMeta = [
  { id: 'beijing', name: 'Beijing', nameZh: '北京', country: 'China', file: 'Beijing' },
  { id: 'shanghai', name: 'Shanghai', nameZh: '上海', country: 'China', file: 'Shanghai' },
  { id: 'tokyo', name: 'Tokyo', nameZh: '东京', country: 'Japan', file: 'Tokyo' },
  { id: 'new-york', name: 'New York', nameZh: '纽约', country: 'USA', file: 'New%20York' },
  { id: 'london', name: 'London', nameZh: '伦敦', country: 'UK', file: 'London' },
  { id: 'paris', name: 'Paris', nameZh: '巴黎', country: 'France', file: 'Paris' },
  { id: 'moscow', name: 'Moscow', nameZh: '莫斯科', country: 'Russia', file: 'Moscow' },
  { id: 'sydney', name: 'Sydney', nameZh: '悉尼', country: 'Australia', file: 'Sydney' },
  { id: 'singapore', name: 'Singapore', nameZh: '新加坡', country: 'Singapore', file: 'Singapore' },
  { id: 'dubai', name: 'Dubai', nameZh: '迪拜', country: 'UAE', file: 'Dubai' },
  { id: 'mumbai', name: 'Mumbai', nameZh: '孟买', country: 'India', file: 'Mumbai' },
  { id: 'sao-paulo', name: 'São Paulo', nameZh: '圣保罗', country: 'Brazil', file: 'São%20Paulo' },
  { id: 'cairo', name: 'Cairo', nameZh: '开罗', country: 'Egypt', file: 'Cairo' },
  { id: 'los-angeles', name: 'Los Angeles', nameZh: '洛杉矶', country: 'USA', file: 'Los%20Angeles' },
  { id: 'seoul', name: 'Seoul', nameZh: '首尔', country: 'South Korea', file: 'Seoul' },
];

function computeBBoxFromCoords(geojson) {
  let coords = [];
  if (geojson.type === 'Polygon') {
    coords = geojson.coordinates[0];
  } else if (geojson.type === 'MultiPolygon') {
    // Use the largest polygon
    let largest = geojson.coordinates[0][0];
    for (const poly of geojson.coordinates) {
      if (poly[0].length > largest.length) largest = poly[0];
    }
    coords = largest;
  }
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
}

function approximateArea(bbox) {
  const lat1 = bbox[0];
  const lat2 = bbox[1];
  const lon1 = bbox[2];
  const lon2 = bbox[3];
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const width = R * c * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const height = R * dLat;
  return width * height;
}

function simplifyGeojson(geojson, targetPoints = 800) {
  if (!geojson) return null;

  if (geojson.type === 'MultiPolygon') {
    let largest = geojson.coordinates[0];
    let maxLen = 0;
    for (const poly of geojson.coordinates) {
      const len = poly[0].length;
      if (len > maxLen) {
        maxLen = len;
        largest = poly;
      }
    }
    geojson = { type: 'Polygon', coordinates: largest };
  }

  if (geojson.type === 'Polygon') {
    const coords = geojson.coordinates[0];
    if (coords.length > targetPoints) {
      const step = Math.ceil(coords.length / targetPoints);
      const simplified = [];
      for (let i = 0; i < coords.length; i += step) {
        simplified.push(coords[i]);
      }
      if (simplified[0][0] !== simplified[simplified.length - 1][0] ||
          simplified[0][1] !== simplified[simplified.length - 1][1]) {
        simplified.push(simplified[0]);
      }
      geojson.coordinates[0] = simplified;
    }
  }

  return geojson;
}

const results = [];
const dataDir = path.join(__dirname, '../public/data');

for (const meta of citiesMeta) {
  const filePath = path.join(dataDir, `${meta.file}.json`);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing file: ${filePath}`);
    continue;
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error(`Invalid JSON for ${meta.name}: ${e.message}`);
    continue;
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    console.error(`Empty result for ${meta.name}`);
    continue;
  }
  const result = raw[0];
  const geojson = simplifyGeojson(result.geojson);
  if (!geojson) {
    console.error(`No geojson for ${meta.name}`);
    continue;
  }
  const bbox = computeBBoxFromCoords(geojson);
  const areaKm2 = approximateArea(bbox);
  results.push({
    id: meta.id,
    name: meta.name,
    nameZh: meta.nameZh,
    country: meta.country,
    geojson,
    bbox,
    areaKm2: Math.round(areaKm2),
  });
  console.log(`✓ ${meta.name}: ~${Math.round(areaKm2)} km², ${geojson.coordinates[0].length} points`);
}

fs.writeFileSync(path.join(dataDir, 'cities.json'), JSON.stringify(results, null, 2));
console.log(`\nSaved ${results.length} cities to cities.json`);
