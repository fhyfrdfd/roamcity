# 性能画像（PERF-001）

> 2026-10-21 · WSL2 / Node v22.21.0 / Next.js 15.5.24（Turbopack）。数据来自本机实测，不是云环境基准。

## 1. 生产构建体积

命令：`npm run build`

| 路由 | Route 体积 | First Load JS |
|---|---|---|
| 共享 chunk | — | **150 kB** |
| `/new-trip` | 26.5 kB | 214 kB |
| `/settings` | 22.5 kB | 203 kB |
| `/share/[token]` | 41.2 kB | 213 kB |
| `/trip/[id]` | 28.7 kB | **302 kB** |
| `/trip/[id]/explore` | 17.4 kB | 250 kB |
| `/trip/[id]/today` | 23.5 kB | 256 kB |
| `/trip/[id]/transport` | 10.8 kB | 243 kB |
| `/trip/[id]/offers` | 7.3 kB | 239 kB |
| `/trips` | 23.2 kB | 213 kB |

观察：
- `/trip/[id]` 首屏 302 kB，是最大的客户端路由；主要成本是行程面板 + 地图画布 + Diff 弹窗。
- 共享 chunk 150 kB 中，单个最大 chunk 59.2 kB、17.7 kB、13.5 kB、10.9 kB；CSS 15.3 kB。
- 所有 API 路由为动态（`ƒ`），无额外客户端 JS。

## 2. 生产启动与路由时延

命令：`npx next start -p 3006` + `curl -w time_total`。

| 指标 | 实测 |
|---|---|
| Next 启动到 Ready | **972 ms** |
| 首页首次请求（静态） | 5.4 ms |
| 首页热请求 | 4.0 ms |
| `/api/voyage/capabilities` | 28.9 ms |
| `/trip/chongqing-2026` 页面壳 | 297 ms |

说明：`/trip/[id]` 的 297 ms 是服务端页面壳 + 客户端数据加载前的响应，不含浏览器执行和 AMap JS 渲染。本次环境未配置 `NEXT_PUBLIC_AMAP_KEY`，地图走 SVG 备用视图。

## 3. LLM / 生成时延

来自 `benchmarks/eval/trust/report.json`（20 条真实任务，DeepSeek `deepseek-chat`，2026-10-21）：

| 指标 | Voyage 新管线 | 纯 LLM 基线 |
|---|---|---|
| 生成 p50 | 5327 ms | 2435 ms |
| 生成 p95 | 7120 ms | 3244 ms |
| 平均最大交通 | 57 min | 135 min |
| 事实准确率 | 100% | 76.3% |

管线的额外时延来自真实 AMap POI/路线检索与校验；这些是事实准确率的成本，不是浪费。LLM 时延受网络与供应商影响，重跑会波动。

## 4. 主要瓶颈与建议

1. **`/trip/[id]` 302 kB**：把 `XhsGuidePanel`、`OfferHub`、`UrbanTransportIntelligence` 等非首屏面板改为 `next/dynamic` 懒加载；Diff 弹窗按需加载。
2. **地图**：真实 AMap JS 未在本环境加载；上线前需在目标环境复测地图脚本对首屏的影响，并确保失败时快速回退到 SVG。
3. **LLM P95**：当前 7.1 s 主要由供应商决定；可在 UI 继续使用后台生成 + 轮询（已实现），避免请求超时。
4. **冷启动**：972 ms 可接受；多实例部署后冷启动被摊薄，但生成任务需队列化（见 `DEPLOY_MULTI_INSTANCE.md`）。

## 5. 复现命令

```bash
npm run build
npx next start -p 3006
curl -s -o /dev/null -w "%{time_total}\n" http://localhost:3006/
curl -s -o /dev/null -w "%{time_total}\n" http://localhost:3006/trip/chongqing-2026
npm run eval:trust   # 生成 LLM 时延与质量报告
```
