// Canvas 2D rendering core for the equal-scale city overlap.
//
// Why canvas, not SVG: a single visible metro (Tokyo) carries ~1.1M road
// vertices. As SVG that becomes multi-megabyte `d` strings the browser must
// retain as DOM path geometry — and the old code rebuilt them inside React
// render on every scale change. Here the heavy work is imperative and cached.
//
// Two costs, handled separately:
//   • DRAW — clear + grid + translate/clip/stroke a cached Path2D per city.
//     ~0.2ms for a dozen metros, so drag (offset-only) is free: a city's
//     geometry only needs re-projecting when the GLOBAL SCALE changes, never
//     on drag. We cache per (city, scale).
//   • BUILD — projecting + LOD-simplifying a city's roads. This is the only
//     expensive step (hundreds of ms for Tokyo). It is split out: the cheap
//     BOUNDARY builds synchronously (outlines appear instantly); the heavy
//     ROADS build is driven one-city-per-frame by MapCanvas, so bulk-toggling
//     a whole region spreads across frames instead of freezing in one.
//
// bbox convention throughout this repo is [minLat, maxLat, minLon, maxLon].

import type { CityGeometry, CityViewModel } from '@/types/city';

const METERS_PER_DEG_LAT = 110540;

export interface Layout {
  width: number; // CSS pixels
  height: number; // CSS pixels
  globalScale: number; // pixels per meter
}

// Largest visible bbox drives the shared px-per-meter, so every city draws at
// the same km-per-pixel.
export function computeGlobalScale(
  cities: CityViewModel[],
  width: number,
  height: number,
): number {
  let maxHalfWidth = 0;
  let maxHalfHeight = 0;
  let any = false;
  for (const city of cities) {
    if (!city.visible) continue;
    any = true;
    const centerLat = (city.bbox[0] + city.bbox[1]) / 2;
    const metersPerDegLon = 111320 * Math.cos(centerLat * (Math.PI / 180));
    const widthMeters = (city.bbox[3] - city.bbox[2]) * metersPerDegLon;
    const heightMeters = (city.bbox[1] - city.bbox[0]) * METERS_PER_DEG_LAT;
    if (widthMeters / 2 > maxHalfWidth) maxHalfWidth = widthMeters / 2;
    if (heightMeters / 2 > maxHalfHeight) maxHalfHeight = heightMeters / 2;
  }
  if (!any) return 0.01;
  const padding = 0.75;
  const scaleX = (width * padding) / (maxHalfWidth * 2 || 1);
  const scaleY = (height * padding) / (maxHalfHeight * 2 || 1);
  return Math.min(scaleX, scaleY);
}

// Per-axis linear factors of the equirectangular projection around a bbox
// center. x = (lon - cLng) * fx ; y = (lat - cLat) * fy  (fy is negative so
// north is up). Local space is pre-offset: MapCanvas translates by
// (screenCenter + offset) at draw time, so the same cached geometry serves any
// drag position.
interface ProjFactors {
  cLng: number;
  cLat: number;
  fx: number;
  fy: number;
}

function projFactors(
  bbox: [number, number, number, number],
  scale: number,
): ProjFactors {
  const cLat = (bbox[0] + bbox[1]) / 2;
  return {
    cLng: (bbox[2] + bbox[3]) / 2,
    cLat,
    fx: 111320 * Math.cos(cLat * (Math.PI / 180)) * scale,
    fy: -METERS_PER_DEG_LAT * scale,
  };
}

function outerRings(geojson: CityGeometry): number[][][] {
  return geojson.type === 'Polygon'
    ? [geojson.coordinates[0]]
    : geojson.coordinates.map((poly) => poly[0]);
}

function allRings(geojson: CityGeometry): number[][][] {
  return geojson.type === 'Polygon'
    ? geojson.coordinates
    : geojson.coordinates.flat();
}

function projectRing(ring: number[][], p: ProjFactors): number[][] {
  const out: number[][] = new Array(ring.length);
  for (let i = 0; i < ring.length; i++) {
    out[i] = [(ring[i][0] - p.cLng) * p.fx, (ring[i][1] - p.cLat) * p.fy];
  }
  return out;
}

function ringsToPath(rings: number[][][]): Path2D {
  const path = new Path2D();
  for (const ring of rings) {
    if (ring.length < 2) continue;
    path.moveTo(ring[0][0], ring[0][1]);
    for (let i = 1; i < ring.length; i++) path.lineTo(ring[i][0], ring[i][1]);
    path.closePath();
  }
  return path;
}

// ---- Boundary (cheap, built synchronously) --------------------------------

export interface BoundaryGeom {
  path: Path2D; // local px
  rings: number[][][]; // all rings, local px (for vector export)
  outerRings: number[][][]; // outer rings, local px (for hit-test)
  label: [number, number]; // local px, centered above the blob
  minSegPx: number; // road LOD floor, derived from the boundary extent
}

export function buildBoundaryGeom(
  geojson: CityGeometry,
  bbox: [number, number, number, number],
  scale: number,
): BoundaryGeom {
  const p = projFactors(bbox, scale);
  const rings = allRings(geojson).map((r) => projectRing(r, p));
  const outer = outerRings(geojson).map((r) => projectRing(r, p));

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of outer) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  // Sub-pixel stubs read as noise when a large metro is zoomed out; drop
  // segments below ~0.3% of the diagonal (same floor as the old renderer).
  const minSegPx = Math.max(1, diag * 0.003);

  return {
    path: ringsToPath(rings),
    rings,
    outerRings: outer,
    label: [(minX + maxX) / 2, minY - 10],
    minSegPx,
  };
}

// ---- Roads (heavy, built off the draw hot path) ---------------------------

export interface RoadsGeom {
  path: Path2D; // local px, LOD-simplified
  polylines: Float32Array[]; // local px [x0,y0,x1,y1,...] (for vector export)
}

// Projects + LOD-decimates the road network. Allocation-light on purpose: the
// projection is inlined (no per-point closure or [x,y] array — Tokyo has ~1.1M
// points), and simplified polylines are packed into flat Float32Arrays. LOD is
// screen-space: keep a vertex only once it is `minSegPx` from the last kept
// one, and drop whole polylines shorter than that.
export function buildRoadsGeom(
  roads: number[][][],
  bbox: [number, number, number, number],
  scale: number,
  minSegPx: number,
): RoadsGeom {
  const { cLng, cLat, fx, fy } = projFactors(bbox, scale);
  const minSq = minSegPx * minSegPx;
  const path = new Path2D();
  const polylines: Float32Array[] = [];

  for (const seg of roads) {
    const m = seg.length;
    if (m < 2) continue;
    let lastX = (seg[0][0] - cLng) * fx;
    let lastY = (seg[0][1] - cLat) * fy;
    const pts: number[] = [lastX, lastY];
    for (let i = 1; i < m; i++) {
      const x = (seg[i][0] - cLng) * fx;
      const y = (seg[i][1] - cLat) * fy;
      const dx = x - lastX;
      const dy = y - lastY;
      if (dx * dx + dy * dy >= minSq) {
        pts.push(x, y);
        lastX = x;
        lastY = y;
      }
    }
    // Always keep the true endpoint so streets don't visibly shrink.
    const ex = (seg[m - 1][0] - cLng) * fx;
    const ey = (seg[m - 1][1] - cLat) * fy;
    if (pts[pts.length - 2] !== ex || pts[pts.length - 1] !== ey) {
      pts.push(ex, ey);
    }
    if (pts.length < 4) continue;
    let total = 0;
    for (let i = 2; i < pts.length; i += 2) {
      total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    }
    if (total < minSegPx) continue;

    const flat = Float32Array.from(pts);
    polylines.push(flat);
    path.moveTo(flat[0], flat[1]);
    for (let i = 2; i < flat.length; i += 2) path.lineTo(flat[i], flat[i + 1]);
  }

  return { path, polylines };
}

// ---- Cache ----------------------------------------------------------------

export interface CityGeom {
  scale: number;
  roadsRef: number[][][] | undefined; // identity, to detect a roads load
  boundary: BoundaryGeom;
  roads: RoadsGeom | null; // null until built (or if the city has no roads yet)
}

export type GeomCache = Map<string, CityGeom>;

// Returns the cache entry for a city at the current scale, building the cheap
// BOUNDARY synchronously if needed. Road geometry is NOT built here — that is
// driven separately (MapCanvas queue, or ensureRoads for export).
export function getCityGeom(
  cache: GeomCache,
  city: CityViewModel,
  scale: number,
): CityGeom {
  const cached = cache.get(city.id);
  if (cached && cached.scale === scale && cached.roadsRef === city.roads) {
    return cached;
  }
  const geom: CityGeom = {
    scale,
    roadsRef: city.roads,
    boundary: buildBoundaryGeom(city.geojson, city.bbox, scale),
    roads: null,
  };
  cache.set(city.id, geom);
  return geom;
}

// Force the road geometry to be present (synchronous). Used by export, where a
// one-off full build on click is fine.
export function ensureRoads(
  cache: GeomCache,
  city: CityViewModel,
  scale: number,
): CityGeom {
  const geom = getCityGeom(cache, city, scale);
  if (!geom.roads && city.roads) {
    geom.roads = buildRoadsGeom(
      city.roads,
      city.bbox,
      scale,
      geom.boundary.minSegPx,
    );
  }
  return geom;
}

// ---- Hit-testing ----------------------------------------------------------

function pointInRing(px: number, py: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Topmost visible city whose polygon contains the screen point, or null.
// Iterates reverse draw order so the front-most city wins in overlaps.
export function hitTest(
  cities: CityViewModel[],
  layout: Layout,
  cache: GeomCache,
  sx: number,
  sy: number,
): string | null {
  const cx = layout.width / 2;
  const cy = layout.height / 2;
  const visible = cities.filter((c) => c.visible);
  for (let i = visible.length - 1; i >= 0; i--) {
    const city = visible[i];
    const geom = cache.get(city.id);
    if (!geom) continue;
    const lx = sx - (cx + city.offset.x);
    const ly = sy - (cy + city.offset.y);
    for (const ring of geom.boundary.outerRings) {
      if (pointInRing(lx, ly, ring)) return city.id;
    }
  }
  return null;
}

// ---- Drawing --------------------------------------------------------------

const GRID_SPACING = 100;

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.15;
  ctx.beginPath();
  for (let x = 0; x <= width; x += GRID_SPACING) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += GRID_SPACING) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  ctx.globalAlpha = 0.12;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(width / 2, 0);
  ctx.lineTo(width / 2, height);
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
  ctx.restore();
}

const LABEL_FONT =
  "600 12px 'SF Mono', SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace";

export interface DrawOptions {
  background?: string; // fill the frame first (export wants white); omit = transparent
}

// Draws the scene from whatever is in the cache: every visible city's boundary
// (built lazily here — cheap), plus its roads if they have been built. `ctx`
// is expected to already be scaled so 1 unit == 1 CSS pixel.
export function drawScene(
  ctx: CanvasRenderingContext2D,
  cities: CityViewModel[],
  layout: Layout,
  cache: GeomCache,
  opts: DrawOptions = {},
): void {
  const { width, height, globalScale } = layout;
  ctx.clearRect(0, 0, width, height);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, width, height);
  }
  drawGrid(ctx, width, height);

  const cx = width / 2;
  const cy = height / 2;
  const visible = cities.filter((c) => c.visible);

  for (const city of visible) {
    const geom = getCityGeom(cache, city, globalScale);
    ctx.save();
    ctx.translate(cx + city.offset.x, cy + city.offset.y);

    // Tinted wash inside the polygon.
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = city.color;
    ctx.fill(geom.boundary.path);

    // Road network — colored halo + dark core, clipped to the polygon. Absent
    // until the build queue produces it (boundary shows immediately).
    if (geom.roads) {
      ctx.save();
      ctx.clip(geom.boundary.path);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = city.color;
      ctx.lineWidth = 1.8;
      ctx.stroke(geom.roads.path);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 0.55;
      ctx.stroke(geom.roads.path);
      ctx.restore();
    }

    // Colored polygon outline.
    ctx.globalAlpha = 0.9;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = city.color;
    ctx.lineWidth = 1.4;
    ctx.stroke(geom.boundary.path);

    ctx.restore();
  }

  // Labels last, unclipped, on top of everything.
  ctx.globalAlpha = 1;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  for (const city of visible) {
    const geom = cache.get(city.id);
    if (!geom) continue;
    const x = cx + city.offset.x + geom.boundary.label[0];
    const y = cy + city.offset.y + geom.boundary.label[1];
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(city.nameZh, x, y);
    ctx.fillStyle = '#111111';
    ctx.fillText(city.nameZh, x, y);
  }
}
