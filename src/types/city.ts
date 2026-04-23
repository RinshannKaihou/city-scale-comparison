export interface CityData {
  id: string;
  name: string;
  nameZh: string;
  country: string;
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
