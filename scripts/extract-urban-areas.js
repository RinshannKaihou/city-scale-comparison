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
  { id: 'beijing',     name: 'Beijing',     nameZh: '北京',   country: 'China',       region: 'china',         lat: 39.9042,  lon: 116.4074 },
  { id: 'shanghai',    name: 'Shanghai',    nameZh: '上海',   country: 'China',       region: 'china',         lat: 31.2304,  lon: 121.4737 },
  { id: 'tokyo',       name: 'Tokyo',       nameZh: '东京',   country: 'Japan',       region: 'asia',          lat: 35.6762,  lon: 139.6503 },
  { id: 'new-york',    name: 'New York',    nameZh: '纽约',   country: 'USA',         region: 'north-america', lat: 40.7128,  lon: -74.0060 },
  { id: 'london',      name: 'London',      nameZh: '伦敦',   country: 'UK',          region: 'europe',        lat: 51.5074,  lon: -0.1278  },
  { id: 'paris',       name: 'Paris',       nameZh: '巴黎',   country: 'France',      region: 'europe',        lat: 48.8566,  lon: 2.3522   },
  { id: 'moscow',      name: 'Moscow',      nameZh: '莫斯科', country: 'Russia',      region: 'europe',        lat: 55.7558,  lon: 37.6173  },
  { id: 'sydney',      name: 'Sydney',      nameZh: '悉尼',   country: 'Australia',   region: 'asia',          lat: -33.8688, lon: 151.2093 },
  { id: 'singapore',   name: 'Singapore',   nameZh: '新加坡', country: 'Singapore',   region: 'asia',          lat: 1.3521,   lon: 103.8198 },
  { id: 'dubai',       name: 'Dubai',       nameZh: '迪拜',   country: 'UAE',         region: 'asia',          lat: 25.2048,  lon: 55.2708  },
  { id: 'mumbai',      name: 'Mumbai',      nameZh: '孟买',   country: 'India',       region: 'asia',          lat: 19.0760,  lon: 72.8777  },
  { id: 'sao-paulo',   name: 'São Paulo',   nameZh: '圣保罗', country: 'Brazil',      region: 'south-america', lat: -23.5505, lon: -46.6333 },
  { id: 'cairo',       name: 'Cairo',       nameZh: '开罗',   country: 'Egypt',       region: 'africa',        lat: 30.0444,  lon: 31.2357  },
  { id: 'los-angeles', name: 'Los Angeles', nameZh: '洛杉矶', country: 'USA',         region: 'north-america', lat: 34.0522,  lon: -118.2437 },
  { id: 'seoul',       name: 'Seoul',       nameZh: '首尔',   country: 'South Korea', region: 'asia',          lat: 37.5665,  lon: 126.9780 },
  { id: 'xian',        name: "Xi'an",       nameZh: '西安',   country: 'China',       region: 'china',         lat: 34.3416,  lon: 108.9398 },

  // China expansion
  { id: 'guangzhou',   name: 'Guangzhou',   nameZh: '广州',   country: 'China',       region: 'china',         lat: 23.1291,  lon: 113.2644 },
  { id: 'shenzhen',    name: 'Shenzhen',    nameZh: '深圳',   country: 'China',       region: 'china',         lat: 22.5431,  lon: 114.0579 },
  { id: 'chengdu',     name: 'Chengdu',     nameZh: '成都',   country: 'China',       region: 'china',         lat: 30.6595,  lon: 104.0657 },
  { id: 'hangzhou',    name: 'Hangzhou',    nameZh: '杭州',   country: 'China',       region: 'china',         lat: 30.2741,  lon: 120.1551 },
  { id: 'chongqing',   name: 'Chongqing',   nameZh: '重庆',   country: 'China',       region: 'china',         lat: 29.5630,  lon: 106.5516 },
  { id: 'tianjin',     name: 'Tianjin',     nameZh: '天津',   country: 'China',       region: 'china',         lat: 39.0842,  lon: 117.2009 },
  { id: 'wuhan',       name: 'Wuhan',       nameZh: '武汉',   country: 'China',       region: 'china',         lat: 30.5928,  lon: 114.3055 },
  { id: 'nanjing',     name: 'Nanjing',     nameZh: '南京',   country: 'China',       region: 'china',         lat: 32.0603,  lon: 118.7969 },
  { id: 'suzhou',      name: 'Suzhou',      nameZh: '苏州',   country: 'China',       region: 'china',         lat: 31.2990,  lon: 120.5853 },
  { id: 'qingdao',     name: 'Qingdao',     nameZh: '青岛',   country: 'China',       region: 'china',         lat: 36.0671,  lon: 120.3826 },
  { id: 'dalian',      name: 'Dalian',      nameZh: '大连',   country: 'China',       region: 'china',         lat: 38.9140,  lon: 121.6147 },
  { id: 'xiamen',      name: 'Xiamen',      nameZh: '厦门',   country: 'China',       region: 'china',         lat: 24.4798,  lon: 118.0819 },
  { id: 'hong-kong',   name: 'Hong Kong',   nameZh: '香港',   country: 'China',       region: 'china',         lat: 22.3193,  lon: 114.1694 },

  // Asia expansion
  { id: 'osaka',       name: 'Osaka',       nameZh: '大阪',   country: 'Japan',       region: 'asia',          lat: 34.6937,  lon: 135.5023 },
  { id: 'bangkok',     name: 'Bangkok',     nameZh: '曼谷',   country: 'Thailand',    region: 'asia',          lat: 13.7563,  lon: 100.5018 },
  { id: 'jakarta',     name: 'Jakarta',     nameZh: '雅加达', country: 'Indonesia',   region: 'asia',          lat: -6.2088,  lon: 106.8456 },
  { id: 'manila',      name: 'Manila',      nameZh: '马尼拉', country: 'Philippines', region: 'asia',          lat: 14.5995,  lon: 120.9842 },
  { id: 'kuala-lumpur',name: 'Kuala Lumpur',nameZh: '吉隆坡', country: 'Malaysia',    region: 'asia',          lat: 3.1390,   lon: 101.6869 },
  { id: 'ho-chi-minh', name: 'Ho Chi Minh', nameZh: '胡志明市',country: 'Vietnam',    region: 'asia',          lat: 10.7769,  lon: 106.7009 },
  { id: 'delhi',       name: 'Delhi',       nameZh: '德里',   country: 'India',       region: 'asia',          lat: 28.6139,  lon: 77.2090  },
  { id: 'karachi',     name: 'Karachi',     nameZh: '卡拉奇', country: 'Pakistan',    region: 'asia',          lat: 24.8607,  lon: 67.0011  },
  { id: 'tehran',      name: 'Tehran',      nameZh: '德黑兰', country: 'Iran',        region: 'asia',          lat: 35.6892,  lon: 51.3890  },
  { id: 'taipei',      name: 'Taipei',      nameZh: '台北',   country: 'Taiwan',      region: 'asia',          lat: 25.0330,  lon: 121.5654 },
  { id: 'melbourne',   name: 'Melbourne',   nameZh: '墨尔本', country: 'Australia',   region: 'asia',          lat: -37.8136, lon: 144.9631 },
  { id: 'auckland',    name: 'Auckland',    nameZh: '奥克兰', country: 'New Zealand', region: 'asia',          lat: -36.8485, lon: 174.7633 },

  // Europe expansion
  { id: 'berlin',      name: 'Berlin',      nameZh: '柏林',   country: 'Germany',     region: 'europe',        lat: 52.5200,  lon: 13.4050  },
  { id: 'madrid',      name: 'Madrid',      nameZh: '马德里', country: 'Spain',       region: 'europe',        lat: 40.4168,  lon: -3.7038  },
  { id: 'rome',        name: 'Rome',        nameZh: '罗马',   country: 'Italy',       region: 'europe',        lat: 41.9028,  lon: 12.4964  },
  { id: 'istanbul',    name: 'Istanbul',    nameZh: '伊斯坦布尔',country: 'Turkey',   region: 'europe',        lat: 41.0082,  lon: 28.9784  },
  { id: 'barcelona',   name: 'Barcelona',   nameZh: '巴塞罗那',country: 'Spain',      region: 'europe',        lat: 41.3851,  lon: 2.1734   },
  { id: 'amsterdam',   name: 'Amsterdam',   nameZh: '阿姆斯特丹',country: 'Netherlands',region: 'europe',      lat: 52.3676,  lon: 4.9041   },
  { id: 'vienna',      name: 'Vienna',      nameZh: '维也纳', country: 'Austria',     region: 'europe',        lat: 48.2082,  lon: 16.3738  },
  { id: 'athens',      name: 'Athens',      nameZh: '雅典',   country: 'Greece',      region: 'europe',        lat: 37.9838,  lon: 23.7275  },
  { id: 'munich',      name: 'Munich',      nameZh: '慕尼黑', country: 'Germany',     region: 'europe',        lat: 48.1351,  lon: 11.5820  },
  { id: 'milan',       name: 'Milan',       nameZh: '米兰',   country: 'Italy',       region: 'europe',        lat: 45.4642,  lon: 9.1900   },
  { id: 'prague',      name: 'Prague',      nameZh: '布拉格', country: 'Czechia',     region: 'europe',        lat: 50.0755,  lon: 14.4378  },
  { id: 'stockholm',   name: 'Stockholm',   nameZh: '斯德哥尔摩',country: 'Sweden',   region: 'europe',        lat: 59.3293,  lon: 18.0686  },

  // North America expansion
  { id: 'chicago',     name: 'Chicago',     nameZh: '芝加哥', country: 'USA',         region: 'north-america', lat: 41.8781,  lon: -87.6298 },
  { id: 'toronto',     name: 'Toronto',     nameZh: '多伦多', country: 'Canada',      region: 'north-america', lat: 43.6532,  lon: -79.3832 },
  { id: 'mexico-city', name: 'Mexico City', nameZh: '墨西哥城',country: 'Mexico',     region: 'north-america', lat: 19.4326,  lon: -99.1332 },
  { id: 'san-francisco',name:'San Francisco',nameZh:'旧金山', country: 'USA',         region: 'north-america', lat: 37.7749,  lon: -122.4194 },
  { id: 'washington',  name: 'Washington',  nameZh: '华盛顿', country: 'USA',         region: 'north-america', lat: 38.9072,  lon: -77.0369 },
  { id: 'boston',      name: 'Boston',      nameZh: '波士顿', country: 'USA',         region: 'north-america', lat: 42.3601,  lon: -71.0589 },
  { id: 'vancouver',   name: 'Vancouver',   nameZh: '温哥华', country: 'Canada',      region: 'north-america', lat: 49.2827,  lon: -123.1207 },
  { id: 'houston',     name: 'Houston',     nameZh: '休斯顿', country: 'USA',         region: 'north-america', lat: 29.7604,  lon: -95.3698 },
  { id: 'miami',       name: 'Miami',       nameZh: '迈阿密', country: 'USA',         region: 'north-america', lat: 25.9500,  lon: -80.2300 },
  { id: 'montreal',    name: 'Montreal',    nameZh: '蒙特利尔',country: 'Canada',     region: 'north-america', lat: 45.5017,  lon: -73.5673 },

  // South America expansion
  { id: 'buenos-aires',name: 'Buenos Aires',nameZh: '布宜诺斯艾利斯',country:'Argentina',region:'south-america',lat: -34.6037, lon: -58.3816 },
  { id: 'rio',         name: 'Rio de Janeiro',nameZh:'里约热内卢',country:'Brazil',   region: 'south-america', lat: -22.9068, lon: -43.1729 },
  { id: 'lima',        name: 'Lima',        nameZh: '利马',   country: 'Peru',        region: 'south-america', lat: -12.0464, lon: -77.0428 },
  { id: 'bogota',      name: 'Bogotá',      nameZh: '波哥大', country: 'Colombia',    region: 'south-america', lat: 4.7110,   lon: -74.0721 },
  { id: 'santiago',    name: 'Santiago',    nameZh: '圣地亚哥',country:'Chile',       region: 'south-america', lat: -33.4489, lon: -70.6693 },
  { id: 'caracas',     name: 'Caracas',     nameZh: '加拉加斯',country:'Venezuela',   region: 'south-america', lat: 10.4806,  lon: -66.9036 },
  { id: 'quito',       name: 'Quito',       nameZh: '基多',   country: 'Ecuador',     region: 'south-america', lat: -0.1807,  lon: -78.4678 },
  { id: 'montevideo',  name: 'Montevideo',  nameZh: '蒙得维的亚',country:'Uruguay',   region: 'south-america', lat: -34.9011, lon: -56.1645 },

  // Africa expansion
  { id: 'lagos',       name: 'Lagos',       nameZh: '拉各斯', country: 'Nigeria',     region: 'africa',        lat: 6.5244,   lon: 3.3792   },
  { id: 'johannesburg',name: 'Johannesburg',nameZh: '约翰内斯堡',country:'South Africa',region:'africa',       lat: -26.2041, lon: 28.0473  },
  { id: 'nairobi',     name: 'Nairobi',     nameZh: '内罗毕', country: 'Kenya',       region: 'africa',        lat: -1.2921,  lon: 36.8219  },
  { id: 'casablanca',  name: 'Casablanca',  nameZh: '卡萨布兰卡',country:'Morocco',   region: 'africa',        lat: 33.5731,  lon: -7.5898  },
  { id: 'cape-town',   name: 'Cape Town',   nameZh: '开普敦', country: 'South Africa',region: 'africa',        lat: -33.9249, lon: 18.4241  },
  { id: 'addis-ababa', name: 'Addis Ababa', nameZh: '亚的斯亚贝巴',country:'Ethiopia',region:'africa',        lat: 9.0320,   lon: 38.7469  },
  { id: 'kinshasa',    name: 'Kinshasa',    nameZh: '金沙萨', country: 'DR Congo',    region: 'africa',        lat: -4.4419,  lon: 15.2663  },
  { id: 'dakar',       name: 'Dakar',       nameZh: '达喀尔', country: 'Senegal',     region: 'africa',        lat: 14.7167,  lon: -17.4677 },
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
    region: city.region,
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
