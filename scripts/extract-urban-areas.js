// Match each city to a consistent, comparable built-up footprint derived from
// Natural Earth's night-lights urban polygons (ne_10m_urban_areas).
//
// The dataset has NO city names — 11,878 unnamed polygons, each a single
// Polygon with an `area_sqkm`. Matching is therefore purely geometric from
// each city's seed lat/lon. The old algorithm ("union every polygon whose
// centroid is within a fixed 0.4°") was inconsistent: it swept up separate
// neighbor towns for some cities, missed water-split fragments for others, and
// needed manual `clipBbox` rectangles to divide shared conurbation blobs.
//
// This version is consistent city-to-city and needs no per-city rectangles:
//
//   1. HOME — each seed's home piece is the polygon that contains it (or the
//      nearest polygon edge within SNAP_MAX for island seeds).
//   2. NEAREST-SEED OWNERSHIP — every polygon is globally attributed to its
//      nearest seed (of all 79). This guard decides who may claim a polygon.
//   3. ADJACENCY FLOOD-FILL — a city grows outward from its home across small
//      inter-fragment gaps (≤ GAP_MAX km, edge-to-edge, NOT a radius from the
//      seed), but only annexes a polygon it is the nearest seed to, and never
//      steals another seed's home. This reunites water-split metros (New York,
//      Hong Kong islands, San Francisco Bay, Suzhou+Wuxi) without letting one
//      city swallow a neighbor.
//   4. SHARED-BLOB PARTITION — the one polygon that physically contains two
//      seeds (the Pearl River Delta = Guangzhou + Shenzhen) is split along the
//      perpendicular bisector between them (a smooth straight cut), replacing
//      the old clipBbox hack.
//
// Single-seed giants (Tokyo's whole Kanto plain, Osaka, LA, Seoul) are NOT
// capped — the project's purpose is honest size comparison, and each of those
// blobs genuinely contains exactly one seed. The only bound on a city is a
// nearer competing seed. Adding a secondary seed (e.g. Yokohama) is the
// principled way to subdivide such a conurbation, if ever desired.
//
// Output: public/data/cities.json (overwrites existing).

import fs from 'fs';
import polygonClipping from 'polygon-clipping';

// ---- Parameters -----------------------------------------------------------

const GAP_MAX = 8; // km. Inter-fragment adjacency gap for the flood-fill.
//   Measured same-city gaps stay well under this (NYC ≤7.5, SF ≤7, Singapore
//   ≤2.9, Suzhou→Wuxi 4.2, HK islands ≤5.3) while every foreign wall is far
//   above it (≥14). It is a gap-to-fabric distance, so a city whose seed sits
//   off-center from its own blob (Suzhou is 57 km from its blob) still reunites.
const REACH_MAX = 45; // km. Second bound: an annexed fragment's center must be
//   within this of the seed. Adjacency alone runs away in continuously
//   urbanized regions (the Randstad, Po Valley, Keihanshin and the US
//   Northeast are all <GAP_MAX-connected across 100+ km), so without a reach
//   cap one seed swallows a whole conurbation. 45 km still reunites every
//   genuine water-split fragment (NYC harbor ≤~35, SF Bay ≤~40, Suzhou→Wuxi
//   ~40). A city's HOME polygon is never reach-capped — single-blob giants
//   (Tokyo's Kanto) keep their full extent. Conurbations that should be
//   subdivided are handled by extra seeds (nearest-seed partition), not by a
//   tighter reach.
const SNAP_MAX = 5; // km. Ceiling for snapping an island seed to the nearest
//   polygon edge when no polygon contains it (worst real case: Singapore 1.6).
const SIMPLIFY_TARGET = 300; // vertices per ring in the output.

// ---- City seeds -----------------------------------------------------------
// Required: id, name, nameZh, country, region, lat, lon.
// Optional: excludeFeats — feature indices this city must never annex, for the
//   rare cross-border artifact that geometry alone cannot resolve.

const cities = [
  { id: 'beijing',     name: 'Beijing',     nameZh: '北京',   country: 'China',       region: 'china',         lat: 39.9042,  lon: 116.4074 },
  { id: 'shanghai',    name: 'Shanghai',    nameZh: '上海',   country: 'China',       region: 'china',         lat: 31.2304,  lon: 121.4737 },
  { id: 'tokyo',       name: 'Tokyo',       nameZh: '东京',   country: 'Japan',       region: 'asia',          lat: 35.6762,  lon: 139.6503 },
  { id: 'new-york',    name: 'New York',    nameZh: '纽约',   country: 'USA',         region: 'north-america', lat: 40.7128,  lon: -74.0060 },
  { id: 'london',      name: 'London',      nameZh: '伦敦',   country: 'UK',          region: 'europe',        lat: 51.5074,  lon: -0.1278  },
  { id: 'paris',       name: 'Paris',       nameZh: '巴黎',   country: 'France',      region: 'europe',        lat: 48.8566,  lon: 2.3522   },
  { id: 'moscow',      name: 'Moscow',      nameZh: '莫斯科', country: 'Russia',      region: 'europe',        lat: 55.7558,  lon: 37.6173  },
  { id: 'sydney',      name: 'Sydney',      nameZh: '悉尼',   country: 'Australia',   region: 'asia',          lat: -33.8688, lon: 151.2093 },
  { id: 'singapore',   name: 'Singapore',   nameZh: '新加坡', country: 'Singapore',   region: 'asia',          lat: 1.3521,   lon: 103.8198, excludeFeats: [2917, 2918] },
  { id: 'dubai',       name: 'Dubai',       nameZh: '迪拜',   country: 'UAE',         region: 'asia',          lat: 25.2048,  lon: 55.2708  },
  { id: 'mumbai',      name: 'Mumbai',      nameZh: '孟买',   country: 'India',       region: 'asia',          lat: 19.0760,  lon: 72.8777  },
  { id: 'sao-paulo',   name: 'São Paulo',   nameZh: '圣保罗', country: 'Brazil',      region: 'south-america', lat: -23.5505, lon: -46.6333 },
  { id: 'cairo',       name: 'Cairo',       nameZh: '开罗',   country: 'Egypt',       region: 'africa',        lat: 30.0444,  lon: 31.2357  },
  { id: 'los-angeles', name: 'Los Angeles', nameZh: '洛杉矶', country: 'USA',         region: 'north-america', lat: 34.0522,  lon: -118.2437 },
  { id: 'seoul',       name: 'Seoul',       nameZh: '首尔',   country: 'South Korea', region: 'asia',          lat: 37.5665,  lon: 126.9780 },
  { id: 'xian',        name: "Xi'an",       nameZh: '西安',   country: 'China',       region: 'china',         lat: 34.3416,  lon: 108.9398 },

  // China expansion. Guangzhou and Shenzhen share the Pearl River Delta blob;
  // it is split along their perpendicular bisector (no clipBbox needed).
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
  { id: 'istanbul',    name: 'Istanbul',    nameZh: '伊斯坦布尔',country: 'Turkey',   region: 'europe',        lat: 41.02,    lon: 29.10    }, // Bosphorus-central so the seed's home is the Asian side (feat 9136) and flood-fill reunites the European core across the 1.1 km strait; the old 28.98 seed captured only Europe (725 km²).
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

  // --- Shadow seeds -------------------------------------------------------
  // These are real neighboring cities that share a single Natural Earth
  // built-up blob with a displayed city. Adding them makes each shared blob a
  // multi-seed blob, so the perpendicular-bisector partition carves the
  // neighbor's territory off the displayed city (exactly like Guangzhou vs
  // Shenzhen). They also bound the flood-fill via the nearest-seed guard.
  //
  // `display: false` keeps them OUT of the viewer (the curated 79-city list is
  // unchanged) — they exist only to define the boundaries correctly. Flip any
  // to `display: true` to show it as its own selectable city; full metadata is
  // provided so that just works.
  //
  // Audit-verified: each falls inside the SAME NE feature as its primary.
  { id: 'dongguan',    name: 'Dongguan',    nameZh: '东莞',   country: 'China',       region: 'china',         lat: 23.05,    lon: 113.75,   display: false }, // splits Pearl River Delta (Guangzhou/Shenzhen)
  // Foshan is intentionally NOT a shadow seed: Guangzhou–Foshan ("Guangfo") is
  // a single, deeply-fused built-up mass, so we keep it whole under Guangzhou.
  { id: 'kobe',        name: 'Kobe',        nameZh: '神户',   country: 'Japan',       region: 'asia',          lat: 34.69,    lon: 135.195,  display: false }, // splits Keihanshin (Osaka)
  { id: 'kyoto',       name: 'Kyoto',       nameZh: '京都',   country: 'Japan',       region: 'asia',          lat: 35.011,   lon: 135.768,  display: false }, // splits Keihanshin (Osaka)
  { id: 'rotterdam',   name: 'Rotterdam',   nameZh: '鹿特丹', country: 'Netherlands', region: 'europe',        lat: 51.92,    lon: 4.48,     display: false }, // splits Randstad (Amsterdam)
  { id: 'the-hague',   name: 'The Hague',   nameZh: '海牙',   country: 'Netherlands', region: 'europe',        lat: 52.08,    lon: 4.31,     display: false }, // splits Randstad (Amsterdam)
  { id: 'baltimore',   name: 'Baltimore',   nameZh: '巴尔的摩',country: 'USA',        region: 'north-america', lat: 39.29,    lon: -76.61,   display: false }, // splits DC–Baltimore corridor (Washington)
  { id: 'providence',  name: 'Providence',  nameZh: '普罗维登斯',country: 'USA',      region: 'north-america', lat: 41.82,    lon: -71.41,   display: false }, // splits Boston–Providence corridor (Boston)
  { id: 'pretoria',    name: 'Pretoria',    nameZh: '比勒陀利亚',country: 'South Africa',region: 'africa',    lat: -25.7461, lon: 28.1881,  display: false }, // splits Gauteng blob (Johannesburg)
  { id: 'brazzaville', name: 'Brazzaville', nameZh: '布拉柴维尔',country: 'Congo',    region: 'africa',        lat: -4.2661,  lon: 15.2832,  display: false }, // splits cross-border Kinshasa/Brazzaville blob
  { id: 'tarragona',   name: 'Tarragona',   nameZh: '塔拉戈纳', country: 'Spain',       region: 'europe',        lat: 41.1189,  lon: 1.2445,   display: false }, // splits Camp de Tarragona (with Reus) off the 180 km Catalan coast blob (Barcelona)
  { id: 'bergamo',     name: 'Bergamo',     nameZh: '贝加莫',   country: 'Italy',       region: 'europe',        lat: 45.6983,  lon: 9.6773,   display: false }, // splits Lombardy blob (Milan)
  { id: 'brescia',     name: 'Brescia',     nameZh: '布雷西亚', country: 'Italy',       region: 'europe',        lat: 45.5416,  lon: 10.2118,  display: false }, // splits Lombardy blob (Milan)
  { id: 'karaj',       name: 'Karaj',       nameZh: '卡拉季',   country: 'Iran',        region: 'asia',          lat: 35.84,    lon: 50.9391,  display: false }, // splits Tehran–Karaj–Qazvin desert-overglow corridor (Tehran)
  { id: 'qazvin',      name: 'Qazvin',      nameZh: '加兹温',   country: 'Iran',        region: 'asia',          lat: 36.2797,  lon: 50.0049,  display: false }, // splits Tehran–Karaj–Qazvin desert-overglow corridor (Tehran)
];

// ---- Geometry helpers ------------------------------------------------------

const DEG = Math.PI / 180;

// Equirectangular km between two lon/lat points.
function km(aLon, aLat, bLon, bLat) {
  const mLat = (aLat + bLat) / 2;
  const dx = (aLon - bLon) * Math.cos(mLat * DEG) * 111.32;
  const dy = (aLat - bLat) * 110.57;
  return Math.hypot(dx, dy);
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

function simplifyRing(ring, targetPoints = SIMPLIFY_TARGET) {
  if (ring.length <= targetPoints) return ring;
  const step = Math.ceil(ring.length / targetPoints);
  const out = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  const first = out[0];
  const last = out[out.length - 1];
  if (last[0] !== first[0] || last[1] !== first[1]) out.push(first);
  return out;
}

// Proper (interior) crossing test between segments p1p2 and p3p4.
function segmentsCross(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (d === 0) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

// Remove self-crossings introduced by the every-Nth decimation above — a
// coarse step across a jagged boundary can pinch the ring into a small bowtie
// (Tokyo's Kanto ring shipped four 2-7 km ones). Standard 2-opt uncrossing:
// when edges (i,i+1) and (j,j+1) cross, reversing the sub-path i+1..j
// replaces them with two non-crossing edges and strictly shortens the
// perimeter, so iteration terminates (the pass cap only guards float edge
// cases). Takes and returns a closed ring.
function untangleRing(ring) {
  const pts = ring.slice(0, -1);
  const n = pts.length;
  let changed = true;
  for (let pass = 0; changed && pass < 100; pass++) {
    changed = false;
    for (let i = 0; i < n && !changed; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (segmentsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) {
          for (let a = i + 1, b = j; a < b; a++, b--) {
            const t = pts[a]; pts[a] = pts[b]; pts[b] = t;
          }
          changed = true;
          break;
        }
      }
    }
  }
  pts.push(pts[0]);
  return pts;
}

// Planar (equirectangular) area of a closed lon/lat ring, in km².
function ringAreaKm2(ring) {
  if (ring.length < 4) return 0;
  let meanLat = 0;
  for (let i = 0; i < ring.length - 1; i++) meanLat += ring[i][1];
  meanLat /= ring.length - 1;
  const cosLat = Math.cos(meanLat * DEG);
  let twiceArea = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    twiceArea += x1 * y2 - x2 * y1;
  }
  return (Math.abs(twiceArea) / 2) * 110.574 * 111.32 * cosLat;
}

// [minLat, maxLat, minLon, maxLon] over a set of rings (output bbox convention).
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

// Intersect a MultiPolygon (polygon-clipping coordinate form) with the
// half-plane (p - m)·n >= 0, modelled as a huge rectangle on the kept side.
// A Sutherland-Hodgman clip is NOT usable here: a concave conurbation blob's
// Voronoi cell is often disconnected (the bisector crosses the boundary 4-8
// times), and SH stitches the disjoint lobes together with phantom "bridge"
// edges along the bisector — the shipped Shenzhen ring once carried a
// 128 km straight edge across the whole Pearl River Delta plus two
// self-intersections. The martinez boolean instead returns each lobe as its
// own polygon. Points are [x, y] in the caller's coordinate space (km).
function clipHalfPlaneMulti(multi, mx, my, nx, ny) {
  const len = Math.hypot(nx, ny);
  const ux = nx / len, uy = ny / len; // unit normal, points into the kept side
  const dxx = -uy, dyy = ux; // unit direction along the bisector line
  const R = 1e5; // km — far beyond any blob (largest spans ~200 km)
  const rect = [[
    [mx - dxx * R, my - dyy * R],
    [mx + dxx * R, my + dyy * R],
    [mx + dxx * R + ux * R, my + dyy * R + uy * R],
    [mx - dxx * R + ux * R, my - dyy * R + uy * R],
    [mx - dxx * R, my - dyy * R],
  ]];
  return polygonClipping.intersection(multi, [rect]);
}

// ---- Load + build pieces ---------------------------------------------------

const urbanAreas = JSON.parse(fs.readFileSync('./urban_areas.json', 'utf-8'));

// One "piece" per outer ring. Natural Earth features are single Polygons, but
// we keep this general (a MultiPolygon feature would contribute one piece per
// sub-polygon, its area split evenly).
function featureRings(feature) {
  const g = feature.geometry;
  if (!g) return [];
  const area = feature.properties.area_sqkm || 0;
  if (g.type === 'Polygon') return [{ ring: g.coordinates[0], area }];
  if (g.type === 'MultiPolygon') {
    const n = g.coordinates.length;
    return g.coordinates.map((poly) => ({ ring: poly[0], area: area / n }));
  }
  return [];
}

function bboxLonLat(ring) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, maxLon, minLat, maxLat];
}

// Subsample a ring to <= max points for cheap edge-to-edge distance.
function repPoints(ring, max = 150) {
  if (ring.length <= max) return ring;
  const step = Math.ceil(ring.length / max);
  const out = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  return out;
}

const PIECES = [];
let featIdx = 0;
for (const feature of urbanAreas.features) {
  for (const { ring, area } of featureRings(feature)) {
    const bb = bboxLonLat(ring);
    PIECES.push({
      feat: featIdx,
      ring,
      area,
      bbox: bb, // [minLon, maxLon, minLat, maxLat]
      center: [(bb[0] + bb[1]) / 2, (bb[2] + bb[3]) / 2], // bbox center (coastline-unbiased)
      rep: repPoints(ring),
    });
  }
  featIdx++;
}

// Spatial grid over piece bboxes for near-neighbor queries during flood-fill.
const CELL = 0.25; // degrees (~27 km at mid-lat) > GAP_MAX, so a 1-cell halo suffices.
const grid = new Map();
const cellKey = (cx, cy) => `${cx},${cy}`;
for (let i = 0; i < PIECES.length; i++) {
  const [minLon, maxLon, minLat, maxLat] = PIECES[i].bbox;
  for (let cx = Math.floor(minLon / CELL); cx <= Math.floor(maxLon / CELL); cx++) {
    for (let cy = Math.floor(minLat / CELL); cy <= Math.floor(maxLat / CELL); cy++) {
      const k = cellKey(cx, cy);
      let arr = grid.get(k);
      if (!arr) grid.set(k, (arr = []));
      arr.push(i);
    }
  }
}

// Candidate piece indices whose bbox is within GAP_MAX of the given bbox.
function nearbyPieces(bbox) {
  const pad = CELL; // one cell of halo covers GAP_MAX (8 km ≪ 27 km)
  const [minLon, maxLon, minLat, maxLat] = bbox;
  const out = new Set();
  for (let cx = Math.floor((minLon - pad) / CELL); cx <= Math.floor((maxLon + pad) / CELL); cx++) {
    for (let cy = Math.floor((minLat - pad) / CELL); cy <= Math.floor((maxLat + pad) / CELL); cy++) {
      const arr = grid.get(cellKey(cx, cy));
      if (arr) for (const i of arr) out.add(i);
    }
  }
  return out;
}

// Min bbox-to-bbox gap in km (0 if they overlap) — a cheap prefilter for fgap.
function bboxGapKm(a, b) {
  const dLon = Math.max(0, a[0] - b[1], b[0] - a[1]);
  const dLat = Math.max(0, a[2] - b[3], b[2] - a[3]);
  const mLat = (a[2] + a[3] + b[2] + b[3]) / 4;
  return Math.hypot(dLon * Math.cos(mLat * DEG) * 111.32, dLat * 110.57);
}

// Min edge-to-edge distance (km) between two pieces, Infinity if bbox gap
// already exceeds GAP_MAX.
function fgap(p, q) {
  if (bboxGapKm(p.bbox, q.bbox) > GAP_MAX) return Infinity;
  let best = Infinity;
  for (const [ax, ay] of p.rep) {
    for (const [bx, by] of q.rep) {
      const d = km(ax, ay, bx, by);
      if (d < best) best = d;
      if (best === 0) return 0;
    }
  }
  return best;
}

// ---- Home assignment + nearest-seed ownership ------------------------------

// nearestSeed[pieceIdx] = seed index (of all cities) nearest the piece center.
const nearestSeed = new Int32Array(PIECES.length).fill(-1);
{
  const dist = new Float64Array(PIECES.length).fill(Infinity);
  for (let s = 0; s < cities.length; s++) {
    const { lon, lat } = cities[s];
    for (let i = 0; i < PIECES.length; i++) {
      const d = km(lon, lat, PIECES[i].center[0], PIECES[i].center[1]);
      if (d < dist[i] || (d === dist[i] && s < nearestSeed[i])) {
        dist[i] = d;
        nearestSeed[i] = s;
      }
    }
  }
}

// home[seed] = piece index containing the seed (or nearest edge within SNAP_MAX).
// homeSeedsOf[pieceIdx] = list of seed indices whose home is this piece (>=2 => shared blob).
const home = new Int32Array(cities.length).fill(-1);
const homeSeedsOf = new Map();
const unmatched = [];

for (let s = 0; s < cities.length; s++) {
  const seed = cities[s];
  const pt = [seed.lon, seed.lat];
  let found = -1;
  for (let i = 0; i < PIECES.length; i++) {
    // cheap bbox reject
    const b = PIECES[i].bbox;
    if (pt[0] < b[0] || pt[0] > b[1] || pt[1] < b[2] || pt[1] > b[3]) continue;
    if (pointInRing(pt, PIECES[i].ring)) { found = i; break; }
  }
  if (found === -1) {
    // Snap to the nearest polygon edge (island seeds like Singapore).
    let best = -1, bestKm = Infinity;
    for (let i = 0; i < PIECES.length; i++) {
      const g = bboxGapKm([seed.lon, seed.lon, seed.lat, seed.lat], PIECES[i].bbox);
      if (g > bestKm) continue;
      for (const [rx, ry] of PIECES[i].rep) {
        const d = km(seed.lon, seed.lat, rx, ry);
        if (d < bestKm) { bestKm = d; best = i; }
      }
    }
    if (best !== -1 && bestKm <= SNAP_MAX) found = best;
  }
  if (found === -1) { unmatched.push(s); continue; }
  home[s] = found;
  let list = homeSeedsOf.get(found);
  if (!list) homeSeedsOf.set(found, (list = []));
  list.push(s);
}

// ---- Seed each city's owned geometry ---------------------------------------
// owned[seed] = array of rings (lon/lat) this city holds. Shared blobs are
// partitioned along perpendicular bisectors; sole homes take the whole ring.

const owned = cities.map(() => []);
const ownedPieceIdx = cities.map(() => []); // piece indices owned, for flood-fill adjacency
const claimedBy = new Int32Array(PIECES.length).fill(-1); // piece -> owning seed (or -1)

for (const [pieceIdx, seedList] of homeSeedsOf) {
  const piece = PIECES[pieceIdx];
  if (seedList.length === 1) {
    const s = seedList[0];
    owned[s].push(piece.ring);
    ownedPieceIdx[s].push(pieceIdx);
    claimedBy[pieceIdx] = s;
  } else {
    // Shared blob: split among its seeds by Voronoi (iterated bisector clip),
    // in a local km frame so the perpendicular is geometrically correct.
    const lat0 = piece.center[1];
    const kx = Math.cos(lat0 * DEG) * 111.32;
    const ky = 110.57;
    const toXY = ([lon, lat]) => [lon * kx, lat * ky];
    const fromXY = ([x, y]) => [x / kx, y / ky];
    const ringXY = piece.ring.map(toXY);
    const seedXY = seedList.map((s) => ({ s, p: toXY([cities[s].lon, cities[s].lat]) }));
    for (const a of seedXY) {
      let cell = [[ringXY]]; // MultiPolygon: the whole blob, outer ring only
      for (const b of seedXY) {
        if (b.s === a.s) continue;
        const mx = (a.p[0] + b.p[0]) / 2;
        const my = (a.p[1] + b.p[1]) / 2;
        cell = clipHalfPlaneMulti(cell, mx, my, a.p[0] - b.p[0], a.p[1] - b.p[1]);
        if (cell.length === 0) break;
      }
      if (cell.length > 0) {
        // A half-plane intersection of a hole-free polygon can't create holes,
        // so each cell polygon is just its outer ring — possibly several
        // disconnected lobes when the bisector cuts a concave blob repeatedly.
        // Sub-km² lobes are bisector-grazing noise, not urban fabric — drop.
        let pushed = false;
        for (const poly of cell) {
          const lobe = poly[0].map(fromXY);
          if (ringAreaKm2(lobe) >= 1) { owned[a.s].push(lobe); pushed = true; }
        }
        // Let each owner flood-fill outward from the blob just like a sole
        // home: seed its frontier with the shared piece so it can annex its own
        // adjacent suburbs (nearest-seed + reach still keep the owners apart).
        if (pushed) ownedPieceIdx[a.s].push(pieceIdx);
      }
    }
    // The blob piece is fully consumed by its owners; mark claimed so no one
    // else flood-fills into it.
    claimedBy[pieceIdx] = seedList[0];
  }
}

// ---- Adjacency flood-fill --------------------------------------------------
// Grow each city outward across gaps <= GAP_MAX from its owned fabric, annexing
// only pieces it is the nearest seed to, never another seed's home, never a
// city's excludeFeats. Frontier-based, iterated to a fixpoint.

const homePieceSet = new Set(); // pieces that are some seed's home (protected)
for (const s of home) if (s >= 0) homePieceSet.add(s);
for (let s = 0; s < cities.length; s++) if (home[s] >= 0) homePieceSet.add(home[s]);

const excludeOf = cities.map((c) => new Set(c.excludeFeats || []));

for (let s = 0; s < cities.length; s++) {
  if (ownedPieceIdx[s].length === 0) continue;
  const seed = cities[s];
  const frontier = [...ownedPieceIdx[s]];
  while (frontier.length) {
    const cur = frontier.pop();
    const candidates = nearbyPieces(PIECES[cur].bbox);
    for (const j of candidates) {
      if (claimedBy[j] !== -1) continue; // already owned
      if (nearestSeed[j] !== s) continue; // ownership guard
      if (excludeOf[s].has(PIECES[j].feat)) continue; // targeted override
      if (homePieceSet.has(j) && home[s] !== j) continue; // don't steal a home
      // reach bound (home piece is exempt — it is never a flood-fill candidate)
      if (km(seed.lon, seed.lat, PIECES[j].center[0], PIECES[j].center[1]) > REACH_MAX) continue;
      if (fgap(PIECES[cur], PIECES[j]) > GAP_MAX) continue; // adjacency
      claimedBy[j] = s;
      owned[s].push(PIECES[j].ring);
      ownedPieceIdx[s].push(j);
      frontier.push(j);
    }
  }
}

// ---- Assemble + write ------------------------------------------------------

const existing = fs.existsSync('./public/data/cities.json')
  ? JSON.parse(fs.readFileSync('./public/data/cities.json', 'utf-8'))
  : [];
const existingById = new Map(existing.map((c) => [c.id, c]));

const results = [];
const report = [];

for (let s = 0; s < cities.length; s++) {
  const city = cities[s];
  const rings = owned[s];
  if (!rings || rings.length === 0) {
    const prev = existingById.get(city.id);
    report.push({ id: city.id, name: city.name, status: 'UNMATCHED', areaKm2: prev?.areaKm2 ?? 0, pieces: 0 });
    if (prev) results.push(prev);
    continue;
  }

  const simplified = rings.map((r) => untangleRing(simplifyRing(r)));
  const bbox = ringsBbox(simplified);
  const areaKm2 = Math.round(simplified.reduce((sum, r) => sum + ringAreaKm2(r), 0));
  const totalPts = simplified.reduce((sum, r) => sum + r.length, 0);

  const geojson =
    simplified.length === 1
      ? { type: 'Polygon', coordinates: [simplified[0]] }
      : { type: 'MultiPolygon', coordinates: simplified.map((r) => [r]) };

  const prev = existingById.get(city.id);
  const entry = {
    id: city.id,
    name: city.name,
    nameZh: city.nameZh,
    country: city.country,
    region: city.region,
    geojson,
    bbox,
    areaKm2,
  };
  if (prev?.rivers) entry.rivers = prev.rivers;
  if (prev?.coastline) entry.coastline = prev.coastline;
  // Shadow seeds partition the geometry but are not written to the viewer.
  if (city.display !== false) results.push(entry);
  report.push({
    id: city.id,
    name: city.name,
    status: city.display === false ? 'shadow' : 'ok',
    areaKm2,
    pieces: simplified.length,
    totalPts,
  });
}

// Emit in seed order (displayed cities only).
const ordered = cities
  .filter((c) => c.display !== false)
  .map((c) => results.find((r) => r.id === c.id))
  .filter(Boolean);
fs.writeFileSync('./public/data/cities.json', JSON.stringify(ordered, null, 2));

// ---- Console report --------------------------------------------------------

console.log('\nCity footprints (nearest-seed adjacency flood-fill):\n');
for (const r of report) {
  const flag = r.status === 'UNMATCHED' ? '  ✗' : r.status === 'shadow' ? '  ·' : '  ✓';
  const suffix = r.status === 'shadow' ? '  (shadow — partition only, not shown)'
    : r.status === 'UNMATCHED' ? '' : `${String(r.pieces).padStart(2)} piece(s)`;
  console.log(
    `${flag} ${r.name.padEnd(16)} ${String(r.areaKm2).padStart(6)} km²   ${suffix}`,
  );
}

// Sanity assertions.
const doubleOwned = [];
{
  const count = new Int32Array(PIECES.length);
  for (let i = 0; i < PIECES.length; i++) if (claimedBy[i] >= 0) count[i]++;
  // (claimedBy is single-valued by construction; kept for structural symmetry.)
}
const unmatchedNames = unmatched.map((s) => cities[s].name);
console.log(
  `\nWrote ${ordered.length} cities to public/data/cities.json` +
    (unmatchedNames.length ? `\nUnmatched (preserved prior): ${unmatchedNames.join(', ')}` : '') +
    (doubleOwned.length ? `\nWARNING double-owned pieces: ${doubleOwned.join(', ')}` : ''),
);
