# CLAUDE.md

Guidance for Claude Code in this repository (v2; v1 lives at tag `v1-final`).

## What this is

Equal-scale comparison of world cities' urban centres: size, density, distribution, form. An offline Python pipeline (`pipeline/`) produces everything the viewer needs; the viewer (`web/`) only draws it. The design history and every measured decision are in `docs/` (P1–P4) — read the relevant report before changing a definition or a metric.

## Core decisions (don't undo without reading docs/)

- **City = definition A**: the GHSL urban centre (GHS-UCDB R2024A, 2020 epoch) containing the entry's anchor. No tuned thresholds, no bisector splits. Conurbations stay merged (PRD = one entry); see `docs/p1-city-definition.md`, `docs/p1b-a-all-cities.md`.
- **One frame per entry**: LAEA centred on the anchor (traditional centre), metres. Every exported coordinate is in that frame; the viewer never projects. Overlay = translate.
- **Registry** `pipeline/references/entries.csv` is the source of truth (ids, names "主名 + 含 X、Y", anchors).
- **Road metrics are not comparable across countries** (OSM residential streets under-mapped/tagged differently in China etc.; `docs/p3-all-entries-metrics.md`). Roads are drawn, never ranked. Form metrics come from buildings (`docs/p4-building-form-metrics.md`).
- **Overture buildings are sampled** (9 windows of 2 × 2 km per entry, seeded per id); city-wide queries cost hours.

## Commands

```bash
# pipeline (from pipeline/)
uv sync
uv run python -I -m citydef.export [ids...] [--force] [--no-roads]   # → ../web/public/data/
uv run python -I -m citydef.p3_summary                              # → out/p3/metrics_all.csv
# web (from web/)
pnpm install && pnpm dev            # http://localhost:5174/city-scale-comparison/
pnpm typecheck && pnpm build
node scripts/bench.mjs              # frame-time benchmark (system Chrome, headless, real GPU)
```

## Gotchas

- `vite.config.ts` sets `base: "/city-scale-comparison/"`; the dev URL includes it. Production data comes from the sibling data repo's Pages site (`web/.env.production` → `VITE_DATA_BASE_URL`); dev reads `web/public/data/`.
- DuckDB ≥ 2.0 needs `SET geometry_always_xy = true` for lon/lat spatial functions; DuckDB returns WKB as `bytearray` (wrap in `bytes()` for shapely).
- pandas: `df.plot` and `df.flags` are DataFrame attributes — use `df["plot"]`, `df["flags"]` for columns with those names.
- The desktop app's hidden preview pane throttles `requestAnimationFrame`: never trust in-pane frame timings; use `web/scripts/bench.mjs`.
- Binary road files: `uint32 header_len | JSON header | float32 xy | uint32 path starts`, 4-byte aligned → zero-copy TypedArray views (`web/src/data.ts`, `pipeline/src/citydef/export.py::encode`).
- Raw inputs (`pipeline/data/raw/`, ~10 GB) and exports (`web/public/data/`) are gitignored; they can be symlinks.
