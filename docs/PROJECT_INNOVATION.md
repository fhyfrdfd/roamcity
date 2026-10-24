# Voyage 可信旅行决策系统 —— 项目创新与重构规格

> 面向 Codex / 开发者的执行文档  
> 底座：Voyage（MIT）  
> 目标：把“AI 行程生成器”升级为“**可验证、可重规划、可解释**的旅行决策系统”

---

## 0. 一句话定位

Voyage 不再只是“输入需求、生成一段行程”，而是：

> **每一条行程都可验证、每个推荐都有证据、每个变化都可追溯、每次重规划都可回滚。**

这句话是项目的创新点，也是答辩时唯一需要讲清楚的主线。

---

## 1. 当前底座与现状

### 1.1 底座

- 仓库：Voyage（Next.js 15 + React 19 + TypeScript + Zustand + Zod）
- 许可：MIT
- 已跑通：
  - 对话式需求收集（`src/services/planning/conversation-planner.ts`）
  - LLM 行程大纲（`src/services/planning/outline-planner.ts`）
  - 高德 POI / 路线 / 天气（`src/skill/providers.ts`、`src/services/map/amap-rest.ts`）
  - 逐日工作台、Today 模式、Diff/Undo
  - 小红书/抖音攻略导入（可选）
  - 预算、天气 Rain Plan、地图
- LLM：OpenAI 兼容接口，当前使用阿里云 DashScope `qwen-plus`
- 地图：高德 Web 服务 key + JS API key

### 1.2 当前真实问题（必须保留为改动依据）

1. **候选地点不足**：真实生成中，第二天只排了 1 个地点且重复 2 次。
2. **没有硬约束**：没有拦“重复地点、缺正餐、营业时间冲突、移动过远、体力超限”。
3. **没有证据卡**：用户看不到“为什么选它”、数据来源、抓取时间、真实/估算。
4. **没有重规划**：闭馆、下雨、太累时，系统不会给出替代方案。
5. **没有评测**：无法证明“加了这些层比纯 LLM 更好”。

### 1.3 已经做过的本地修复（不要回退）

- `conversation-planner.ts`：补全 `pace/walkingTolerance/transportPreference/budgetMode` 枚举值，并加入当前日期，避免年份误判。
- `outline-planner.ts`：写死 `placeId/startTime/durationMinutes` 字段与 `HH:mm` 格式。
- `.env.local`：本地密钥文件，已被 `.gitignore` 忽略，**不得提交**。
- `@next/swc-linux-x64-gnu` 在 WSL 下必须完整（约 137MB），否则 `next dev` 会 Bus error。

---

## 2. 创新点：Plan → Verify → Replan → Explain 闭环

```
用户约束
  │
  ▼
[Plan] 候选检索 → 地理重排 → LLM 排程
  │
  ▼
[Verify] 硬规则校验 + 证据卡 + 置信度
  │
  ├─ 通过 → 输出行程 + 证据面板
  │
  └─ 不通过 → [Replan] 生成替代方案 + Diff + 原因
                    │
                    ▼
              [Explain] 数字人/文字解释“为什么改”
```

### 2.1 与开源项目的关系

| 能力 | 参考项目 | 拿什么 | 许可 | 备注 |
|---|---|---|---|---|
| 验证/证据/版本化重规划 | [RoutePilot](https://github.com/tiammomo/RoutePilot) | Research→Planner→Validation→Verifier 契约、证据溯源、TripSnapshot、固定检索测试 | MIT | **只借鉴契约与流程，不引入 Postgres/Redis** |
| 候选召回 + 地理重排 | [shanghai-citywalk](https://github.com/EliasCai/shanghai-citywalk) | 离线摘要→向量召回→距离重排→LLM 选择→叙事 | 无 LICENSE | **只借思路，不复制代码** |
| 3D 数字孪生 / 仿真 | [silver-tourism-digital-twin](https://github.com/Zhangweihui666/silver-tourism-digital-twin) | 语义孪生、3DGS/GLB、500 agent 仿真、干预对比 | MIT | P2；方案 A：预置场景/GLB，独立页面，不深度耦合 |
| 数字人/语音导览 | [Live2d-AI-Guide](https://github.com/QzlabQ/Live2d-AI-Guide)、[Guido](https://github.com/youxiandechilun/Guido) | ASR→RAG→TTS→Live2D、知识缺口运营 | 无 LICENSE | P2，先做静态头像+TTS |
| 运营看板 | [StoryMap](https://github.com/Snake8859/StoryMap)、[Luoyang 可视化](https://github.com/DJH2005/luoyang-tourism-visualization) | WebGIS 决策支持、客流/收入看板 | 无 LICENSE | P2，只借布局与指标 |
| 多智能体/HITL | [Ctrip-Style AI Travel Assistant](https://github.com/Haohao-end/Ctrip-Style-AI-Travel-Assistant) | Hub-and-Spoke、Safe/Sensitive 工具、人工确认 | 无 LICENSE（README 提 MIT 但无 LICENSE 文件） | 仅参考，不做预订 |
| 知识图谱 | [XinjiangTravel](https://github.com/KhanCold/XinjiangTravel)、[Tourism-KG-QA](https://github.com/SaraSaadoun/Tourism-Knowledge-Graph-QA) | 实体关系、GraphRAG | 无 LICENSE | P3，不建议 5 天内做 |

> **原则：MIT 项目可以借鉴代码并保留版权声明；无 LICENSE 项目只借鉴架构和交互，不复制代码。**

---

## 3. 范围

### 3.1 MVP（5 天，比赛最小闭环）

必须完成：

1. 候选检索升级：多类别查询、去重、地理重排、每天至少一顿正餐。
2. 证据卡：每个 stop 显示来源、抓取时间、真实/估算、营业时间、为什么选它。
3. 校验器：至少 6 条硬规则。
4. 重规划：闭馆 / 超时 / 下雨时给替代方案，保留版本与 Diff。
5. 评测：20 条任务，纯 LLM vs 新管线对比。

### 3.2 完整版（1–2 个月）

- 城市知识包 + RAG 溯源
- 适老化/无障碍校验
- 天气/拥挤重规划
- 3D 数字孪生独立页面（方案 A：预置场景/GLB）
- 静态头像 + TTS 语音讲解
- 运营看板

### 3.3 明确不做

- 真实预订/支付（无真实库存）
- AR 导览（设备兼容性风险）
- 完整知识图谱/Neo4j（20 个 POI 用 RAG 足够）
- 微信小程序/多端（H5 足够）
- 自采 3DGS / COLMAP 训练（MVP 阶段一律不做；只使用预置场景或 GLB）
- 第二套 Agent 框架（不要引入 LangGraph/CrewAI）

---

## 4. 目标架构

### 4.1 新增模块

```
src/services/trust/
├── candidates.ts        # 多类别检索、去重、地理重排
├── evidence.ts          # 证据卡构建
├── validator.ts         # 硬规则校验
├── replan.ts            # 重规划提议 + Diff
└── evaluate.ts          # 评测指标

src/services/trust/rules/
├── duplicate-place.ts
├── meal-coverage.ts
├── opening-hours.ts
├── travel-time.ts
├── budget.ts
├── walking-limit.ts
├── accessibility.ts
├── weather-risk.ts
└── index.ts
```

### 4.2 数据流

```
/api/voyage/planning/session/:id/generate
  │
  ├─ candidates.ts   → CandidateSet
  ├─ outline-planner → Outline
  ├─ evidence.ts     → EvidenceCard[]
  ├─ validator.ts    → ValidationReport
  │      │
  │      ├─ passed=false → replan.ts → ReplanProposal
  │      └─ passed=true  → TripSnapshot
  │
  └─ 返回 trip + evidence + validation + replan?
```

### 4.3 与现有代码的关系

- 不要重写 `conversation-planner.ts` / `outline-planner.ts` 的对话与排程逻辑。
- 在 `generate` 流程中插入 `candidates`、`evidence`、`validator`、`replan`。
- 复用 `src/types/travel.ts` 中的 `Trip`、`Place`、`TripItem`。
- 复用 `src/schemas/planning.ts` 中的 profile schema。
- 复用 Voyage 已有的 Diff/Undo 组件做重规划确认。

---

## 5. 数据契约

### 5.1 候选

```ts
export interface CandidateQuery {
  city: string;
  categories: PlaceCategory[]; // attraction | food | cafe | activity | shopping
  vibes: string[];
  maxTravelMinutes: number;
  budget: number;
  walkingTolerance: "low" | "medium" | "high";
  elderly?: boolean;
  accessibility?: boolean;
  limitPerCategory: number;
}

export interface CandidateSet {
  places: Place[];
  byCategory: Record<PlaceCategory, Place[]>;
  deduped: number;
  rejected: Array<{ placeId: string; reason: string }>;
}
```

### 5.2 证据卡

```ts
export interface EvidenceCard {
  placeId: string;
  name: string;
  source: "amap" | "official" | "demo" | "manual";
  sourceId?: string;
  fetchedAt: string;        // ISO
  real: boolean;            // false = 估算/demo
  openingHours?: string;
  price?: number;
  rating?: number;
  address?: string;
  distanceFromPreviousM?: number;
  travelMinutesFromPrevious?: number;
  confidence: number;       // 0–1
  whyChosen: string;        // 一句话，必须来自事实，不得臆造
}
```

### 5.3 校验

```ts
export type Severity = "error" | "warning" | "info";

export interface ValidationIssue {
  code: string;
  severity: Severity;
  dayId?: string;
  itemId?: string;
  placeId?: string;
  message: string;
  suggestion?: string;
  evidence?: EvidenceCard[];
}

export interface ValidationReport {
  score: number;            // 0–100
  passed: boolean;          // 无 error
  issues: ValidationIssue[];
  generatedAt: string;
}
```

### 5.4 重规划

```ts
export type ReplanReason =
  | "PLACE_CLOSED"
  | "WEATHER"
  | "TRAVEL_TOO_LONG"
  | "BUDGET"
  | "WALKING_LIMIT"
  | "CROWD"
  | "USER_REQUEST";

export interface TripChange {
  type: "add" | "remove" | "replace" | "move" | "retime";
  dayId: string;
  fromItemId?: string;
  toItemId?: string;
  fromPlaceId?: string;
  toPlaceId?: string;
  reason: ReplanReason;
}

export interface ReplanProposal {
  baseSnapshotId: string;
  reason: ReplanReason;
  changes: TripChange[];
  validation: ValidationReport;
  requiresConfirmation: boolean;
}
```

---

## 6. 功能规格

### 6.1 候选检索升级（P0）

**问题**：当前第二天只排 1 个点且重复。  
**目标**：每天至少 3 个可行 stop，至少 1 顿正餐，全行程不重复。

规则：

1. 分别查询 `attraction`、`food`、`cafe`、`activity`、`shopping`，每类至少 5 个候选。
2. 按 `sourceId` + 标准化名称去重。
3. 用“语义相似度 + 地理距离”重排；同一天候选的移动时间不超过 `maxTravelMinutes`。
4. 强制每天至少一个 `lunch` 或 `dinner`。
5. 同一天同一 `placeId` 最多出现一次。
6. 候选不足时，扩大查询半径或降低类别权重，并在证据卡标记 `fallback: expanded_search`。
7. 所有候选必须带 `fetchedAt` 与 `source`。

### 6.2 证据卡（P0）

每个 stop 必须能在 UI 上展开：

- 来源徽标：高德 / 官方 / 人工 / Demo
- 抓取时间
- 真实 or 估算
- 营业时间、价格、评分、地址
- 距上一站距离 / 预计交通时间
- “为什么选它”：必须引用候选事实，不能是模型自由发挥
- 置信度

UI 组件建议：

- `EvidenceBadge.tsx`
- `WhyThisStop.tsx`
- `SourcePanel.tsx`

### 6.3 校验器（P0）

至少实现以下规则：

| code | severity | 触发条件 | 建议 |
|---|---|---|---|
| `DUPLICATE_PLACE` | error | 同一 `placeId` 在同一天出现 >1 次 | 替换或移到另一天 |
| `DUP_ACROSS_DAYS` | warning | 同一 `placeId` 跨天重复 | 去重 |
| `MISSING_MEAL` | error | 当天没有 lunch/dinner | 插入餐厅 |
| `CLOSED_AT_ARRIVAL` | error | 到达时间不在营业时间 | 调整时间或替换 |
| `TRAVEL_TOO_LONG` | error | 相邻 stop 交通 > `maxTravelMinutes` | 就近重排 |
| `DAY_OVERLOADED` | warning | 当天 >4 stops 或 >8h | 拆分/删减 |
| `BUDGET_EXCEEDED` | error | 总花费 > budget | 替换低价项 |
| `WALKING_LIMIT` | warning | 步行强度超 `walkingTolerance` | 改交通方式/就近 |
| `ACCESSIBILITY_RISK` | warning | 带老人/无障碍需求但无电梯/坡道/休息点 | 替换或提示 |
| `WEATHER_RISK` | warning | 雨天/高温安排户外 | 改室内 |
| `UNVERIFIED_PLACE` | warning | `source` 非 amap/official | 标记证据不足 |
| `STALE_FACT` | info | `fetchedAt` 超过 N 天 | 重新抓取 |

评分建议：

```
score = 100
  - 25 * errorCount
  - 10 * warningCount
  - 5  * infoCount
clamp 0..100
```

`passed = errorCount === 0`。

### 6.4 重规划（P0）

触发：

- 校验出现 error
- 用户主动说“下雨了/太累了/预算降了”
- POI 营业状态变化
- 路线时间超限

行为：

1. 生成 `ReplanProposal`，不改原 snapshot。
2. UI 展示 Diff：新增/删除/替换/改时间。
3. 用户确认后才写入新版本。
4. 支持回滚到上一版本。
5. 每个变更必须带 `reason`，并在 UI 显示“为什么改”。

不要做的事：

- 不要静默改行程。
- 不要在没有证据时编造替代地点。
- 不要在用户未确认时覆盖原行程。

### 6.5 评测（P0）

目录：

```
benchmarks/eval/trust/
├── tasks.json          # 20 条任务
├── run.ts
└── README.md
```

每条任务：

```json
{
  "id": "cq-001",
  "city": "重庆",
  "prompt": "带父母两天，少走路，预算3000，历史文化和美食",
  "constraints": {
    "days": 2,
    "travelers": 3,
    "elderly": true,
    "walkingTolerance": "low",
    "budget": 3000
  },
  "expect": {
    "minStopsPerDay": 3,
    "mustHaveMeal": true,
    "maxTravelMinutes": 30,
    "noDuplicatePlace": true
  }
}
```

指标：

- 事实准确率（地点存在、地址正确）
- 约束满足率（天数、预算、体力、正餐）
- 重复地点率
- 每天 stop 数
- 重规划成功率
- 端到端时延
- 纯 LLM 基线 vs 新管线的对比

输出：

- `benchmarks/eval/trust/report.json`
- `benchmarks/eval/trust/report.md`

### 6.6 其他可选模块（P2，不阻塞 MVP）

- **数字人**：静态头像 + TTS + 文字气泡，先不做 Live2D 口型。
- **运营看板**：POI 密度、路线负载、客流风险，面向景区/文旅局。

### 6.7 3D 模块（方案 A：预置场景，P0 验收后启动）

**定位**：演示加分项，不是行程引擎的一部分。只做一个地标/历史街区，独立页面，从行程 stop 深链进入。

**数据集结论**：**不需要数据集，也不需要训练。** 只需要 1 个预置场景资产包。

```
public/3d/scenes/<sceneId>/
├── model.glb          # 优先 GLB；也可用 .splat/.ply
├── cover.jpg
├── narration.md       # 60–90 秒讲解稿
├── hotspots.json      # 3–5 个热点
└── SOURCE.md          # 来源、作者、许可证、抓取时间
```

资产来源优先级：

1. [silver-tourism-digital-twin](https://github.com/Zhangweihui666/silver-tourism-digital-twin) 的 prebuilt 场景（MIT）
2. [Sketchfab](https://sketchfab.com/) 的 CC-BY / CC-BY-SA 模型
3. [OpenHeritage3D](https://openheritage3d.org/) / [CULTURE3D](https://memories.ai/research/culture3d)
4. 团队已有的 GLB 模型

明确不做：

- 不在 MVP 阶段自采 3DGS / COLMAP / 训练
- 不把 3D 渲染器深度耦合进行程引擎
- 不使用来源不明、无许可证的模型

**页面与交互**：

- 路由：`/3d/[sceneId]`
- 入口：行程 stop 上的“3D 预览”按钮，带 `?placeId=`
- 组件：`SceneViewer`，优先 `<model-viewer>`；3DGS 用 iframe / SuperSplat
- 热点：3–5 个，点击显示讲解文本/图片；可选 TTS
- 降级：WebGL 不可用或模型加载失败 → 显示 `cover.jpg` + 讲解 + “查看全景”链接

**验收标准**（2026-10-22 完成，E2E：`tests/e2e/3d-scene.spec.ts`）：

- [x] 场景本地加载 < 5 秒（本地 E2E 实测约 3.9 秒，含页面与模型加载）
- [x] 手机宽度可用（390×844 无横向溢出）
- [x] 3 个以上热点可点击
- [x] 60–90 秒讲解稿（约 322 字，按 4.5 字/秒约 72 秒）
- [x] 控制台无错误（E2E 监听 pageerror / console.error）
- [x] 页面标注来源与许可证

---

## 7. API 设计

建议新增：

```ts
POST /api/voyage/validate
  body: { tripId: string }
  resp: ValidationReport

GET /api/voyage/evidence?tripId=...
  resp: { cards: EvidenceCard[] }

POST /api/voyage/replan
  body: { tripId: string; reason: ReplanReason; constraints?: Partial<PlanningProfile> }
  resp: ReplanProposal

POST /api/voyage/replan/apply
  body: { tripId: string; proposalId: string; confirmed: true }
  resp: { tripId: string; revision: number }

POST /api/voyage/evaluate   // dev-only
  body: { tasks?: Task[] }
  resp: { report: EvaluationReport }
```

所有接口：

- 使用 Zod 校验入参
- 不返回密钥
- 错误使用现有 `planningError` / `SkillError` 风格
- 加 rate limit（复用 `enforceRateLimit`）

---

## 8. UI 设计

### 8.1 行程页

每个 stop 增加：

- 证据徽标：`真实` / `估算` / `Demo`
- 来源图标：高德 / 官方 / 人工
- “为什么选它”展开
- 校验状态：绿/黄/红

### 8.2 校验面板

- 顶部：`score` + `passed`
- 分组：error / warning / info
- 点击问题跳到对应 stop
- 提供“一键修复”或“查看替代方案”

### 8.3 重规划弹窗

- 左：原行程
- 右：新行程
- 中间：Diff + 原因
- 底部：确认 / 取消 / 回滚

### 8.4 证据来源页

- 每个 POI 的来源、抓取时间、原始字段
- 明确标注“估算”与“真实”
- 不做“看起来像事实”的模糊表述

---

## 9. 5 天实施计划

| 天 | 任务 | 产出 |
|---|---|---|
| D1 | 候选检索升级：多类别、去重、地理重排、正餐覆盖 | 每天 ≥3 stops，无重复 |
| D2 | 校验器 6 条规则 + 证据卡 | `ValidationReport` + UI 徽标 |
| D3 | 重规划 + Diff + 回滚 | `ReplanProposal` + 弹窗 |
| D4 | 20 条评测 + 纯 LLM 对比 | `report.json` / `report.md` |
| D5 | 3 分钟 demo、材料、匿名检查 | 提交包 |

每天结束必须：

```bash
npm run typecheck
npm run test
npm run lint
```

---

## 10. 验收标准（Definition of Done）

> 2026-10-21 验收：前 8 项已通过；评测报告见 `benchmarks/eval/trust/report.md`。WSL 启动已验证；Windows 启动与密钥排除需在最终提交前复核。

- [x] 20 条评测任务全部跑通
- [x] 每天 ≥3 个 stop，至少 1 顿正餐
- [x] 同一天无重复地点
- [x] 每个 stop 有证据卡
- [x] 校验器覆盖 6 条 P0 规则
- [x] 重规划可生成 Diff、可确认、可回滚
- [x] 纯 LLM vs 新管线有量化对比
- [x] `npm run typecheck` / `test` / `lint` 全绿
- [ ] 没有密钥进入 git
- [x] Windows 与 WSL 都能启动（2026-10-22 完成：Windows Node v26.3.1，`D:\voyage-win-test` 的 `/trips`、`/trip/id`、证据页与 3D 页均 200；正式提交前建议用 Node 22 LTS 复跑）
- [x] （可选，方案 A）3D 页面：1 个预置场景、3 个热点、讲解、移动端可用（2026-10-22 完成，`/3d/chongqing-hongyadong`）
- [x] （可选）3DGS 示例场景：预置 CC-BY-4.0 扫描 + 本地 SuperSplat Viewer，独立页 `/3d/knock-community-hall`（2026-10-22；未做自采/训练）
- [x] （P2）静态头像 + 文字气泡（2026-10-22 完成；按用户要求不做 TTS/口型）
- [x] （P2）运营看板：POI 密度、路线负载、客流风险（2026-10-22 完成，`/trip/[id]/insights`；客流为估算口径）

---

## 11. 跨平台协作（WSL + Windows）

### 11.1 共同约定

- Node.js 22 LTS，npm 10+
- 端口统一 `3002`
- 环境变量只放 `.env.local`，提交 `.env.example`
- **LLM key 各自申请；高德 key 用项目统一提供的**：每位开发者使用自己的 DashScope key；高德 Web 服务/JS API key（含安全密钥）由项目负责人统一提供，队友直接使用；不要把 `.env.local` 或 key 写进文档、Issue、聊天记录或提交信息
- 路径使用 `node:path` / 正斜杠，不写死 `/home/...` 或 `C:\...`
- 脚本只用 npm scripts，不写 bash-only 命令
- `.gitattributes` 建议：

```
* text=auto eol=lf
*.bat text eol=crlf
```

### 11.2 WSL 端

```bash
cp .env.example .env.local
npm config set registry https://registry.npmmirror.com
npm install
npm run dev
```

常见问题：

- `next: not found` → `node_modules` 不完整，重新 `npm install`
- `Bus error` → 检查 `node_modules/@next/swc-linux-x64-gnu/*.node` 是否约 137MB；不对就删包重装
- 端口占用 → `ss -ltnp | grep 3002`

### 11.3 Windows 端

PowerShell：

```powershell
Copy-Item .env.example .env.local
npm config set registry https://registry.npmmirror.com
npm install
npm run dev
```

注意：

- 不要从 WSL 路径直接跑 Windows 的 Node
- 不要在 `\\wsl$` 路径下 `npm install`，会非常慢
- Windows 防火墙允许 Node 监听 3002
- 浏览器访问 `http://localhost:3002`
- 如果 WSL 里跑、Windows 浏览器访问不了，检查 WSL 端口转发或使用 WSL IP

### 11.4 Git 协作

- `.env.local`、`node_modules`、`.next`、`.voyage` 不提交
- 每次改动小而可 review
- 代码注释只写“为什么”，不写“是什么”
- 不要提交 `package-lock.json` 的平台相关二进制改动（只保留依赖解析变化）

### 11.5 密钥与账号规则

| 变量 | 谁申请 | 是否共享 | 说明 |
|---|---|---|---|
| `LLM_API_KEY` | 每位开发者自己 | **否** | 阿里云 DashScope / 百炼 key，按量计费；**不要使用队友的个人 key** |
| `AMAP_SERVER_KEY` | 项目负责人统一提供 | **是（项目统一）** | 高德 Web 服务 key；队友直接使用负责人的 key |
| `NEXT_PUBLIC_AMAP_KEY` | 项目负责人统一提供 | **是（项目统一）** | 高德 JS API key；队友直接使用负责人的 key |
| `NEXT_PUBLIC_AMAP_SECURITY_CODE` | 项目负责人统一提供 | **是（项目统一）** | 必须与 JS API key 配对 |
| `.env.local` | 每人本地 | **否** | 已被 `.gitignore` 忽略；不截图、不发群、不提交 |

规则：

1. **队友 Windows 端新建自己的 `.env.local`**：`LLM_API_KEY` 填自己的；高德三个值（Web 服务 key、JS API key、安全密钥）填项目负责人统一提供的。
2. **高德 key 由项目负责人统一维护**：队友不要另申请或覆盖，避免配额分散、白名单不一致。
3. 文档、示例、Issue、PR 中只写 `<your-dashscope-key>`、`<project-amap-key>` 这类占位符。
4. 如果 key 出现在聊天、截图或提交记录中，立即到控制台轮换。
5. 代码中只通过 `process.env` 读取，不硬编码。
6. 评审/答辩演示如需他人复现：高德 key 用项目统一的，LLM key 各自申请，不提供个人 key。

---

## 12. 许可证与合规

| 项目 | 许可 | 用法 |
|---|---|---|
| Voyage | MIT | 底座，保留版权声明 |
| RoutePilot | MIT | 可借鉴代码/契约，保留版权声明 |
| silver-tourism-digital-twin | MIT | 可借鉴/嵌入，保留版权声明 |
| shanghai-citywalk | 无 LICENSE | 只借鉴思路，不复制代码 |
| Live2d-AI-Guide | 无 LICENSE | 只借鉴架构，不复制代码 |
| Guido | 无 LICENSE | 只借鉴架构，不复制代码 |
| StoryMap | 无 LICENSE | 只借鉴布局/指标 |
| Ctrip-Style | 无 LICENSE 文件 | 只借鉴交互模式 |
| XinjiangTravel / Tourism-KG-QA | 无 LICENSE | 只借鉴思路 |

比赛材料中建议加一句：

> 本项目基于 MIT 许可的 Voyage 构建，并参考了 RoutePilot、Silver Tourism Digital Twin 等开源项目的架构思想；未复制无许可证项目的代码。

---

## 13. Codex 执行约束

1. **先读代码再改**：至少阅读
   - `src/services/planning/conversation-planner.ts`
   - `src/services/planning/outline-planner.ts`
   - `src/skill/providers.ts`
   - `src/types/travel.ts`
   - `src/schemas/planning.ts`
   - `src/app/api/voyage/planning/session/[id]/generate/route.ts`
2. **不要重写整个应用**：增量修改，保留现有测试。
3. **不要引入新框架**：不加 LangGraph、CrewAI、Neo4j、Supabase。
4. **不要训练模型**：只用现成 API/模型。
5. **不要提交密钥**：所有 key 从 `process.env` 读取。
6. **不要静默降级**：LLM 失败要记录 `fallbackReason`，并在 UI 可见。
7. **每个规则一个文件 + 单测**：`src/services/trust/rules/*.ts`。
8. **先做 P0，再做 P1/P2**：3D 只做方案 A（预置场景/GLB），不接 3DGS 训练/COLMAP；数字人不要提前做。
9. **每次提交前运行**：
   ```bash
   npm run typecheck
   npm run test
   npm run lint
   ```
10. **保持 diff 可 review**：一个 PR 只做一件事。
11. **不要复用个人 key**：不要读取、打印或把 `.env.local` 中的个人 key 写进代码、文档、测试或提交信息；示例一律用占位符。

---

## 14. 答辩叙事（3 分钟）

1. **问题**：AI 行程看起来很美，但经常重复、闭馆、走回头路、没有依据。
2. **现有方案**：行程生成器只负责“生成”，不负责“验证”。
3. **我们的做法**：Plan → Verify → Replan → Explain。
4. **Demo**：
   - 输入“带父母、少走路、预算 3000”；
   - 生成行程；
   - 证据卡展示来源；
   - 校验器标出“重复地点/缺正餐/闭馆”；
   - 一键重规划；
   - Diff 展示改了什么、为什么改。
5. **结果**：20 条评测，重复地点率从 X% 降到 0，正餐覆盖率 100%，约束满足率提升 Y%。
6. **价值**：不是又一个行程 App，而是可审计的旅行决策系统。

评委可能问：

- **“这不就是 ChatGPT 吗？”** → 我们不让模型直接给事实，事实来自高德/官方数据，模型只做规划与解释。
- **“证据卡有什么用？”** → 用户和监管都能追溯每条推荐；出错可定位。
- **“重规划有什么难？”** → 难在约束、版本、Diff 和回滚，不是再问一次模型。
- **“为什么不用现成 OTA？”** → OTA 给交易，我们给可验证的决策与本地知识。

---

## 15. 风险与应对

| 风险 | 应对 |
|---|---|
| 高德配额/限流 | 缓存、降级、显示 `source: estimated` |
| LLM 输出 schema 漂移 | Zod 校验 + 修复 prompt + 规则兜底 |
| Windows/WSL 行为不一致 | 统一 npm scripts、路径、端口；两端各跑一次 |
| 证据卡信息不足 | 明确显示“未知/估算”，不假装真实 |
| 范围膨胀 | P0 冻结，P1/P2 必须等 P0 验收 |
| 比赛材料泄密 | `.env.local` 不提交；提交前 `git status` 检查 |

---

## 16. 最后一句

**先把“可信”做出来，再把“好看”加上去。**  
评委先相信你的行程，才会觉得 3D、数字人、看板是加分项，而不是遮羞布。
