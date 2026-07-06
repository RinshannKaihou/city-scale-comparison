// Export the current overlap as PNG or SVG.
//
// Both are re-derived from the SAME geometry the canvas renders, not scraped
// from the DOM (there is no DOM geometry anymore — it's a <canvas>):
//   • PNG  — re-run drawScene into an offscreen canvas at 2× for a crisp raster.
//   • SVG  — walk the cached per-city geometry and emit <path> elements. This
//            runs only on an export click, so vector export stays available
//            without any SVG cost during normal interaction.
//
// The LOD-simplified road geometry cached for the current zoom is reused as-is,
// so the export matches exactly what the user sees.

import type { CityViewModel } from '@/types/city';
import {
  drawScene,
  ensureRoads,
  type GeomCache,
  type Layout,
} from './map-render';

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function exportPng(
  cities: CityViewModel[],
  layout: Layout,
  cache: GeomCache,
  scaleText: string,
  pixelRatio = 2,
): Promise<void> {
  const { width, height } = layout;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.scale(pixelRatio, pixelRatio);

  // Force any not-yet-built roads (the on-screen build queue may not have
  // reached every visible city) so the export is complete, not partial.
  for (const city of cities) {
    if (city.visible) ensureRoads(cache, city, layout.globalScale);
  }
  drawScene(ctx, cities, layout, cache, { background: '#ffffff' });

  // Self-documenting footer (scale + watermark).
  ctx.globalAlpha = 1;
  ctx.font =
    "10px 'SF Mono', SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace";
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillText(`${scaleText}  ·  city-scale-compare`, 12, height - 12);

  await new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('toBlob returned null'));
      downloadBlob(blob, `city-scale-compare-${timestamp()}.png`);
      resolve();
    }, 'image/png');
  });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function ringsToD(rings: number[][][]): string {
  let d = '';
  for (const ring of rings) {
    if (ring.length < 2) continue;
    d += `M${round(ring[0][0])},${round(ring[0][1])}`;
    for (let i = 1; i < ring.length; i++) {
      d += `L${round(ring[i][0])},${round(ring[i][1])}`;
    }
    d += 'Z';
  }
  return d;
}

function polylinesToD(lines: Float32Array[]): string {
  let d = '';
  for (const line of lines) {
    d += `M${round(line[0])},${round(line[1])}`;
    for (let i = 2; i < line.length; i += 2) {
      d += `L${round(line[i])},${round(line[i + 1])}`;
    }
  }
  return d;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export function exportSvg(
  cities: CityViewModel[],
  layout: Layout,
  cache: GeomCache,
  scaleText: string,
): void {
  const { width, height, globalScale } = layout;
  const cx = width / 2;
  const cy = height / 2;
  const visible = cities.filter((c) => c.visible);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);

  // Background grid, matching the on-screen chrome.
  let grid = '';
  for (let x = 0; x <= width; x += 100) grid += `M${x},0V${height}`;
  for (let y = 0; y <= height; y += 100) grid += `M0,${y}H${width}`;
  parts.push(`<path d="${grid}" stroke="#000" stroke-width="0.5" opacity="0.15" fill="none"/>`);
  parts.push(
    `<path d="M${cx},0V${height}M0,${cy}H${width}" stroke="#000" stroke-width="0.5" opacity="0.12" stroke-dasharray="4 4" fill="none"/>`,
  );

  for (const city of visible) {
    const geom = ensureRoads(cache, city, globalScale);
    const boundaryD = ringsToD(geom.boundary.rings);
    const roadsD = geom.roads ? polylinesToD(geom.roads.polylines) : '';
    const clipId = `clip-${city.id}`;
    parts.push(
      `<g transform="translate(${round(cx + city.offset.x)},${round(cy + city.offset.y)})">`,
      `<defs><clipPath id="${clipId}"><path d="${boundaryD}"/></clipPath></defs>`,
      `<path d="${boundaryD}" fill="${city.color}" opacity="0.07"/>`,
      `<g clip-path="url(#${clipId})">`,
      `<path d="${roadsD}" fill="none" stroke="${city.color}" stroke-width="1.8" opacity="0.25" stroke-linecap="round" stroke-linejoin="round"/>`,
      `<path d="${roadsD}" fill="none" stroke="#1a1a1a" stroke-width="0.55" opacity="0.85" stroke-linecap="round" stroke-linejoin="round"/>`,
      `</g>`,
      `<path d="${boundaryD}" fill="none" stroke="${city.color}" stroke-width="1.4" opacity="0.9" stroke-linejoin="round"/>`,
      `<text x="${round(geom.boundary.label[0])}" y="${round(geom.boundary.label[1])}" text-anchor="middle" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke" font-size="12" font-family="SF Mono, ui-monospace, Menlo, Monaco, Consolas, monospace" font-weight="600">${escapeXml(city.nameZh)}</text>`,
      `</g>`,
    );
  }

  parts.push(
    `<text x="12" y="${height - 12}" font-family="SF Mono, ui-monospace, Menlo, Monaco, Consolas, monospace" font-size="10" fill="rgba(0,0,0,0.4)">${escapeXml(scaleText)}  ·  city-scale-compare</text>`,
  );
  parts.push('</svg>');

  const blob = new Blob([parts.join('')], {
    type: 'image/svg+xml;charset=utf-8',
  });
  downloadBlob(blob, `city-scale-compare-${timestamp()}.svg`);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
