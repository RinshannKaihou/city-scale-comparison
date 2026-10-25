// P2 frame-time benchmark: drives the running dev server in the system
// Chrome (headless, real GPU via ANGLE/Metal) and times animation frames while
// a city is dragged or the view pans every frame. Frame-rate limiting is off,
// so the interval between frames is the real cost of a frame.
//
//   node scripts/bench.mjs [url] [outdir]
//
// Uses window.__p2 test hooks exposed by App.tsx.

import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const URL = process.argv[2] ?? "http://localhost:5174/city-scale-comparison/";
const OUT = process.argv[3] ?? "bench-out";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ALL = ["beijing", "chongqing", "tokyo", "paris", "new-york", "prd"];
const THREE = ["tokyo", "paris", "beijing"];
// P3 worst case: the eight largest urban centres (selection cap is 8).
const BIG8 = ["prd", "tokyo", "jakarta", "los-angeles", "new-york", "shanghai", "miami", "bangkok"];

const scenarios = [
  { key: "A", label: "叠加 3 城 · 总览 ±130 km · 每帧拖动东京", mode: "overlay", ids: THREE, mpp: null, step: "drag-wide" },
  { key: "B", label: "叠加 3 城 · 12 m/px 含支路 · 每帧平移", mode: "overlay", ids: THREE, mpp: 12, step: "pan" },
  { key: "C", label: "并排 6 格 · 总览 ±130 km · 每帧平移（6 格同步）", mode: "grid", ids: ALL, mpp: null, step: "pan-wide" },
  { key: "D", label: "并排 6 格 · 12 m/px 含支路 · 每帧平移（6 格同步）", mode: "grid", ids: ALL, mpp: 12, step: "pan" },
  { key: "E", label: "并排 8 格（最大的 8 个城市中心）· 总览 · 每帧平移", mode: "grid", ids: BIG8, mpp: null, step: "pan-wide" },
  { key: "F", label: "并排 8 格（最大的 8 个城市中心）· 12 m/px 含支路 · 每帧平移", mode: "grid", ids: BIG8, mpp: 12, step: "pan" },
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-frame-rate-limit"],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: "networkidle0" });
await page.waitForFunction(() => window.__p2 && window.__p2.size.width > 200, { timeout: 30000 });

const gpu = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});

const results = [];
for (const s of scenarios) {
  const r = await page.evaluate(async (s) => {
    const p = window.__p2;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    p.setMode(s.mode);
    p.setSelected(s.ids);
    p.setOffsets({});
    await sleep(400); // let the app re-fit for the new mode / panel count
    if (s.mpp) p.setView({ pan: [0, 0], zoom: Math.log2(1 / s.mpp) });
    let last = -1;
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      if (p.loadStats.files === last) break;
      last = p.loadStats.files;
    }
    await sleep(500);
    const step = {
      "drag-wide": (i) => p.setOffsets((o) => ({ ...o, tokyo: [Math.sin(i / 20) * 40000, Math.cos(i / 20) * 30000] })),
      pan: (i) => p.setView((v) => ({ ...v, pan: [Math.sin(i / 30) * 3000, Math.cos(i / 30) * 2000] })),
      "pan-wide": (i) => p.setView((v) => ({ ...v, pan: [Math.sin(i / 30) * 30000, Math.cos(i / 30) * 20000] })),
    }[s.step];
    const ts = [];
    await new Promise((resolve) => {
      let i = 0;
      const tick = (t) => {
        ts.push(t);
        step(i);
        if (++i < 300) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    const d = ts.slice(10).map((t, i) => t - ts[i + 9]).sort((a, b) => a - b);
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    p.setView((v) => ({ ...v, pan: [0, 0] }));
    p.setOffsets({});
    await sleep(300);
    return {
      frames: d.length,
      meanMs: +mean.toFixed(2),
      p95Ms: +d[Math.floor(d.length * 0.95)].toFixed(2),
      maxMs: +d[d.length - 1].toFixed(2),
      loadedMB: +(p.loadStats.bytes / 1e6).toFixed(1),
      files: p.loadStats.files,
    };
  }, s);
  await page.screenshot({ path: path.join(OUT, `scenario-${s.key}.png`) });
  results.push({ key: s.key, label: s.label, ...r });
  console.log(JSON.stringify(results.at(-1)));
}

const load = await page.evaluate(() => ({ fetchDecodeMsSum: Math.round(window.__p2.loadStats.ms) }));
fs.writeFileSync(path.join(OUT, "bench.json"), JSON.stringify({ url: URL, gpu, viewport: "1440x900 @2x", ...load, results }, null, 2));
console.log(JSON.stringify({ gpu, ...load }));
await browser.close();
