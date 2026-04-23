import fs from 'fs';

const cities = [
  { id: 'beijing', lat: 39.9042, lon: 116.4074, radius: 30000 },
  { id: 'shanghai', lat: 31.2304, lon: 121.4737, radius: 25000 },
  { id: 'tokyo', lat: 35.6762, lon: 139.6503, radius: 25000 },
  { id: 'new-york', lat: 40.7128, lon: -74.0060, radius: 22000 },
  { id: 'london', lat: 51.5074, lon: -0.1278, radius: 25000 },
  { id: 'paris', lat: 48.8566, lon: 2.3522, radius: 22000 },
  { id: 'moscow', lat: 55.7558, lon: 37.6173, radius: 28000 },
  { id: 'sydney', lat: -33.8688, lon: 151.2093, radius: 20000 },
  { id: 'singapore', lat: 1.3521, lon: 103.8198, radius: 15000 },
  { id: 'dubai', lat: 25.2048, lon: 55.2708, radius: 18000 },
  { id: 'mumbai', lat: 19.0760, lon: 72.8777, radius: 18000 },
  { id: 'sao-paulo', lat: -23.5505, lon: -46.6333, radius: 22000 },
  { id: 'cairo', lat: 30.0444, lon: 31.2357, radius: 18000 },
  { id: 'los-angeles', lat: 34.0522, lon: -118.2437, radius: 28000 },
  { id: 'seoul', lat: 37.5665, lon: 126.9780, radius: 22000 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function distKm(lon1, lat1, lon2, lat2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function fetchRoads(city) {
  // ONLY motorway — the highest class, ring roads and major expressways
  const query = `[out:json][timeout:60];
(
  way["highway"="motorway"](around:${city.radius},${city.lat},${city.lon});
);
out body;
>;
out skel qt;`;

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': '*/*',
        'User-Agent': 'CityScaleCompare/1.0',
      },
    });
    if (!res.ok) {
      console.error(`Failed ${city.id}: ${res.status}`);
      return [];
    }
    const data = await res.json();

    const nodes = {};
    for (const el of data.elements) {
      if (el.type === 'node') nodes[el.id] = [el.lon, el.lat];
    }

    const lines = [];
    for (const el of data.elements) {
      if (el.type === 'way' && el.nodes) {
        const coords = [];
        for (const nid of el.nodes) {
          if (nodes[nid]) coords.push(nodes[nid]);
        }
        if (coords.length >= 2) {
          let totalLen = 0;
          for (let i = 1; i < coords.length; i++) {
            totalLen += distKm(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]);
          }
          if (totalLen >= 1.5) lines.push(coords);
        }
      }
    }

    return lines;
  } catch (err) {
    console.error(`Error ${city.id}:`, err.message);
    return [];
  }
}

function simplifyLine(coords, targetPoints = 80) {
  if (coords.length <= targetPoints) return coords;
  const step = Math.ceil(coords.length / targetPoints);
  const simplified = [];
  for (let i = 0; i < coords.length; i += step) simplified.push(coords[i]);
  return simplified;
}

async function main() {
  const citiesData = JSON.parse(fs.readFileSync('./public/data/cities.json', 'utf-8'));

  for (const city of cities) {
    console.log(`Fetching roads for ${city.id}...`);
    const lines = await fetchRoads(city);
    const simplified = lines.map((l) => simplifyLine(l, 80));

    const cityData = citiesData.find((c) => c.id === city.id);
    if (cityData) {
      cityData.roads = simplified;
      console.log(`  ✓ ${lines.length} road segments`);
    }

    await sleep(6000);
  }

  fs.writeFileSync('./public/data/cities.json', JSON.stringify(citiesData, null, 2));
  console.log('\nDone!');
}

main();
