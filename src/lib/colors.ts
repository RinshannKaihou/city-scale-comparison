export const CITY_COLORS = [
  '#00f5d4', // cyan
  '#f15bb5', // magenta
  '#fee440', // yellow
  '#9b5de5', // purple
  '#00bbf9', // blue
  '#f8961e', // orange
  '#ef476f', // red-pink
  '#06d6a0', // green
  '#ff9f1c', // amber
  '#c77dff', // lavender
  '#70e000', // lime
  '#ff006e', // hot pink
  '#3a86ff', // royal blue
  '#ffbe0b', // gold
  '#fb5607', // burnt orange
];

export function getCityColor(index: number): string {
  return CITY_COLORS[index % CITY_COLORS.length];
}
