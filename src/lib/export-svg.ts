// Export the current map SVG as PNG or SVG file.
//
// PNG export: serialize the live SVG to a data URL, load it as an Image,
// draw to a Canvas at 2× scale (retina), call canvas.toBlob, download.
//
// SVG export: just XMLSerialize + Blob. Vector, infinite resolution.
//
// What's NOT included: the HTML legend, scale indicator, and hint text
// (those are <div>s overlaid on the SVG, not inside it). The exporter
// burns a small scale annotation into the SVG before export so the
// exported image is self-documenting about its km-per-pixel.

const SVG_NS = 'http://www.w3.org/2000/svg';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Clone the SVG, add a self-documenting footer (scale + watermark) and a
// white background rect, and return the serialized XML string.
function prepareSvgForExport(svg: SVGSVGElement, scaleText: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const width = svg.clientWidth || Number(svg.getAttribute('width')) || 800;
  const height = svg.clientHeight || Number(svg.getAttribute('height')) || 600;

  // Ensure explicit width/height and xmlns so the serialized SVG is
  // standalone-renderable (a live <svg> in the DOM might inherit these).
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`);

  // White background rect at the start so PNG isn't transparent and SVG
  // viewers (browsers, Sketch, Figma) all render against white.
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', String(width));
  bg.setAttribute('height', String(height));
  bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);

  // Footer annotation: scale + watermark
  const footer = document.createElementNS(SVG_NS, 'text');
  footer.setAttribute('x', '12');
  footer.setAttribute('y', String(height - 12));
  footer.setAttribute('font-family', 'SF Mono, ui-monospace, Menlo, Monaco, Consolas, monospace');
  footer.setAttribute('font-size', '10');
  footer.setAttribute('fill', 'rgba(0,0,0,0.4)');
  footer.textContent = `${scaleText}  ·  city-scale-compare`;
  clone.appendChild(footer);

  return new XMLSerializer().serializeToString(clone);
}

export function exportSvg(svg: SVGSVGElement, scaleText: string) {
  const xml = prepareSvgForExport(svg, scaleText);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, `city-scale-compare-${timestamp()}.svg`);
}

export async function exportPng(
  svg: SVGSVGElement,
  scaleText: string,
  pixelRatio = 2,
): Promise<void> {
  const xml = prepareSvgForExport(svg, scaleText);
  const width = svg.clientWidth || Number(svg.getAttribute('width')) || 800;
  const height = svg.clientHeight || Number(svg.getAttribute('height')) || 600;

  // Inline SVG → data URL. Use base64 to avoid URL-encoding pitfalls
  // with characters d3 emits in path attributes.
  const svgBase64 = btoa(unescape(encodeURIComponent(xml)));
  const dataUrl = `data:image/svg+xml;base64,${svgBase64}`;

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to rasterize SVG'));
    img.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.scale(pixelRatio, pixelRatio);
  ctx.drawImage(img, 0, 0, width, height);

  await new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('toBlob returned null'));
      downloadBlob(blob, `city-scale-compare-${timestamp()}.png`);
      resolve();
    }, 'image/png');
  });
}
