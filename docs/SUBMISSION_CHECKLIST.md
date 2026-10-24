# 提交前检查单

> 2026-10-22 · 对应 `docs/PROJECT_INNOVATION.md` 第 10 节验收标准

## 1. 密钥扫描结果

扫描范围：当前工作目录（排除 `node_modules`、`.next`、`.voyage`、`.git`）。

- `.env.local`：11 个非空配置项；`.gitignore` 已包含 `.env*`，只放行 `.env.example`。
- 旧仓库 `/home/me/voyage`：`.env.local` / `.env` 从未被 git 跟踪；历史中未搜索到 `sk-` 形式的密钥。
- `LLM_API_KEY`、`AMAP_SERVER_KEY`、`NEXT_PUBLIC_AMAP_KEY`、`NEXT_PUBLIC_AMAP_SECURITY_CODE`：**未发现**出现在 `.env.local` 之外。
- 扫描到的同名值是 `LLM_PROVIDER=deepseek`、`LLM_MODEL=deepseek-*`、`LLM_BASE_URL=https://...`，属于非密钥的公开配置，出现在 README、评测报告和设置页代码中。如果 `LLM_BASE_URL` 是内部地址，提交前把它从示例和报告中移除。
- 测试里的 `TOKEN=private-token`、`SECRET=fliggy-secret` 等均为占位值。

**结论**：当前没有发现密钥泄漏；因为当前目录不是 git 仓库，最终提交到 Git 仓库后还需要再跑一次第 2 节命令。

## 2. 提交前重新检查（在最终 Git 仓库里执行）

```bash
# 只应看到 .env.example
git ls-files | grep -E '(^|/)\.env(\.|$)'

# 历史里不应出现 sk- / AKIA 形式的密钥
git log --all -p -S 'sk-' | head
git log --all -p -S 'AKIA' | head

# 工作区快速扫描（不要把这些命令的输出贴到公开 Issue）
grep -rInE 'sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}' . \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git \
  --exclude-dir=.voyage --exclude-dir=coverage

git status --short
```

## 3. Windows 启动验证

当前环境检测到 Windows Node：`E:\nodejs26+\node.exe`（v26.3.1）。规格要求 Node.js 22 LTS；建议用 nvm-windows 安装 22 后再验证。

步骤：

1. 把仓库复制到 Windows 盘符路径（不要直接在 WSL 目录里复用 `node_modules`，Linux/Windows 原生模块不通用）。
2. 在 Windows 终端进入项目目录：
   ```powershell
   npm ci
   Copy-Item .env.example .env.local
   # 按需填写 .env.local；不要把它提交到 git
   npm run dev
   ```
3. 打开 `http://localhost:3002`，确认：
   - `/trips` 能打开
   - `/trip/<id>` 能渲染行程
   - `/3d/chongqing-hongyadong` 能加载 3D 场景（热点可点、无控制台错误）

WSL 端已通过 `npm test` / `typecheck` / `lint` / `build` / E2E 冒烟。

2026-10-22 实际验证：项目复制到 `D:\voyage-win-test`，用 Windows Node v26.3.1（`E:\nodejs26+\node.exe`）执行 `npm ci` 与 `npm run dev`，四个关键页面均返回 200 且内容正常。规格要求 Node 22 LTS，正式提交前建议在 22 LTS 下再跑一次。

## 4. 当前 DoD 状态

| 验收项 | 状态 |
|---|---|
| 20 条评测任务全部跑通 | ✅ |
| 每天 ≥3 个 stop，至少 1 顿正餐 | ✅ |
| 同一天无重复地点 | ✅ |
| 每个 stop 有证据卡 | ✅ |
| 校验器覆盖 6 条 P0 规则 | ✅ |
| 重规划可生成 Diff、可确认、可回滚 | ✅ |
| 纯 LLM vs 新管线有量化对比 | ✅ |
| typecheck / test / lint 全绿 | ✅ |
| 没有密钥进入 git | ⚠️ 当前目录已扫描干净，最终 Git 仓库需复跑第 2 节 |
| Windows 与 WSL 都能启动 | ✅ 2026-10-22 已在本机 Windows Node v26.3.1 下验证（`D:\voyage-win-test`，`npm ci` + `npm run dev`；`/trips`、`/trip/id`、`/trip/id/evidence`、`/3d/chongqing-hongyadong` 均 200）；正式提交建议用 Node 22 LTS 复跑 |
| （可选）3D 页面 | ✅ `/3d/chongqing-hongyadong`，E2E 覆盖桌面与手机宽度 |

## 5. 3D 资产说明

- 场景：`public/3d/scenes/chongqing-hongyadong/`
- 模型：项目脚本生成的占位 GLB（CC0-1.0），不是真实测绘或 3DGS。
- 来源与许可证：`SOURCE.md`；正式演示前可替换为有明确许可证的 GLB，并同步更新 `scene.json` 与 `SOURCE.md`。

## 6. 核心 UI 组件测试

2026-10-22 补齐 5 个文件、27 条用例（`tests/components/` 现共 9 个文件、38 条）：

| 组件 | 覆盖点 |
|---|---|
| `NewTripExperience` | 初始想法输入、会话创建、上游失败提示 |
| `XhsGuidePanel` | 分类检索、自定义关键词、报错与空态、笔记解析为地点 |
| `OfferHub` | 行程默认值、能力接口失败、类别校验、刷新命令与修订冲突、证据标签 |
| `LiveDiscovery` | 实时结果、已在地图标记、空结果、失败重试 |
| `EvidencePage` | 证据列表、来源与抓取时间、真实/估算统计、按天分组 |
| `PlanningStatusCard` / 3D 入口 | 状态卡与场景预览入口（原有 11 条） |

`tests/setup.ts` 的 scroll 桩现在只在 jsdom 环境生效，node 环境单测不再因 `Element` 未定义而失败。

## 7. 规格偏差项补齐（2026-10-22）

| 规格要求 | 现状 |
|---|---|
| `POST /api/voyage/evaluate`（6.5 节，dev-only） | 已实现；仅开发环境可用，Zod 校验、限流 2 次/分钟，与 CLI 共用 `src/services/evaluation/trust-evaluation.ts`；单测 `tests/evaluate-route.test.ts` |
| UI 8.4 证据来源页 | 已实现 `/trip/[id]/evidence`；行程可信度面板中的“证据 N 条”可进入；展示来源、抓取时间、原始字段、真实/估算；E2E `tests/e2e/evidence-page.spec.ts` |
| 第 13 节第 7 条：每条规则一个文件 | 已拆分到 `src/services/trust/rules/*.ts`，12 条规则各自成文件，注册表与顺序保持原行为；`tests/trust/rules.test.ts` 覆盖注册表 |

## 8. 完整验证结果（2026-10-22 最终全量）

- 单元测试：97 个文件、566 条全部通过。
- `typecheck` / `typecheck:test` / `lint` 全绿。
- 生产构建通过，`/trip/[id]/evidence`、`/trip/[id]/insights`、`/trip/[id]/offers` 与 `/api/voyage/evaluate` 均已进入路由清单。
- Playwright E2E：42 条全部通过（含移动端 8 条：`isMobile + hasTouch` 真机仿真、320px 无横向溢出、横屏抽屉、触摸点击、平板断点、3DGS 按需加载；另含 3D、3DGS、证据来源页、运营看板、控制台外壳、移除一天、地图交互、预订记录相关页面）。
- 密钥扫描：工作区 `sk-*` / `AKIA*` 无命中；密钥变量名只出现在文档、示例与测试占位符中；`.env.local` 仅本地存在。
- Windows 启动：Windows Node v26.3.1 下 `D:\voyage-win-test` 用最新代码启动，`/trips`、`/trip/:id`、`/evidence`、`/insights`、`/offers`、`/3d/chongqing-hongyadong` 六个页面均 200 且内容正常。
- 说明：E2E 必须用 Playwright 配置自带的环境重新构建（`next build` 会把 `NEXT_PUBLIC_AMAP_KEY` 打进前端产物）；`PLAYWRIGHT_REUSE_BUILD=1` 复用带真实 key 的构建会让地图 marker 交互失真。

## 9. P2 实现（2026-10-22）

按“不要语音”的范围实现：

| 项 | 范围 | 入口 |
|---|---|---|
| 静态头像 + 文字气泡 | 自绘 `public/avatars/voyage-guide.svg`；无 TTS、无口型；气泡跟随当前热点 | 3D 讲解页“场景讲解”卡片 |
| 运营看板（完整版） | 城市 POI 样本（高德 5 类检索、10 分钟缓存、失败回退到行程内 POI）；6×6 密度网格与品类分布；分时负载图（17–20 点高亮、交通折算）；按天负载条；客流风险评分（评价量/评分/晚间/周末/天气）与处置建议；按天与风险等级筛选；运营建议；JSON 导出；全部估算口径在页面明确标注 | `/trip/[id]/insights`，行程可信度面板“运营视角” |
| 3DGS 示例场景 | 预置 CC-BY-4.0 场景 Knock Community Hall（作者 scbenoit，SuperSplat 场景 0ff2e6dc）；本地托管 SuperSplat Viewer 1.39.0（MIT）；iframe 独立页，不接入行程引擎；GLB 场景页与本页互相链接；来源、作者、许可证、抓取时间均展示 | `/3d/knock-community-hall` |

验证：单测 97 文件 / 566 条全过（含运营看板 4 条、预订记录 4 条、3DGS 3 条），E2E 36 条全过（新增 3DGS、控制台外壳与动效用例；运营看板覆盖手机宽度、筛选与空样本回退）。有高德 key 时实测城市样本 79 个 POI；无 key 时自动回退并标注“仅行程内 POI”。

## 10. 预订记录闭环（规格 3.3 排除项的软实现，2026-10-22）

规格明确不接“真实预订/支付”。这里只补“推荐 → 官方入口 → 预订记录”的闭环，不涉及支付与代下单：

- 报价卡新增“标记已预订”：填写确认号（可选）与价格（可选），写入 runtime 的 `add-reservation`（复用既有 Reservation schema 与命令）。
- 预订记录显示在行程“任务”页，含类型、状态、确认号、价格与来源。
- 页面与记录处都明确写着“Voyage 不代下单，也不保存支付信息”。
- 服务端 `addReservationCommand` 额外返回更新后的 `trip`，与其它行程写命令保持一致；原字段不变，向后兼容。
- 验证：`tests/components/OfferHub.test.tsx`（映射 + 写入）、`tests/components/ReservationSummary.test.tsx`（展示与空态）；全量单测 97 文件 / 566 条、E2E 36 条通过。

