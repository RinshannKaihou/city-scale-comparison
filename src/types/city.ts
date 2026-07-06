export type Region =
  | 'china'
  | 'asia'
  | 'europe'
  | 'north-america'
  | 'south-america'
  | 'africa';

// The GeoJSON geometry subset we actually use, defined locally so the type
// doesn't depend on the @types/geojson UMD global (which was only present
// transitively via @types/d3-geo — fragile).
export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: number[][][];
}
export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}
export type CityGeometry = PolygonGeometry | MultiPolygonGeometry;

export interface CityData {
  id: string;
  name: string;
  nameZh: string;
  country: string;
  region: Region;
  geojson: CityGeometry;
  bbox: [number, number, number, number];
  areaKm2: number;
  rivers?: number[][][];
  coastline?: number[][][];
  roads?: number[][][];
}

export interface CityViewModel extends CityData {
  color: string;
  offset: { x: number; y: number };
  visible: boolean;
}
