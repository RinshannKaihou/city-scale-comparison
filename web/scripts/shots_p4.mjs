// P4 report screenshots: the full metrics panel (building metrics, figure-ground,
// volume radial) and a street-level grid. System Chrome, headless, real GPU.
//
//   node scripts/shots_p4.mjs [url] [outdir]

import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const URL = process.argv[2] ?? "http://localhost:5174/city-scale-comparison/";
const OUT = process.argv[3] ?? "shots";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const IDS = ["beijing", "tokyo", "paris", "new-york", "sao-paulo", "hong-kong"];

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  defaultViewport: { width: 1600, height: 2950, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: "networkidle0" });
await page.waitForFunction(() => window.__p2 && window.__p2.size.width > 200, { timeout: 30000 });

const settle = () =>
  page.evaluate(async () => {
    const p = window.__p2;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let last = -1;
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      if (p.loadStats.files === last) break;
      last = p.loadStats.files;
    }
    await sleep(800);
  });

// 1 · full metrics panel, radial set to volume density, readout at ~6 km
await page.evaluate((ids) => {
  const p = window.__p2;
  p.setSelected(ids);
  p.setMode("grid");
  p.setSortKey("footprint");
}, IDS);
await settle();
const volumeBtn = await page.evaluateHandle(() => [...document.querySelectorAll(".seg button")].find((b) => b.textContent === "体量密度"));
await volumeBtn.click();
const svg = await page.$(".radial svg");
const box = await svg.boundingBox();
await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
await new Promise((r) => setTimeout(r, 300));
await (await page.$(".metrics")).screenshot({ path: path.join(OUT, "p4-panel.png") });
console.log("saved p4-panel");

// 2 · street-level grid of the same six (normal window height)
await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 2 });
await page.mouse.move(5, 940);
await page.evaluate(() => window.__p2.setView({ pan: [0, 0], zoom: Math.log2(1 / 6) }));
await settle();
await page.screenshot({ path: path.join(OUT, "p4-grid-street.png") });
console.log("saved p4-grid-street");
await browser.close();
