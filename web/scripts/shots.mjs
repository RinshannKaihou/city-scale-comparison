// Report screenshots for P3 (system Chrome, headless, real GPU).
//
//   node scripts/shots.mjs [url] [outdir]

import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const URL = process.argv[2] ?? "http://localhost:5174/city-scale-comparison/";
const OUT = process.argv[3] ?? "shots";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const shots = [
  { name: "p3-overlay", mode: "overlay", ids: ["tokyo", "paris", "beijing"], sort: "region", hoverRadial: 0.3 },
  { name: "p3-grid", mode: "grid", ids: ["prd", "tokyo", "new-york", "paris", "beijing", "chongqing", "mumbai", "lagos"], sort: "density" },
  { name: "p3-grid-street", mode: "grid", ids: ["prd", "tokyo", "new-york", "paris", "beijing", "chongqing", "mumbai", "lagos"], sort: "roads", mpp: 12 },
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  defaultViewport: { width: 1600, height: 950, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: "networkidle0" });
await page.waitForFunction(() => window.__p2 && window.__p2.size.width > 200, { timeout: 30000 });

for (const s of shots) {
  await page.evaluate(async (s) => {
    const p = window.__p2;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    p.setSelected([]);
    await sleep(100);
    p.setSelected(s.ids);
    p.setMode(s.mode);
    p.setSortKey(s.sort);
    p.setOffsets({});
    await sleep(500);
    if (s.mpp) p.setView({ pan: [0, 0], zoom: Math.log2(1 / s.mpp) });
    let last = -1;
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      if (p.loadStats.files === last) break;
      last = p.loadStats.files;
    }
    await sleep(800);
  }, s);
  // Park the mouse off every chart (a stale hover would dim the bars), unless
  // this shot is meant to show the radial readout.
  await page.mouse.move(5, 940);
  if (s.hoverRadial) {
    const box = await (await page.$(".radial svg")).boundingBox();
    await page.mouse.move(box.x + box.width * s.hoverRadial, box.y + box.height * 0.5);
  }
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: path.join(OUT, `${s.name}.png`) });
  console.log(`saved ${s.name}`);
}
await browser.close();
