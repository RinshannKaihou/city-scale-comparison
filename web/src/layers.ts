import type { Layer, PickingInfo } from "@deck.gl/core";
import { BitmapLayer, PathLayer, PolygonLayer } from "@deck.gl/layers";
import type { Entry, Manifest, PathSection, Polygons } from "./data";
import { dataUrl } from "./data";
import type { Rgb } from "./palette";
import { PALETTE } from "./palette";

/** How one entry is drawn. Overlay: its own hue. Grid: one shared style. */
export interface EntryStyle {
  roads: Rgb;
  density: Rgb;
  outline: Rgb;
}

// Small multiples: every panel identical, so density and street grain compare
// panel to panel; identity comes from the panel title (with its colour chip).
export const GRID_STYLE: EntryStyle = {
  roads: [47, 46, 43],
  density: [42, 120, 214],
  outline: [11, 11, 11],
};

export const overlayStyle = (slot: number): EntryStyle => {
  const c = PALETTE[slot];
  return { roads: c, density: c, outline: c };
};

// Road hierarchy is drawn, not implied: width and opacity step down by tier.
// 0 motorway/trunk · 1 primary/secondary · 2 tertiary · 3 residential & minor
const TIER_WIDTH = [2.2, 1.4, 0.9, 0.55];
const TIER_ALPHA = [235, 215, 180, 150];

/** Residential streets are only drawn (and fetched) below this many m/px. */
export const MINOR_MAX_MPP = 25;

export interface EntryGeometry {
  manifest?: Manifest;
  boundary?: Polygons;
  major?: PathSection[];
  minor: Map<string, PathSection[]>; // chunk file → sections
}

export interface Show {
  roads: boolean;
  density: boolean;
  boundary: boolean;
}

export interface DragHandlers {
  onDragStart: (id: string, info: PickingInfo) => boolean;
  onDrag: (info: PickingInfo) => boolean;
  onDragEnd: () => boolean;
}

export interface LayerInput {
  entry: Entry;
  style: EntryStyle;
  offset: [number, number];
  minorFiles: string[]; // chunks intersecting this entry's part of the screen
}

// The 100 m density raster carries the city-scale pattern; once zoomed in
// far enough for streets to carry it, fade the (now blurry) raster back so it
// stops competing with the roads: 0.40 at ≥80 m/px → 0.12 at ≤10 m/px.
function densityOpacity(mpp: number) {
  const t = Math.min(1, Math.max(0, Math.log2(mpp / 10) / Math.log2(80 / 10)));
  return 0.12 + (0.4 - 0.12) * t;
}

// Zoomed far out, a metro's whole network collapses into a solid mass that
// hides the density layer; thin and lighten roads with distance: full
// strength at ≤60 m/px, down to 30% (and 70% width) at whole-region views.
function roadScale(mpp: number) {
  const alpha = Math.min(1, Math.max(0.3, Math.log2(800 / mpp) / Math.log2(800 / 60)));
  return { alpha, width: mpp > 300 ? 0.7 : 1 };
}

const translate = (dx: number, dy: number) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, dy, 0, 1]);
const flat = { depthCompare: "always", depthWriteEnabled: false } as const;

// Binary data objects must keep their identity across renders, or deck.gl
// re-uploads the attributes; a WeakMap pins one wrapper per decoded section.
const binaryCache = new WeakMap<PathSection, object>();
function binary(section: PathSection) {
  let data = binaryCache.get(section);
  if (!data) {
    data = {
      length: section.paths,
      startIndices: section.startIndices,
      attributes: { getPath: { value: section.positions, size: 2 } },
    };
    binaryCache.set(section, data);
  }
  return data;
}

function roadLayer(id: string, section: PathSection, rgb: Rgb, modelMatrix: Float32Array, mpp: number) {
  const k = roadScale(mpp);
  return new PathLayer({
    id,
    data: binary(section) as never,
    positionFormat: "XY",
    _pathType: "open",
    getColor: [...rgb, Math.round(TIER_ALPHA[section.tier] * k.alpha)],
    getWidth: TIER_WIDTH[section.tier] * k.width,
    widthUnits: "pixels",
    jointRounded: false,
    capRounded: false,
    modelMatrix,
    parameters: flat,
  });
}

/**
 * Layers for every input, grouped by kind so that, across cities, density sits
 * under minor roads, under major roads, under boundaries. Layer ids start with
 * the entry id — the grid's layerFilter routes them to their panel by that.
 */
export function buildLayers(
  inputs: LayerInput[],
  geometry: Record<string, EntryGeometry>,
  show: Show,
  mpp: number,
  drag: DragHandlers | null,
): Layer[] {
  const density: Layer[] = [];
  const minor: Layer[] = [];
  const major: Layer[] = [];
  const outlines: Layer[] = [];

  for (const { entry, style, offset, minorFiles } of inputs) {
    const m = translate(offset[0], offset[1]);
    const g = geometry[entry.id];

    if (show.density && g?.manifest) {
      density.push(
        new BitmapLayer({
          id: `${entry.id}-density`,
          image: dataUrl(entry.id, g.manifest.raster.file),
          bounds: g.manifest.raster.bounds,
          tintColor: style.density,
          opacity: densityOpacity(mpp),
          modelMatrix: m,
          parameters: flat,
        }),
      );
    }
    if (show.roads && g?.major) {
      for (const s of g.major) major.push(roadLayer(`${entry.id}-major-${s.tier}`, s, style.roads, m, mpp));
    }
    if (show.roads && g && mpp < MINOR_MAX_MPP) {
      for (const file of minorFiles) {
        const sections = g.minor.get(file);
        if (sections) for (const s of sections) minor.push(roadLayer(`${entry.id}-${file}`, s, style.roads, m, mpp));
      }
    }
    if (g?.boundary) {
      // In overlay mode this is also the drag handle, so it stays in the
      // scene (near-transparent) even when the outline is switched off.
      outlines.push(
        new PolygonLayer({
          id: `${entry.id}-boundary`,
          data: g.boundary,
          getPolygon: (d: number[][][]) => d,
          filled: !!drag,
          getFillColor: [...style.outline, show.boundary ? 14 : 1],
          stroked: show.boundary,
          getLineColor: [...style.outline, 210],
          getLineWidth: drag ? 1.6 : 1.1,
          lineWidthUnits: "pixels",
          pickable: !!drag,
          autoHighlight: !!drag,
          highlightColor: [...style.outline, 40],
          modelMatrix: m,
          parameters: flat,
          ...(drag && {
            onDragStart: (info: PickingInfo) => drag.onDragStart(entry.id, info),
            onDrag: (info: PickingInfo) => drag.onDrag(info),
            onDragEnd: () => drag.onDragEnd(),
          }),
        }),
      );
    }
  }
  return [...density, ...minor, ...major, ...outlines];
}
