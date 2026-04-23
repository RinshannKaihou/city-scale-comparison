export type Region =
  | 'china'
  | 'asia'
  | 'europe'
  | 'north-america'
  | 'south-america'
  | 'africa';

export interface CityData {
  id: string;
  name: string;
  nameZh: string;
  country: string;
  region: Region;
  geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon;
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
