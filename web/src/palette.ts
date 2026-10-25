// Categorical colours (dataviz reference palette, light mode). One stable slot
// per selected city, shared by the map, the panel titles and every chart, so a
// city keeps its colour everywhere for as long as it stays selected.
//
// Slots validate pairwise for adjacent series (lines, bars); only the first
// three validate all-pairs, which is what an overlay needs (any city can sit on
// any other) — hence the overlay draws only the slot 0–2 cities.

export type Rgb = [number, number, number];

export const PALETTE: Rgb[] = [
  [42, 120, 214], // blue
  [235, 104, 52], // orange
  [27, 175, 122], // aqua
  [237, 161, 0], // yellow
  [232, 123, 164], // magenta
  [0, 131, 0], // green
  [98, 80, 214], // violet
  [227, 73, 72], // red
];

export const MAX_SELECTED = PALETTE.length;
export const OVERLAY_SLOTS = 3;

export const hex = (rgb: Rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
export const slotHex = (slot: number) => hex(PALETTE[slot]);

/** Keep existing slots; give newcomers the lowest free one. */
export function assignSlots(ids: string[], prev: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) if (prev[id] !== undefined) out[id] = prev[id];
  const used = new Set(Object.values(out));
  for (const id of ids) {
    if (out[id] !== undefined) continue;
    const free = PALETTE.findIndex((_, s) => !used.has(s));
    out[id] = free;
    used.add(free);
  }
  return out;
}

export const REGIONS: [string, string][] = [
  ["china", "中国"],
  ["asia", "亚太"],
  ["europe", "欧洲"],
  ["north-america", "北美"],
  ["south-america", "南美"],
  ["africa", "非洲"],
];
