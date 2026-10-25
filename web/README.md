# city-scale v2 · web（P2 渲染原型）

这是一个 deck.gl 前端，只负责读取 `pipeline` 导出的数据并渲染。每个条目的坐标都已经是以该城传统中心为原点的等积方位投影（单位：米），所以浏览器端不做投影：等比例由数据本身保证，叠加只是平移。

```bash
pnpm install
node_modules/.bin/vite --port 5174           # 需要先运行 pipeline: uv run python -I -m citydef.export
node scripts/bench.mjs http://localhost:5174/ bench-out   # 帧时基准（系统 Chrome，无头模式，真实 GPU）
```

| 文件 | 作用 |
|---|---|
| `src/data.ts` | 与 `pipeline/src/citydef/export.py` 约定的数据格式：索引 `cities.json`、按条目的 `manifest.json`；二进制道路文件零拷贝解码 |
| `src/palette.ts` | 8 色分类调色板；每座已选城市一个稳定色位（地图、标题、图表共用）；区域分组 |
| `src/layers.ts` | 两种样式（叠加 ≤3 城、并排统一样式）；道路分级；随缩放调整道路与覆盖率的显示 |
| `src/MetricsPanel.tsx` | 指标面板：规模 / 强度 / 形态三组条形对比（面积、人口、人口密度、建筑覆盖率、体量密度、平均高度、建筑尺度、建筑群尺度），城市中心 1.5 km 图底，径向剖面（人口密度 / 覆盖率 / 体量，悬停读数） |
| `src/App.tsx` | 城市浏览（搜索、区域分组、≤8 城）、模式切换、拖动、同步缩放、按视野加载支路分块、HUD、测试钩子 `window.__p2` |
| `scripts/bench.mjs` | 6 个场景的帧时测试，并保存截图 |
| `scripts/shots.mjs`、`scripts/shots_p4.mjs` | P3 / P4 报告截图 |

结论与实测数据见 [`../docs/p2-rendering-prototype.md`](../docs/p2-rendering-prototype.md)（渲染）、[`../docs/p3-all-entries-metrics.md`](../docs/p3-all-entries-metrics.md)（全部条目与指标）和 [`../docs/p4-building-form-metrics.md`](../docs/p4-building-form-metrics.md)（建筑形态指标）。
