# city-scale v2 · 离线数据管线

v2 的城市边界、指标和前端数据都在这里离线算好。前端只负责读取产物，不做任何几何计算。

## 生产数据（P3 起）

```bash
uv sync
uv run python -I -m citydef.export       # 全部条目 → ../web/public/data/（跳过已完成的；--force 全部重做；也可只列条目 id）
uv run python -I -m citydef.p3_summary   # 汇总 → out/p3/metrics_all.csv
```

- 条目登记表是 [`references/entries.csv`](references/entries.csv)，共 78 个条目，包含显示名、区域和锚点。增删城市直接改这个 CSV。`citydef.entries` 只在需要按 P1b 规则重新生成时运行。
- 导出会按需下载 GHSL 瓦片（GHS-BUILT-S / GHS-POP 2020，100 m），并用 DuckDB 查询 Overture 道路（`2026-10-21.0`）。两者都缓存在 `data/raw/`。
- 数据格式和指标定义见 [`../docs/p3-all-entries-metrics.md`](../docs/p3-all-entries-metrics.md)。

## 研究记录

- P1：城市口径对比，见 [`../docs/p1-city-definition.md`](../docs/p1-city-definition.md)。
- P1b：口径 A 在旧版全部 79 城上的异常检查，见 [`../docs/p1b-a-all-cities.md`](../docs/p1b-a-all-cities.md)。
- P2：渲染原型，见 [`../docs/p2-rendering-prototype.md`](../docs/p2-rendering-prototype.md)。

```bash
uv run python -I -m citydef.fetch   # P1 用的瓦片、UCDB、geoBoundaries（~1.2 GB，幂等）
uv run python -I -m citydef.p1      # 写出 out/p1/
uv run python -I -m citydef.p1b     # 写出 out/p1b/
```

## 模块

| 模块 | 作用 |
|---|---|
| `entries.py` | 条目登记表：读取 `entries.csv`；以及从旧版中心点生成登记表（一次性） |
| `export.py` | 每个条目：口径 A 边界、覆盖率 PNG、道路二进制（主干路 + 8 km 支路分块）、指标（含 GHS-BUILT-V 体量）与径向剖面、manifest、record；最后汇总成 `cities.json`。`--no-roads` 只重算栅格和建筑指标 |
| `buildings.py` | Overture 建筑轮廓抽样（9 个 2 × 2 km 窗口）：建筑尺度、建筑群尺度、与 GHSL 的差异比、中心 1.5 km 图底 PNG |
| `p3_summary.py` | 汇总全部 record，生成指标表和头条数字 |
| `config.py` | P1 的中心点、窗口和各口径参数 |
| `fetch.py` | GHSL 瓦片、UCDB、geoBoundaries 下载 |
| `grid.py` | 局部 LAEA 100 m 网格；`warp_tiles` 把 GHSL 瓦片重投影到任意网格 |
| `definitions.py` | 口径 A / A* / A+ / B / C / C+ |
| `metrics.py` | P1 的面积、人口、密度、覆盖率、紧凑度、径向剖面 |
| `plots.py` | P1 / P1b 的图 |
| `p1.py`、`p1b.py` | P1、P1b 研究脚本 |

下载的原始数据在 `data/raw/<数据集>/`（已 gitignore），只按路径读取，不在其中执行任何东西。
