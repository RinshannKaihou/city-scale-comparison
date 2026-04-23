import { useId, useMemo } from 'react';
import * as d3 from 'd3';
import type { CityViewModel } from '@/types/city';

interface CityMapProps {
  city: CityViewModel;
  globalScale: number;
  onMouseDown: (e: React.MouseEvent, cityId: string) => void;
  isDragging: boolean;
}

type Transformer = (lon: number, lat: number) => { x: number; y: number };

// Project around the admin polygon's bbox center. Keeping the admin
// polygon's own center as the origin means that the boundary we draw
// (which IS the admin polygon) is nicely centered on screen, and the
// city's linear size matches its stated areaKm2.
function createTransformer(
  bbox: [number, number, number, number],
  globalScale: number
): Transformer {
  const centerLng = (bbox[2] + bbox[3]) / 2;
  const centerLat = (bbox[0] + bbox[1]) / 2;
  const metersPerDegLon = 111320 * Math.cos(centerLat * (Math.PI / 180));
  const metersPerDegLat = 110540;
  return (lon, lat) => ({
    x: (lon - centerLng) * metersPerDegLon * globalScale,
    y: -(lat - centerLat) * metersPerDegLat * globalScale,
  });
}

function buildRoadPath(roads: number[][][], transformer: Transformer, minPx: number): string {
  const parts: string[] = [];
  for (const seg of roads) {
    if (!seg || seg.length < 2) continue;
    let d = '';
    let lastX = 0;
    let lastY = 0;
    let total = 0;
    for (let i = 0; i < seg.length; i++) {
      const p = seg[i];
      const t = transformer(p[0], p[1]);
      const x = Math.round(t.x * 10) / 10;
      const y = Math.round(t.y * 10) / 10;
      if (i === 0) {
        d = `M${x},${y}`;
      } else {
        d += `L${x},${y}`;
        const dx = x - lastX;
        const dy = y - lastY;
        total += Math.sqrt(dx * dx + dy * dy);
      }
      lastX = x;
      lastY = y;
    }
    if (total >= minPx) parts.push(d);
  }
  return parts.join(' ');
}

export function CityMap({ city, globalScale, onMouseDown, isDragging }: CityMapProps) {
  const rawId = useId();
  const clipId = `clip-${rawId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  const { boundaryD, roadsD, labelX, labelY } = useMemo(() => {
    const transformer = createTransformer(city.bbox, globalScale);

    // Admin polygon via d3.geoPath with pixel-space transform.
    const transform = d3.geoTransform({
      point(lon: number, lat: number) {
        const t = transformer(lon, lat);
        this.stream.point(t.x, t.y);
      },
    });
    const geoPath = d3.geoPath(transform);
    const boundaryD = geoPath(city.geojson) || '';

    // Projected polygon bounds — used for label placement. Iterates
    // every outer ring so MultiPolygon cities (e.g. NYC's boroughs)
    // get a label centered on the whole blob, not just one piece.
    const outerRings: number[][][] =
      city.geojson.type === 'Polygon'
        ? [city.geojson.coordinates[0]]
        : city.geojson.coordinates.map((poly) => poly[0]);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const ring of outerRings) {
      for (const [lon, lat] of ring) {
        const t = transformer(lon, lat);
        if (t.x < minX) minX = t.x;
        if (t.x > maxX) maxX = t.x;
        if (t.y < minY) minY = t.y;
        if (t.y > maxY) maxY = t.y;
      }
    }

    // Drop sub-pixel stubs so the network doesn't read as noise when
    // zoomed way out on large admin regions.
    const diag = Math.hypot(maxX - minX, maxY - minY);
    const minSegPx = Math.max(2, diag * 0.003);
    const roadsD = buildRoadPath(city.roads || [], transformer, minSegPx);

    return {
      boundaryD,
      roadsD,
      labelX: (minX + maxX) / 2,
      labelY: minY - 10,
    };
  }, [city.geojson, city.bbox, city.roads, globalScale]);

  const color = city.color;

  return (
    <g
      transform={`translate(${city.offset.x}, ${city.offset.y})`}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      onMouseDown={(e) => onMouseDown(e, city.id)}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={boundaryD} />
        </clipPath>
      </defs>

      {/* Tinted wash inside the admin polygon. */}
      <path d={boundaryD} fill={color} opacity={0.07} style={{ pointerEvents: 'none' }} />

      {/* Road network — halo + core, clipped to the admin polygon. */}
      <g clipPath={`url(#${clipId})`} style={{ pointerEvents: 'none' }}>
        <path
          d={roadsD}
          fill="none"
          stroke={color}
          strokeWidth={1.8}
          opacity={0.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={roadsD}
          fill="none"
          stroke="#1a1a1a"
          strokeWidth={0.55}
          opacity={0.85}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Admin polygon outline — colored, so cities are easy to tell apart. */}
      <path
        d={boundaryD}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        opacity={0.9}
        strokeLinejoin="round"
        style={{ pointerEvents: 'none' }}
      />

      {/* Hit area for dragging. */}
      <path
        d={boundaryD}
        fill="rgba(0,0,0,0.001)"
        stroke="transparent"
        strokeWidth={14}
        style={{ pointerEvents: 'all' }}
      />

      <text
        x={labelX}
        y={labelY}
        textAnchor="middle"
        fill="#111"
        stroke="#fff"
        strokeWidth={3}
        paintOrder="stroke"
        fontSize={12}
        fontFamily="'SF Mono', SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace"
        fontWeight={600}
        style={{ pointerEvents: 'none' }}
      >
        {city.nameZh}
      </text>
    </g>
  );
}
