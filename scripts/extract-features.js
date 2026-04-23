import fs from 'fs';

const cities = JSON.parse(fs.readFileSync('./public/data/cities.json', 'utf-8'));
const rivers = JSON.parse(fs.readFileSync('./rivers.json', 'utf-8'));
const coast = JSON.parse(fs.readFileSync('./coast.json', 'utf-8'));

function getCityBufferBox(city, bufferDeg = 0.4) {
  const [minLat, maxLat, minLon, maxLon] = city.bbox;
  return [
    minLat - bufferDeg,
    maxLat + bufferDeg,
    minLon - bufferDeg,
    maxLon + bufferDeg,
  ];
}

function clipLineToBox(coords, box) {
  // box = [minLat, maxLat, minLon, maxLon]
  const [bMinLat, bMaxLat, bMinLon, bMaxLon] = box;
  const segments = [];
  let currentSegment = [];

  for (const [lon, lat] of coords) {
    const inside = lat >= bMinLat && lat <= bMaxLat && lon >= bMinLon && lon <= bMaxLon;
    if (inside) {
      currentSegment.push([lon, lat]);
    } else {
      if (currentSegment.length >= 2) {
        segments.push(currentSegment);
      }
      currentSegment = [];
    }
  }
  if (currentSegment.length >= 2) {
    segments.push(currentSegment);
  }
  return segments;
}

function simplifyLine(coords, targetPoints = 100) {
  if (coords.length <= targetPoints) return coords;
  const step = Math.ceil(coords.length / targetPoints);
  const simplified = [];
  for (let i = 0; i < coords.length; i += step) {
    simplified.push(coords[i]);
  }
  return simplified;
}

for (const city of cities) {
  const box = getCityBufferBox(city);
  const cityRivers = [];
  const cityCoast = [];

  // Extract rivers (major ones only: scalerank <= 6)
  for (const feature of rivers.features) {
    if ((feature.properties.scalerank ?? 99) > 8) continue;
    const geom = feature.geometry;
    if (!geom) continue;

    if (geom.type === 'LineString') {
      const segments = clipLineToBox(geom.coordinates, box);
      for (const seg of segments) {
        const simplified = simplifyLine(seg, 80);
        if (simplified.length >= 2) cityRivers.push(simplified);
      }
    } else if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates) {
        const segments = clipLineToBox(line, box);
        for (const seg of segments) {
          const simplified = simplifyLine(seg, 80);
          if (simplified.length >= 2) cityRivers.push(simplified);
        }
      }
    }
  }

  // Extract coastline
  for (const feature of coast.features) {
    const geom = feature.geometry;
    if (!geom) continue;

    if (geom.type === 'LineString') {
      const segments = clipLineToBox(geom.coordinates, box);
      for (const seg of segments) {
        const simplified = simplifyLine(seg, 80);
        if (simplified.length >= 2) cityCoast.push(simplified);
      }
    } else if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates) {
        const segments = clipLineToBox(line, box);
        for (const seg of segments) {
          const simplified = simplifyLine(seg, 80);
          if (simplified.length >= 2) cityCoast.push(simplified);
        }
      }
    }
  }

  city.rivers = cityRivers;
  city.coastline = cityCoast;

  console.log(`${city.name}: ${cityRivers.length} river segments, ${cityCoast.length} coast segments`);
}

fs.writeFileSync('./public/data/cities.json', JSON.stringify(cities, null, 2));
console.log('\nSaved features to cities.json');
