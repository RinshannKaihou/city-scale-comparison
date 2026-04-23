import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const cities = [
  { name: 'Beijing', nameZh: '北京', country: 'China', query: 'Beijing, China' },
  { name: 'Shanghai', nameZh: '上海', country: 'China', query: 'Shanghai, China' },
  { name: 'Tokyo', nameZh: '东京', country: 'Japan', query: 'Tokyo, Japan' },
  { name: 'New York', nameZh: '纽约', country: 'USA', query: 'New York City, USA' },
  { name: 'London', nameZh: '伦敦', country: 'UK', query: 'London, UK' },
  { name: 'Paris', nameZh: '巴黎', country: 'France', query: 'Paris, France' },
  { name: 'Moscow', nameZh: '莫斯科', country: 'Russia', query: 'Moscow, Russia' },
  { name: 'Sydney', nameZh: '悉尼', country: 'Australia', query: 'Sydney, Australia' },
  { name: 'Singapore', nameZh: '新加坡', country: 'Singapore', query: 'Singapore' },
  { name: 'Dubai', nameZh: '迪拜', country: 'UAE', query: 'Dubai, UAE' },
  { name: 'Mumbai', nameZh: '孟买', country: 'India', query: 'Mumbai, India' },
  { name: 'São Paulo', nameZh: '圣保罗', country: 'Brazil', query: 'São Paulo, Brazil' },
  { name: 'Cairo', nameZh: '开罗', country: 'Egypt', query: 'Cairo, Egypt' },
  { name: 'Los Angeles', nameZh: '洛杉矶', country: 'USA', query: 'Los Angeles, USA' },
  { name: 'Seoul', nameZh: '首尔', country: 'South Korea', query: 'Seoul, South Korea' },
  { name: "Xi'an", nameZh: '西安', country: 'China', query: "Xi'an, China" },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchBoundary(city) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city.query)}&format=json&polygon_geojson=1&limit=1`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'CityScaleCompare/1.0 (demo@example.com)',
      },
    });
    if (!res.ok) {
      console.error(`Failed to fetch ${city.name}: ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data || data.length === 0) {
      console.error(`No results for ${city.name}`);
      return null;
    }
    const result = data[0];
    const geojson = result.geojson;
    if (!geojson) {
      console.error(`No geojson for ${city.name}`);
      return null;
    }
    // Calculate bounding box area approximation
    let bbox = result.boundingbox; // [south, north, west, east]
    if (!bbox && geojson.type === 'Polygon') {
      const coords = geojson.coordinates[0];
      const lons = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      bbox = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
    }
    const areaKm2 = bbox ? approximateArea(bbox) : 0;
    return {
      id: city.name.toLowerCase().replace(/\s+/g, '-'),
      name: city.name,
      nameZh: city.nameZh,
      country: city.country,
      geojson,
      bbox,
      areaKm2: Math.round(areaKm2),
    };
  } catch (err) {
    console.error(`Error fetching ${city.name}:`, err.message);
    return null;
  }
}

function approximateArea(bbox) {
  // bbox = [south, north, west, east]
  const lat1 = parseFloat(bbox[0]);
  const lat2 = parseFloat(bbox[1]);
  const lon1 = parseFloat(bbox[2]);
  const lon2 = parseFloat(bbox[3]);
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // approximate rectangle area
  const width = R * c * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const height = R * dLat;
  return width * height;
}

async function main() {
  const outputPath = path.join(__dirname, '../public/data/cities.json');
  const results = [];
  for (const city of cities) {
    console.log(`Fetching ${city.name}...`);
    const data = await fetchBoundary(city);
    if (data) {
      results.push(data);
      console.log(`  ✓ area: ~${data.areaKm2} km²`);
    }
    await sleep(1100); // Nominatim requires 1 sec between requests
  }
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved ${results.length} cities to ${outputPath}`);
}

main();
