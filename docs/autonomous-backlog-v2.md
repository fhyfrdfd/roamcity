# Autonomous Backlog V2

> 日期:2026-10-05 · 基线:main@6542303(Audit V2) · V1 的 20 项全部闭环(见 `engineering-audit-v2.md`)
> 本轮新特点:P0/P1 任务大多带现成数据集与基线,修完立即可量分。

## P0

### ✅ EXTRACT-001 修复 planning 提取器 11 个 knownFailure（2026-10-05，fd32db9）
> 已完成：eval:profile 59/59 全绿（recall/precision 1.000），11 个缺陷全部修复——意图 span 守卫、目的地多触发扫描（日期连接词/活动动词跳过）、(?<!月) 天数断言、pace 步行/预算守卫、否定优先、吃素入词表、mustVisit 子句边界。
- **问题**:`benchmarks/eval/planning-profile/dataset.json` 中 11 个 `knownFailure` 案例钉住的真实缺陷:必去/避开 POI 被目的地兜底正则当 destination;"5月1日"的"1日"被读成 days=1;"不要参考社交媒体"被肯定式正则抢先(socialOptIn 反转);"吃素"不在词表;mustVisit 子句吞掉整句;"步行适中"误触发 pace=balanced。
- **方案**:逐条修 `extractPlanningProfile`(conversation-planner.ts):目的地兜底加"已识别 POI 信号词则不捕获"守卫;天数正则排除日期上下文(先行断言);否定语义统一预处理(把否定子句先剥出再跑肯定式);词表补"吃素/素食主义";mustVisit 的 extractAfter 捕获窗口缩到子句边界。**每修一个,数据集对应案例翻绿,并删除 knownFailure 标记**。
- **验收**:`npm run eval:profile` 全绿;`tests/planning/*` 不回归。**测试**:数据集即测试。

### ✅ OPT-001 修复 optimizer 聚类质量缺口（2026-10-05，d8c7e2e）
> 已完成：optimizeGuideDayAssignment 双候选取更优（聚类 vs 原始顺序分块，同一天内排程），s2d-6p-hotel 从劣化 45% 变为持平基线；bench:optimizer 5/5，knownFailure 退役。
- **问题**:`bench:optimizer` 场景 s2d-6p-hotel:地理聚类的天分配比朴素顺序差 45%(步行米数)。
- **方案**:day-assignment 评分引入 naive 分配对比(取更优者),或聚类后做一次 2-opt 交换改进;保持确定性(禁止时间/随机源)。
- **验收**:`npm run bench:optimizer` 该场景翻绿且全部场景确定性。

### ✅ AGENT-001 get_trip 新鲜度 + resyncTrip ok 检查（2026-10-05，9e87c7c）
> 已完成：get_trip 工具改为实时 runtime 读取（不再用循环前缓存的 envelope）；resyncTrip 尊重 envelope.ok（ok:false 不再覆盖本地状态），新增回归测试。
- **问题**:agent 循环里 get_trip 工具返回循环前缓存的 tripEnvelope,提案应用后第二轮的 get_trip 是旧的(评审 L6);`store/trip-store.ts` resyncTrip 忽略 envelope.ok。
- **方案**:get_trip 工具的 execute 改为实时 `ctx.runtime.execute("get-trip", …)`(ctx 已有 runtime);resyncTrip 检查 `envelope.ok` 后再 setState。
- **验收**:agent-tools-context 测试补充断言;trip-store 测试补"ok:false 不写 store"。

## P1

### ✅ CLIENT-001 迁移剩余 fetch 样板到 api-client（2026-10-21）
> 已完成：客户端裸 `fetch` 清零（NewTripExperience、trips、settings、share、trip layout/explore、TopBar、LiveDiscovery、OfferHub、UrbanTransportIntelligence、XhsGuidePanel、openai、routing、trip-store 全部走 `api-client` 的 `getJson/postJson/deleteJson/postEnvelope*/runCommand`）；服务端 provider 调用保持原样。
- **问题**:NewTripExperience、CredentialEditor、LlmProviderEditor、OfferHub、LiveDiscovery、XhsGuidePanel 仍有手写 fetch+envelope(评审确认至少 6 处)。
- **方案**:逐个换成 `postEnvelope`/`runCommand`,统一网络错误文案;行为不变。
- **验收**:grep `await fetch("/api/voyage` 在 src/components、src/features、src/app(非路由)清零。

### ✅ HTTP-STATUS-001 api-client 区分 HTTP 状态（2026-10-21）
> 已完成：`requestJson`/`postEnvelope` 先判 `response.ok`；4xx 的 voyage envelope 仍原样返回给业务判断，5xx HTML/非 JSON 2xx 抛带 `status` 的 `ApiError`，不再落入“网络异常”；新增 11 条 api-client 单测。
- **问题**:postEnvelope/runCommand 忽略 `response.ok`(与旧代码一致地解析 json 失败即网络错);5xx 返回 HTML 时 `response.json()` 抛错落进"网络异常"分支,误导排障。
- **方案**:postEnvelope 先判 `response.ok`,`!ok` 时尝试解析 envelope,失败抛 `ApiError("服务异常 (500)", undefined, status)`。需要产品确认文案后实施。

### ✅ AGENT-002 demo regex 旁路退役（2026-10-21）
> 已完成：删除 demo 模式关键词直通 `propose-change` 的分支；配置了 LLM 时 demo 与真实模式走同一 tool loop。未配置 LLM 时改为确定性规则兜底（propose-change 或配置提示，不再 502）。新增 3 条路由测试覆盖三种路径。
- **问题**:demo 模式下 `/少走|走路|…/` 命中即绕过 LLM(route.ts:203-205),行为与真实模式不一致(Audit V1 §9-5)。
- **方案**:demo 模式下也走 LLM(未配 LLM 时自然落到规则规划),删除 regex;E2E demo 断言同步调整。
- **验收**:`tests/agent-tools-context.test.ts` + Playwright conversational-planning 绿。

### ✅ KNOWLEDGE-001 双源同步 + 语料扩充（2026-10-21）
> 已完成：`knowledge/**` 成为唯一源；`npm run knowledge:build` 生成 `src/services/knowledge/builtin-knowledge.ts`（10 条：重庆/成都/西安/杭州各 ≥2 篇 + 全局交通规则）；新增双源一致性测试与检索可达性测试，`tests/knowledge-rag.test.ts` 保持绿。
- **问题**:`retriever.ts` BUILTIN_KNOWLEDGE 硬编码 5 条与 knowledge/*.md 双源必漂移;语料只有 4 篇种子。
- **方案**:构建期(或测试)从 knowledge/*.md 生成 BUILTIN_KNOWLEDGE;语料按城市扩充(重庆/成都/西安/杭州 至少各 2 篇),跑一次真实 ingest 验证。
- **验收**:双源一致性测试;`tests/knowledge-rag.test.ts` 绿。

### ✅ TEST-005 NewTripExperience 修订冲突单测（2026-10-21）
> 已完成：把 `friendlyApiError` 与 `revisionFromFailure` 抽到 `src/features/new-trip/planning-client.ts`，组件改用纯函数；新增 3 条单测直接断言 REVISION_CONFLICT 文案、5xx/4xx 分流、嵌套/顶层 revision 提取。
- **问题**:1091 行核心 UI,修订冲突/重试逻辑(:757-932)只有 E2E 间接覆盖。
- **方案**:抽离冲突处理纯函数(store 动作或 hook),vitest 组件级测试渲染临界态(修订过期、重试、错误横幅)。
- **验收**:.test.tsx 直接断言冲突分支。

### ✅ CI-002 E2E 冒烟与基准本地化（2026-10-21）
> 已完成：`package.json` 增加 `test:e2e:smoke`（conversational-planning / offline-fallback / mobile-nav / remove-day / session-resume / 3d-scene，共 17 条）；README 中英文补充 bench/eval 命令，并把 e2e 数量校准为 42 条 / 14 个 spec。2026-10-22 把“生成路线图”完整链路加入冒烟子集，并把 mobile-nav 扩到 8 条（触摸仿真/320px/横屏/平板/3DGS 按需加载），全量 42/42 通过。
- **方案**:package.json 加 `test:e2e:smoke`(golden-trip + offline-fallback);CONTRIBUTING 注明提交前跑法;bench 基线刷新命令写进 README。

## P2

- **✅ RUNTIME-001（2026-10-22）runtime.ts 分解**:runtime 从 2371 行降至 **977 行（<1000 目标达成）**，方法全部保留为薄封装。外移模块：`services/planning/create-trip.ts`、`replan-trip.ts`、`services/reservations/commands.ts`、`services/travel-events/commands.ts`、`services/social/commands.ts`、`services/offers/commands.ts`、`services/memory/commands.ts`、`services/trips/commands.ts`、`services/weather/commands.ts`、`services/brain/commands.ts`；无状态 helper 统一到 `src/skill/runtime-helpers.ts`，写命令共用的 `loadTripForWrite` 在 `services/trips/write-guard.ts`。85 文件/515 测试全绿。
- **✅ DEPLOY-001（2026-10-21）多实例方案**:决策文档已写入 `docs/DEPLOY_MULTI_INSTANCE.md`——Postgres 权威存储 + Redis 限流、乐观并发替代文件锁、生成任务队列化、分阶段迁移与验收标准。
- **✅ UX-001（2026-10-21）真实模式走查**:走查记录见 `docs/UX_WALKTHROUGH.md`；trips/行程/探索/设置/新建规划会话+消息全部 200，无页面错误；分享页错误码文案已补齐（2026-10-22，`share-error.ts` + 单测），离线断网走查仍列为后续项。
- **✅ PERF-001（2026-10-21）性能画像**:数据见 `docs/PERF_PROFILE.md`——共享 JS 150 kB、`/trip/[id]` 302 kB、生产 Ready 972 ms、首页 4–5 ms、capabilities 29 ms、trip 壳 297 ms；LLM p50/p95 5.3/7.1 s。
- **STYLE-001（部分完成，2026-10-21）**:已加 `src/services/**` 禁止导入 `store` 的 `no-restricted-imports` 边界规则（当前零违规）；Prettier 全量格式化涉及大面积改动，留待单独 PR。
- **✅ TS-002（2026-10-22）渐进启用 noUncheckedIndexedAccess**:`tsconfig.json` 开启该标志，修复 src 全部 178 个错误（安全网/路径/优化器/社交信号/规划解析等），`npm run typecheck` 通过；`tsconfig.test.json` 显式关闭该标志，测试夹具与 benchmarks 待后续跟进。
- **✅ DB-001（2026-10-22）**:新增 `supabase/migrations/0007_drop_dead_persistence.sql`——`bookings` 表从未被任何代码路径写入/读取（预订与优惠都在 `trips.payload`），直接删除；`itinerary_items.reservation_id` 始终为空（`ItineraryItem.reservationId` 无赋值路径，预订通过 `Reservation.linkedItemId` 关联），一并删除并从 `SupabaseTripRepository` 的写入映射中移除。
- **✅ COOKIES-001（2026-10-21）**:cookie 值含 "=" 截断已修复（`readRequestCookie` 只按第一个 `=` 分割），补 5 条单测。
- **✅ MOBILE-001（2026-10-22）移动端打磨**:`viewport` 增加 `viewportFit: "cover"` 让安全区真正生效；共享输入框/文本域移动端 16px 防止 iOS 聚焦缩放；新增 `.touch-target`（粗指针设备 44px 命中区）覆盖底栏关闭、地图气泡、时间轴、3D 热点等小图标控件；3DGS 在触屏设备改为点击后加载（先显示封面与 28 MB 提示，加载超时/失败可切回静态封面）；外壳断点改为 `desk`（≥768px **且** ≥480px 高），修复横屏手机被误判为桌面、行程抽屉被隐藏的问题；移除抽屉双重底部安全区，短视口高度档位调整为 32/70/96%；「更多」弹层底边计入 `safe-area-inset-bottom`。移动端 E2E 用 `isMobile + hasTouch` 真机仿真，新增 320px 无横向溢出、横屏抽屉、触摸点击、平板、3DGS 按需加载共 8 条，本地 8/8 通过。

## 执行顺序建议

~~EXTRACT-001 → OPT-001 → AGENT-001~~（P0 已于 2026-10-05 全部完成）→ 下一批:CLIENT-001/HTTP-STATUS-001（合并一个 PR 粒度）→ AGENT-002 → TEST-005 → KNOWLEDGE-001 → CI-002 → P2 按需。
