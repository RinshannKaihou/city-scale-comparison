// Angle-based stroke stitcher.
//
// Reads every file in public/data/roads/, walks the graph of shared
// endpoints, and greedily concatenates polylines whose incoming and
// outgoing directions at a junction differ by ≤ TURN_THRESHOLD_DEG.
// Produces one continuous polyline per physical "street," even where
// many OSM ways meet at a 4-way intersection.
//
// Output: public/data/roads-stitched/<city>.json (sidecar; raw data
// stays intact in public/data/roads/).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IN_DIR = path.join(ROOT, 'public/data/roads');
const OUT_DIR = path.join(ROOT, 'public/data/roads-stitched');

const TURN_THRESHOLD_DEG = 30;
const TURN_COS_MIN = Math.cos((TURN_THRESHOLD_DEG * Math.PI) / 180);

// Quantize lng/lat to ~1 cm to collapse float noise at shared nodes.
const QUANT = 1e7;
const keyOf = (pt) => `${Math.round(pt[0] * QUANT)},${Math.round(pt[1] * QUANT)}`;

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}
function norm([x, y]) {
  const L = Math.hypot(x, y);
  return L === 0 ? [0, 0] : [x / L, y / L];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1];
}

function buildGraph(ways) {
  // node key -> [{ wayIdx, end: 0 = start | 1 = end }]
  const g = new Map();
  ways.forEach((w, i) => {
    if (!w || w.length < 2) return;
    const a = keyOf(w[0]);
    const b = keyOf(w[w.length - 1]);
    if (!g.has(a)) g.set(a, []);
    if (!g.has(b)) g.set(b, []);
    g.get(a).push({ wayIdx: i, end: 0 });
    g.get(b).push({ wayIdx: i, end: 1 });
  });
  return g;
}

// Walk forward from the tail of `chain`, consuming ways whose outgoing
// direction at the shared node continues the chain's heading within the
// turn threshold. Mutates `chain` and `used`.
function extend(chain, graph, used, ways) {
  // Hard safety net — in a pathological loop this prevents runaway.
  const MAX_STEPS = 50000;
  for (let step = 0; step < MAX_STEPS; step++) {
    const last = chain[chain.length - 1];
    const prev = chain[chain.length - 2];
    const inDir = norm(sub(last, prev));

    const nodeKey = keyOf(last);
    const candidates = graph.get(nodeKey);
    if (!candidates) return;

    let bestIdx = -1;
    let bestEnd = -1;
    let bestCos = TURN_COS_MIN;

    for (const { wayIdx, end } of candidates) {
      if (used[wayIdx]) continue;
      const w = ways[wayIdx];
      const nextPt = end === 0 ? w[1] : w[w.length - 2];
      if (!nextPt) continue;
      const outDir = norm(sub(nextPt, last));
      // cos(turn angle) between inDir and outDir; we want straight
      // continuation, i.e. cos near +1.
      const c = dot(inDir, outDir);
      if (c > bestCos) {
        bestCos = c;
        bestIdx = wayIdx;
        bestEnd = end;
      }
    }

    if (bestIdx === -1) return;

    used[bestIdx] = true;
    const w = ways[bestIdx];
    // Shared node is already `last` in chain; append the rest.
    if (bestEnd === 0) {
      for (let i = 1; i < w.length; i++) chain.push(w[i]);
    } else {
      for (let i = w.length - 2; i >= 0; i--) chain.push(w[i]);
    }
  }
}

function stitch(ways) {
  const graph = buildGraph(ways);
  const used = new Array(ways.length).fill(false);
  const out = [];

  for (let i = 0; i < ways.length; i++) {
    if (used[i]) continue;
    const w = ways[i];
    if (!w || w.length < 2) continue;
    used[i] = true;

    const chain = w.slice();
    extend(chain, graph, used, ways);
    chain.reverse();
    extend(chain, graph, used, ways);

    out.push(chain);
  }
  return out;
}

function countPts(ways) {
  let n = 0;
  for (const w of ways) n += w.length;
  return n;
}

function main() {
  if (!fs.existsSync(IN_DIR)) {
    console.error(`Input dir not found: ${IN_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = fs.readdirSync(IN_DIR).filter((f) => f.endsWith('.json'));
  console.log(`Stitching ${files.length} cities (turn threshold = ${TURN_THRESHOLD_DEG}°)\n`);

  for (const f of files) {
    const inPath = path.join(IN_DIR, f);
    const outPath = path.join(OUT_DIR, f);
    const ways = JSON.parse(fs.readFileSync(inPath, 'utf-8'));
    const stitched = stitch(ways);
    fs.writeFileSync(outPath, JSON.stringify(stitched));
    const beforeN = ways.length;
    const afterN = stitched.length;
    const reduce = (((beforeN - afterN) / beforeN) * 100).toFixed(0);
    console.log(
      `  ${f.padEnd(20)} ${String(beforeN).padStart(5)} → ${String(afterN).padStart(5)} polylines  (-${reduce}%)  ${countPts(ways)} → ${countPts(stitched)} pts`
    );
  }
  console.log(`\nWrote to ${OUT_DIR}`);
}

main();
