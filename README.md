# City Scale Compare · 城市尺度对比（v2）

把世界各城市的城市中心放在**同一比例尺**下叠加、并排比较：比较大小、密度、空间分布和形态。

在线：https://rinshannkaihou.github.io/city-scale-comparison/

v1（Natural Earth 2002 年轮廓 + Canvas 2D）保留在 git 标签 `v1-final`。v2 从头重写，原因和过程见 [`docs/`](docs/)。

## 和 v1 的区别

| | v1 | v2 |
|---|---|---|
| 城市边界 | Natural Earth 2002–03 MODIS 1 km 轮廓，再靠调参切分 | **GHSL 城市中心 2020**（Degree of Urbanisation：≥1,500 人/km² 的连片 1 km 网格，联合国统计委员会 2020 年采纳） |
| 条目 | 79 城，部分靠影子种子切开连绵区 | 78 个条目，连绵区按数据合并（如"珠三角"），显示名为"主名 + 含 X、Y" |
| 坐标 | 浏览器端等距矩形投影 | 每个条目使用以其传统中心为原点的等积方位投影（米）。等比例由数据本身保证，叠加只是平移 |
| 渲染 | Canvas 2D，每帧重画 | deck.gl（WebGL），二进制数据；支路按 8 km 分块按需加载 |
| 比较方式 | 中心重叠 + 拖动 | 叠加（≤3 城，可拖动）和并排小图（≤8 城，同步缩放） |
| 指标 | 面积 | 面积、人口、人口密度、建筑覆盖率、体量密度、平均建筑高度、建筑尺度、建筑群尺度、径向剖面、城市中心图底 |

## 结构

```
pipeline/   离线数据管线（Python, uv）：口径、指标、导出 → web/public/data/
web/        前端（Vite + React + TypeScript + deck.gl）
docs/       研究与设计记录：P1 口径 → P1b 全城检验 → P2 渲染 → P3 全部条目 → P4 建筑形态
```

## 运行

```bash
# 数据（需下载约 10 GB 原始数据；有缓存，可重跑）
cd pipeline
uv sync
uv run python -I -m citydef.export          # 全部条目 → ../web/public/data/
uv run python -I -m citydef.p3_summary      # 指标汇总 → out/p3/metrics_all.csv

# 前端
cd ../web
pnpm install
pnpm dev                                    # http://localhost:5174/city-scale-comparison/
```

条目登记表在 [`pipeline/references/entries.csv`](pipeline/references/entries.csv)，增删城市改这个文件后重跑导出即可。

## 数据托管

导出的数据约 270 MB、约 3,500 个文件，不放在本仓库。它们发布在姊妹仓库 [`city-scale-comparison-data`](https://github.com/RinshannKaihou/city-scale-comparison-data) 的 GitHub Pages 上，前端通过 [`web/.env.production`](web/.env.production) 指向那里。开发时则直接读取 `web/public/data/`。

## 数据来源与许可

- 城市中心、人口、建筑覆盖率与体量：GHSL（European Commission JRC）—— GHS-UCDB R2024A，GHS-POP、GHS-BUILT-S、GHS-BUILT-V R2023A。
- 道路、建筑轮廓：Overture Maps（`2026-10-21.0`），包含 © OpenStreetMap 贡献者的数据（ODbL）。
