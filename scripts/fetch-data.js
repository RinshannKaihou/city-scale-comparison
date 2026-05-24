#!/usr/bin/env node
// scripts/fetch-data.js — populate public/data/roads-stitched/ from the data sibling repo.
//
// The runtime app fetches per-city road JSONs from a configurable URL
// (VITE_ROADS_BASE_URL, defaults to the data repo's GitHub Pages site).
// This script downloads them into the local public/data/ directory so
// developers can work fully offline — useful on planes or for hammering
// the app without paying GitHub Pages bandwidth.
//
// Usage:
//   pnpm fetch-data                # fetch all 79 cities
//   pnpm fetch-data --concurrency 16   # tune parallel fetches
//
// Files are skipped if they already exist and are non-empty. Delete a
// file to force re-fetch.

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CITIES_JSON = resolve(REPO_ROOT, 'public/data/cities.json');
const OUT_DIR = resolve(REPO_ROOT, 'public/data/roads-stitched');
const DEFAULT_BASE = 'https://rinshannkaihou.github.io/city-scale-comparison-data/';

const args = process.argv.slice(2);
const concurrencyArgIdx = args.indexOf('--concurrency');
const CONCURRENCY = concurrencyArgIdx >= 0 ? Number(args[concurrencyArgIdx + 1]) : 8;
const BASE_URL = process.env.VITE_ROADS_BASE_URL ?? DEFAULT_BASE;

async function existsNonEmpty(path) {
  try {
    const s = await stat(path);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function fetchCity(city) {
  const out = resolve(OUT_DIR, `${city.id}.json`);
  if (await existsNonEmpty(out)) return { id: city.id, skipped: true };

  const url = `${BASE_URL}${city.id}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${city.id}: HTTP ${res.status} from ${url}`);
  const body = await res.text();
  await writeFile(out, body);
  return { id: city.id, bytes: body.length };
}

async function pool(tasks, n) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      try {
        const r = await tasks[idx]();
        results[idx] = { ok: true, ...r };
      } catch (err) {
        results[idx] = { ok: false, error: err.message };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log(`Fetching from: ${BASE_URL}`);
  console.log(`Concurrency:   ${CONCURRENCY}`);
  await mkdir(OUT_DIR, { recursive: true });

  const cities = JSON.parse(await readFile(CITIES_JSON, 'utf8'));
  console.log(`Cities:        ${cities.length}\n`);

  const tasks = cities.map((c) => () => fetchCity(c));
  const t0 = Date.now();
  const results = await pool(tasks, CONCURRENCY);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const skipped = results.filter((r) => r.ok && r.skipped).length;
  const fetched = results.filter((r) => r.ok && !r.skipped);
  const failed = results.filter((r) => !r.ok);
  const totalBytes = fetched.reduce((s, r) => s + (r.bytes ?? 0), 0);

  console.log(`Skipped:  ${skipped}`);
  console.log(`Fetched:  ${fetched.length}  (${(totalBytes / 1024 / 1024).toFixed(1)} MB in ${elapsed}s)`);
  if (failed.length > 0) {
    console.log(`Failed:   ${failed.length}`);
    for (const f of failed) console.log(`  - ${f.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
