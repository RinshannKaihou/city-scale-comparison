# Data hosting

Per-city road JSONs are hosted out-of-repo so the main repo stays small (~20 MB instead of ~820 MB pre-2026-05). This doc covers where the data lives, how to add or update cities, and how to swap to a different CDN.

## Where the data lives

| What | Where | Size |
|---|---|---|
| `cities.json` (metadata + boundary geometry, all 79 cities) | bundled in this repo at `public/data/cities.json` | 1.4 MB |
| Per-city road JSONs (`<id>.json`) | sibling repo [`city-scale-comparison-data`](https://github.com/RinshannKaihou/city-scale-comparison-data), served via GitHub Pages | ~251 MB total |
| Immutable versioned snapshot | GitHub Release [`data-v1`](https://github.com/RinshannKaihou/city-scale-comparison/releases/tag/data-v1) on this repo (download only, not used at runtime — release URLs lack CORS) | ~251 MB |

The runtime fetch URL is built from `VITE_ROADS_BASE_URL` (set in `.env`):

```
VITE_ROADS_BASE_URL=https://rinshannkaihou.github.io/city-scale-comparison-data/
# fetches: <base><city.id>.json
```

## Why GitHub Pages on a sibling repo

Three approaches were considered:

| Option | Outcome |
|---|---|
| GitHub Release assets in main repo | **Failed**: Azure Blob origin lacks `Access-Control-Allow-Origin`; browser `fetch()` blocked. |
| jsDelivr CDN mirror of sibling repo | **Failed**: 20 MB per-file limit, Tokyo (27 MB) rejected. |
| **GitHub Pages on sibling repo** ✓ | CORS `*`, no per-file size limit, free, served from GitHub's CDN. |

R2 / Cloudflare is the longer-term option if Pages becomes a bottleneck. See "Switching CDNs" below.

## Adding or updating a city

1. Add a seed to `scripts/extract-urban-areas.js` (see [`CLAUDE.md` § Adding a city](../CLAUDE.md)) and run the pipeline locally — outputs `public/data/cities.json` and `public/data/roads-stitched/<id>.json`.
2. Push the updated `cities.json` to **this** repo (it ships in the bundle).
3. Push the new stitched files to the **data repo**:
   ```bash
   cd /path/to/city-scale-comparison-data
   cp /path/to/city-scale-compare/public/data/roads-stitched/<id>.json .
   git add <id>.json && git commit -m "Add <name>"
   git push origin main
   ```
4. GitHub Pages on the data repo rebuilds in ~60 seconds. The new city is then live without redeploying the main app.

### Cutting a new versioned snapshot

For citations or stable references, tag the data repo:

```bash
cd /path/to/city-scale-comparison-data
git tag data-v2
git push origin data-v2
```

Pin the app to a specific snapshot by switching `.env` to:

```
VITE_ROADS_BASE_URL=https://cdn.jsdelivr.net/gh/RinshannKaihou/city-scale-comparison-data@data-v2/
```

(jsDelivr can pin by tag; Pages always serves the latest `main`. The 20 MB jsDelivr limit applies — pin only if all your cities are under 20 MB.)

## Offline / local-only development

For environments without internet (planes, demos), populate the local `public/data/roads-stitched/` directory:

```bash
pnpm fetch-data           # parallel-downloads all 79 files, ~30 sec on broadband
```

Then override the env var locally to fetch from your filesystem:

```bash
echo "VITE_ROADS_BASE_URL=/city-scale-comparison/data/roads-stitched/" > .env.local
```

`.env.local` is gitignored. Vite reads it after `.env` so the override is local-only.

## Switching CDNs (e.g. Cloudflare R2)

If GitHub Pages becomes a bottleneck (rate limits, latency in some regions):

1. Sign up for Cloudflare R2 (free tier: 10 GB egress / month).
2. Create a public bucket, configure CORS (`Access-Control-Allow-Origin: *`).
3. Upload all `<id>.json` files from the data repo via `aws s3 sync` (R2 is S3-compatible).
4. Update `.env`:
   ```
   VITE_ROADS_BASE_URL=https://roads.your-domain.com/
   ```
5. Redeploy via `pnpm run deploy`.

No app code changes — the fetch URL is the only thing that moves.

## Recovery — pre-rewrite backup

A safety tag `pre-filter-repo-backup` was pushed to `origin` before the 2026-05 history rewrite. To restore the bloated history if something goes catastrophically wrong:

```bash
git fetch origin pre-filter-repo-backup
git reset --hard pre-filter-repo-backup
git push --force origin main
```

The tag can be safely deleted after ~30 days of stable operation:

```bash
git push --delete origin pre-filter-repo-backup
```
