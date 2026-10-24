[English](README.en.md) | 中文

# RoamCity · 漫游城事

**开源、AI 原生、本地优先的旅行操作系统。**

把一句话的旅行愿望，变成一份每天走得通、途中随时能改的真实行程。
不编造地点，不伪造价格，也不替你按下确认键。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-61dafb)](https://react.dev)

<img src="docs/assets/screenshots/home.png" alt="RoamCity 首页：一句话开始规划" width="880" />

## 核心特性

- **无需注册** — 打开即用；登录只用于可选的跨设备同步。
- **Local-first** — 行程、提案与知识库保存在你自己的 `.voyage/` 目录，不经过 RoamCity 服务器。
- **Bring your own keys** — 高德、LLM、社交数据全部自带 Key；什么都不配也能用 Demo 模式完整走一遍。
- **真实 POI、路线与天气** — 坐标、路网、天气来自真实 Provider；估算值始终标注，未知就是未知。
- **攻略变行程** — 粘贴小红书 / 抖音链接或攻略原文，地点逐个核验后按原文顺序进入行程。
- **AI 排程** — 按地理聚类、时间窗、天气与你的节奏/步行偏好重排每天，并解释每一次调整的理由。
- **Today 执行模式** — 旅途中一屏回答：下一站、怎么去、几点出发、还剩多少路、预计几点结束。
- **只提案，确认才生效** — 所有修改先生成量化 Diff 和一次性 `proposalToken`，你确认后才写回。
- **Web + MCP + Skill** — 同一套 Runtime 驱动 Web Agent、MCP server（Claude Desktop / Cursor）以及外部 Skill 包。

## 界面预览

以下截图来自当前版本（2026-10-23）。

### 1. 首页 · 一句话说出你的旅行

不用注册，在输入框里写明目的地、日期、人数和偏好，直接进入规划。

<img src="docs/assets/screenshots/home.png" alt="RoamCity 首页：一句话输入旅行需求" width="880" />

### 2. 新建旅行 · 边聊边形成旅行画像

左侧对话追问还缺的信息，右侧画像面板同步更新；确认后才生成真实路线与预算。

<img src="docs/assets/screenshots/new-trip.png" alt="新建旅行：对话式规划与实时旅行画像" width="880" />

### 3. 我的旅行 · 所有行程项目一处管理

按「全部 / 即将出发 / 旅途中 / 已完成」筛选，支持复制、归档与删除。

<img src="docs/assets/screenshots/trips.png" alt="我的旅行：行程项目列表" width="880" />

### 4. 3D 实景 · 洪崖洞可交互场景

从行程里直接打开目的地的 3D 场景，查看夜景与周边地标，再决定要不要去。

<img src="docs/assets/screenshots/3d-hongyadong.png" alt="洪崖洞 3D 实景场景" width="880" />

### 5. 移动端 · 真机尺寸下的完整流程

底部导航、半屏行程抽屉与 44px 触控命中区都按真机单独处理，不是把桌面版缩小。

<p>
<img src="docs/assets/screenshots/mobile-01.jpg" alt="移动端真机截图 1" width="230" />
<img src="docs/assets/screenshots/mobile-02.jpg" alt="移动端真机截图 2" width="230" />
<img src="docs/assets/screenshots/mobile-03.jpg" alt="移动端真机截图 3" width="230" />
</p>

## 30 秒跑起来

```bash
git clone https://github.com/fhyfrdfd/roamcity.git
cd roamcity
npm install
npm run dev
```

浏览器打开 [http://localhost:3002](http://localhost:3002)。

不配置任何环境变量时，应用会以 **Demo 模式**启动：内置重庆示例行程与矢量底图，规划、Diff 确认、Today 模式都能完整走一遍。

> 需要 Node.js 20+。

## Provider 分级：从零配置开始

不需要配置任何 Key 也能完整体验，按需逐级解锁：

| 级别 | 需要什么 | 解锁什么 |
|---|---|---|
| **Level 0 · Demo** | 什么都不用 | `VOYAGE_DEMO_MODE=true`，内置重庆示例行程 + 矢量底图，完整体验规划 / Diff 确认 / Today 模式 |
| **Level 1 · AMap** | `AMAP_SERVER_KEY`（+ `NEXT_PUBLIC_AMAP_KEY` 真地图） | 真实 POI 搜索、真实路网路线、真实天气 |
| **Level 2 · LLM** | `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | 自然语言规划对话、攻略链接解析、Today Agent 多轮修改建议 |
| **Level 3 · Social / Offers** | `TIKHUB_API_KEY`（社交）、`MEITUAN_HT_TOKEN`（美团）、`FLIGGY_*`（飞猪） | 小红书/抖音攻略抓取、热度信号、机票与本地生活报价 |

任意级别缺失时，RoamCity 会**降级并如实标注**（`providerStatus`: `REAL` / `ESTIMATED` / `CURATED` / `UNAVAILABLE`…），绝不把估算伪装成真实数据。

## 它是怎么工作的

用户输入一句简单愿望：

> “从桂林去重庆玩 3 天，2 个人，预算 2500，喜欢美食和夜景，不想每天走太多路。”

RoamCity 在几秒钟内生成一个**真实的、结构化的、带高德坐标与路网、受天气感知、可持久化、随时可修改的完整旅行项目**。

旅途中只需说：

- “明天太累了” → 减少长距离攀爬，步行自动转打车与轻轨；
- “今天下雨了” → 触发 Rain Plan，露天步道平滑置换为室内三峡博物馆；
- “今天省 100 块” → 打车智能回退为地铁，餐饮结构微调；
- “推迟一小时” → 节点整体顺延，重新校准各段交通。

每一句自然语言指令都会被编译成经过 Zod 校验的结构化 `TravelAction`，生成量化对比报告（`TripChangeSet`）呈现在 Diff 审阅弹窗中，**待你确认后才应用**（一次性 `proposalToken`，10 分钟有效，防重放与篡改）。

## 四大阶段

| 阶段 | 职责定位 | 核心能力 |
|---|---|---|
| **1. Plan** | 行程规划与时间轴生成 | 目的地真实 POI 聚合，按地理就近聚类，自动排布正餐、游览时长与预算分布。 |
| **2. Explore** | 真实探索与商户发现 | 实时高德 POI 检索，支持“室内、夜景、免费、少走路”等精准标签筛选，杜绝伪造评分与空头价格。 |
| **3. Adapt** | 动态适应与差异审阅 | 全局 Command Bar (`Cmd+K`) 随时唤起，修改前量化展示步行减量、交通置换与费用差值，支持 10 步随时 Undo。 |
| **4. Travel** | 现场执行控制台 (Today) | 移动端优先单手操作：实时锁定下一站目标、出发与到达倒计时、直连高德 App 真实导航。 |

## 技术架构

```
UI Components (Next.js 15 App Router · React 19 · Tailwind v4 · Radix UI · Motion · dnd-kit)
      ↓
State & Control Layer (Zustand: useTripStore · useUiStore · useHistoryStore · CommandBar)
      ↓
AI Action & Diff Engine (TravelAction 3.0 · ActionPlanner · ActionExecutor · TripDiffModal)
      ↓
Travel Intelligence (Route Matrix · Transport Scoring · RAG Planning Context)
      ↓
Knowledge Engine (Hybrid Keyword + pgvector · Freshness · Confidence · Provenance)
      ↓
Service Facades & Routing Engine (RoutingService · WeatherContext · BookingIntent)
      ↓
Server Boundary (API Routes with 'server-only' secrets isolation)
  ├── AMap REST (POI Search, Geocoding, Walking/Driving/Transit Directions, Polylines)
  ├── OpenAI-compatible LLM (Chat Completions: Qwen, DeepSeek, GPT-4o)
  └── Supabase (Secure RLS bound to auth.uid() + In-Memory Fallback)
```

## 验证与评测

```bash
npm run lint           # ESLint 代码规范检查
npm run typecheck      # TypeScript 严格类型检查
npm test               # Vitest 单元与集成测试（97 个测试文件）
npm run build          # 生产环境 Turbopack 打包编译
npm run test:e2e       # Playwright 端到端验证（42 条，14 个 spec）
npm run test:e2e:smoke # 冒烟子集：3D 场景、对话规划、离线回退、移动端导航、删除 Day、会话恢复
```

```bash
npm run bench            # 确定性行为基准，写 benchmarks/results/latest.json
npm run bench:compare    # 与 baseline 对比，回归时退出码 1
npm run bench:baseline   # 确认无回归后刷新 baseline
npm run eval:profile     # 规划画像抽取评测
npm run eval:nlu         # NLU diff 评测
npm run eval:trust       # 20 条 trust 评测（真实 AMap + LLM），产出 report.md
npm run bench:optimizer  # Itinerary Optimizer 排程评测
```

> `eval:trust` 会调用真实外部服务并产生费用；报告与口径见 `benchmarks/eval/trust/README.md`。

## 环境变量 (`.env.local`)

| 环境变量 | 说明 | 缺省行为 |
|---|---|---|
| `NEXT_PUBLIC_AMAP_KEY` | 高德 JS API Key (Web 客户端) | 未配置时自动降级为 SVG 矢量投影底图 |
| `NEXT_PUBLIC_AMAP_SECURITY_CODE` | 高德 JS API 安全密钥 | 配合 JS Key 使用 |
| `AMAP_SERVER_KEY` | 高德 Web 服务服务端 REST Key | 未配置时走精选真实地点库与 Haversine 估算 |
| `LLM_BASE_URL` | OpenAI 兼容的大模型 API 根地址 (如方舟/DeepSeek) | 未配置时自动切入规则引擎 |
| `LLM_API_KEY` | 服务端模型 API Key | 保护在服务端，绝不向浏览器泄露 |
| `LLM_MODEL` | 模型名称 (如 `deepseek-v3`, `gpt-4o-mini`) | 默认 `gpt-4o-mini` |
| `EMBEDDING_BASE_URL` | OpenAI-compatible Embeddings API 根地址 | 未配置时 RAG 自动降级为关键词/本地知识检索 |
| `EMBEDDING_API_KEY` | Embedding API Key | 仅服务端使用 |
| `EMBEDDING_MODEL` | 1536 维 Embedding 模型 | 未配置时不执行语义向量检索 |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目地址 | 未配置时自动无感运行在内存 Demo 模式 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 客户端匿名密钥 | 严格受 `0002_rls_secure.sql` 行级安全控制 |
| `TIKHUB_API_KEY` | TikHub 社交检索（小红书 / 抖音 / 微博 / 微信搜一搜） | 未配置时社交证据如实显示为不可用 |
| `VOYAGE_GUEST_TTL_DAYS` | 访客工作区过期天数 | 默认 `30`，设为 `0` 关闭自动清理 |

## 功能亮点

- **Agent 主动牵引 + 工具调用可见**：Today 页根据行程事实（未来下雨、空白天、超预算、步行过长、未查报价、行前待办）主动给出可点击的下一步建议；Agent 回答时自动调用真实工具（高德 POI / 路线 / 天气 / 社交证据 / 报价），调用轨迹以徽标展示在回复卡中。LLM 只能生成提案，应用必须由你在 Diff 中确认。
- **Itinerary Optimizer v1**：按经纬度地理聚类、日内最近邻链、时间窗（夜景/观景排晚间、餐饮锚定正餐）、用户画像（节奏、步行耐受、老人/儿童）与雨天室内优先做整体重排，并输出 `decisions[]` 解释每一次调整；无法排程的事实如实记入 `unresolvedConstraints`。
- **多轮追问**：Today 页的 AI 调整带最近 8 轮上下文——“再少一点”“换成下午”这类追问可以直接说。
- **攻略一键导入（小红书 / 抖音 / 微信）**：在规划对话框直接粘贴链接（短链也行），自动抓取正文、由高德逐个核实地点、按原文顺序排进每天并画到地图上，同时生成打卡清单。
- **单日聚焦**：看哪一天就只显示哪一天的列表与路线，「全部」一键切回全程视图。
- **移动端完整导航**：底部导航「行程 / 今天 / 地图 / 更多」，分享按钮手机可见；非行程页（我的旅行 / 设置）有全局底栏。
- **规划会话可恢复**：会话 ID 持久化在本机、对话保存在服务端；回到规划页可「继续上次规划」，失效会话如实提示并清理。
- **运维加固**：付费接口（高德 / TikHub / LLM / 飞猪 / 规划）按调用方滑动窗口限流，超限返回 429 + Retry-After；服务端结构化 JSON 日志覆盖降级与失败路径；访客工作区按 TTL 自动清理。

## 文档索引

- [`docs/CURRENT_ARCHITECTURE.md`](docs/CURRENT_ARCHITECTURE.md) — 当前架构与模块边界
- [`docs/GOLDEN_TRIP.md`](docs/GOLDEN_TRIP.md) — 桂林 ↔ 重庆 3 天 2 夜 黄金验收基准
- [`docs/REAL_WORLD_PROVIDER_GUIDE.md`](docs/REAL_WORLD_PROVIDER_GUIDE.md) — 高德 / 天气 / 预订 / Supabase 接入指南
- [`docs/TRAVEL_ACTIONS.md`](docs/TRAVEL_ACTIONS.md) — TravelAction 规格与 Diff 预览说明
- [`docs/RUNTIME_COMMAND_EXPOSURE.md`](docs/RUNTIME_COMMAND_EXPOSURE.md) — Web / MCP / Skill 命令暴露矩阵
- [`docs/PROJECT_INNOVATION.md`](docs/PROJECT_INNOVATION.md) — 项目创新点与差异化
- [`packages/voyage-mcp/README.md`](packages/voyage-mcp/README.md) — MCP server 使用说明
- [`knowledge/README.md`](knowledge/README.md) — Travel Knowledge RAG 数据格式、入库与检索

## 联系作者

使用中遇到问题、想提建议，或者想聊聊这个项目，欢迎在 GitHub Issues 里留言。

## 开源协议

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

本项目基于 [MIT License](LICENSE) 开源。
