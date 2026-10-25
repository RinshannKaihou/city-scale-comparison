// Data contract with pipeline/src/citydef/export.py. Every coordinate is in
// metres in the entry's own LAEA frame (origin = the main city's traditional
// centre), so the viewer never projects anything: equal scale is a property
// of the data, and overlaying two cities is a translation.

export type Bounds = [number, number, number, number]; // [minX, minY, maxX, maxY], metres

export interface RoadChunk {
  file: string;
  bounds: Bounds;
  bytes: number;
  vertices: number;
}

export interface Metrics {
  density: number; // residents per km² of A
  coverage: number; // building footprint share of A
  major_road_km: number;
  major_road_density: number; // km of motorway…tertiary per km² of A
  minor_road_km: number;
  minor_major_ratio: number;
  minor_incomplete: boolean; // residential < main-road length: under-mapped
  reach_p95_km: number;
  eq_diameter_km: number;
  proximity_index: number;
  // GHS-BUILT-V / -S inside A (satellite, globally consistent)
  avg_height_m: number; // building volume / footprint
  volume_density: number; // building volume per m² of land (÷ ~3 m ≈ floor-area ratio)
  // Overture buildings on 9 sample windows of 2 × 2 km (anchor + 8 random in A)
  bldg_windows: number;
  bldg_count: number;
  bldg_per_km2: number;
  footprint_wmedian_m2: number; // area-weighted median footprint ("building scale")
  footprint_median_m2: number;
  cluster_wmedian_m2: number; // area-weighted median of 12 m-closed building clusters
  bldg_completeness: number | null; // Overture footprint / GHSL built-up surface in the windows
  bldg_incomplete: boolean;
}

export interface Radial {
  ring_km: number; // ring width
  pop_density: number[]; // residents per km², ring i = [i, i+1) km from the anchor
  built_share: number[];
  volume_density: number[]; // m³ of building per m² of ring
  a_cover: number[]; // share of the ring inside definition A
}

/** One index record (cities.json): enough for the browser and metrics panel. */
export interface Entry {
  id: string;
  short: string;
  display: string; // "主名 + 含 X、Y"
  name_en: string;
  country: string;
  region: string;
  anchor: [number, number]; // lon, lat of the frame origin
  bounds: Bounds; // definition A, local metres
  a: { ucdb_id: number; ucdb_name: string; area_km2: number; pop: number; built_km2: number; epoch: number };
  metrics: Metrics;
  radial: Radial;
  files: { boundary: string; manifest: string; figure_ground: string };
  sizes: { overview_bytes: number; minor_bytes: number; minor_chunks: number };
}

/** Per-entry file list, fetched when the entry is first drawn. */
export interface Manifest {
  raster: { file: string; bounds: Bounds; bytes: number };
  roads: { major: { file: string; bytes: number }; minor: { chunk_m: number; chunks: RoadChunk[] } };
}

export interface DataIndex {
  entries: Entry[];
  overture: string;
  ghsl_epoch: number;
}

/** One road width tier, ready for a binary PathLayer. */
export interface PathSection {
  tier: number;
  paths: number;
  vertices: number;
  positions: Float32Array; // x0, y0, x1, y1, …
  startIndices: Uint32Array;
}

export type Polygons = number[][][][]; // polygons → rings → [x, y]

// Dev: the pipeline writes into web/public/data. Production: the data repo on
// GitHub Pages (see .env.production) — the data is ~270 MB, kept out of this repo.
const BASE = import.meta.env.VITE_DATA_BASE_URL ?? `${import.meta.env.BASE_URL}data/`;

export const dataUrl = (id: string, file: string) => `${BASE}${id}/${file}`;

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export const loadIndex = () => json<DataIndex>(`${BASE}cities.json`);
export const loadManifest = (e: Entry) => json<Manifest>(dataUrl(e.id, e.files.manifest));
export const loadBoundary = async (e: Entry) =>
  (await json<{ polygons: Polygons }>(dataUrl(e.id, e.files.boundary))).polygons;

// uint32 header length | header JSON | per section: float32 xy pairs, uint32
// path starts. Header is padded to 4 bytes, so every array view is aligned and
// zero-copy — "decoding" is just constructing TypedArray views.
export function decodeRoads(buf: ArrayBuffer): PathSection[] {
  const headerLen = new DataView(buf).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, headerLen)));
  const body = 4 + headerLen;
  return header.sections.map(
    (s: { tier: number; paths: number; vertices: number; pos_offset: number; starts_offset: number }) => ({
      tier: s.tier,
      paths: s.paths,
      vertices: s.vertices,
      positions: new Float32Array(buf, body + s.pos_offset, s.vertices * 2),
      startIndices: new Uint32Array(buf, body + s.starts_offset, s.paths),
    }),
  );
}

export interface LoadStats {
  bytes: number;
  files: number;
  ms: number;
}

export const loadStats: LoadStats = { bytes: 0, files: 0, ms: 0 };

const roadCache = new Map<string, Promise<PathSection[]>>();

/** Fetch + decode a road file once; later calls share the same promise. */
export function loadRoads(url: string): Promise<PathSection[]> {
  let p = roadCache.get(url);
  if (!p) {
    const t0 = performance.now();
    p = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => {
        loadStats.bytes += buf.byteLength;
        loadStats.files += 1;
        loadStats.ms += performance.now() - t0;
        return decodeRoads(buf);
      });
    roadCache.set(url, p);
  }
  return p;
}
