# 真实模式走查记录（UX-001）

> 2026-10-21 · WSL2 · dev server `http://localhost:3002` · 真实 AMap + DeepSeek + 本地 guest 工作区。
> 浏览器：Playwright Chromium（headless shell，`--no-sandbox`）。这不是自动化 E2E 套件，而是一次带网络监听和页面错误捕获的走查。

## 1. 走查路径与结果

| 路径 | 操作 | 结果 |
|---|---|---|
| `/trips` | 打开列表 | 200，行程卡片正常渲染 |
| `/trip/{id}` | `get-trip` → 行程面板 | `POST /api/voyage/command` 200；标题、行程、校验面板正常 |
| `/trip/{id}/explore` | 触发实时 POI | `GET /api/amap/poi` 200；地点列表与地图备用视图正常 |
| `/settings` | 打开设置 | 页面正常渲染，凭据编辑区可见 |
| `/new-trip` | 输入需求 → 开始对话 | `POST /api/voyage/planning/session` 200，返回 sessionId |
| `/new-trip` | 发送一条补充消息 | `POST .../message` 200，revision=2，助手回复正常 |
| `/trip/{id}`（此前评测） | 一键修复 → Diff → 应用 → 撤销 | 提议/应用 200，撤销 restore 200，无页面错误 |
| `/share/{token}` | 未单独走查 | 仅代码级/接口级验证；见下方发现 |

网络监听：上述路径无 4xx/5xx；页面无 `pageerror`、无 console error。

## 2. 本次发现

1. **~~分享页错误文案偏泛~~**（2026-10-22 已修复）：`shareErrorMessage` 按 `ApiError.code` 区分——`SHARE_EXPIRED` → “分享链接已过期，请让分享者重新生成”，`SHARE_NOT_FOUND` → “分享链接不存在，请检查地址是否完整”，`INVALID_INPUT` → “分享链接格式不正确”；网络/未知错误保留通用文案。
2. **无 LLM 模式的行为已更诚实**：AGENT-002 之后，demo/未配置 LLM 时普通问题返回“未配置 AI 模型”提示，而不是 502；行程调整仍走确定性规则提案。
3. **离线回退路径未在真实断网下走查**：本次只验证了正常网络；`offline-fallback` 由 Playwright E2E 覆盖（本次未跑完整 E2E）。
4. **地图**：本环境未配置 `NEXT_PUBLIC_AMAP_KEY`，走 SVG 备用视图；真实地图脚本的首次加载与失败回退需在目标环境补测。

## 3. 走查脚本

脚本保留在 `/tmp/voyage-client-smoke.cjs`（不进入仓库），覆盖上述 1–6 行，并监听：

- `pageerror` / `console.error`
- 所有 `status >= 400` 的响应
- 关键接口的 `waitForResponse`

## 4. 后续建议

- ✅ 分享页按错误码细化文案（2026-10-22 已完成）。
- 在目标环境（配置真实 AMap JS Key）复测地图首屏与失败回退。
- ✅ 把 `/new-trip` 的“生成路线图”完整链路加入 E2E 冒烟（2026-10-22 已完成，`test:e2e:smoke` 现含 conversational-planning，9/9 通过）。
- 真实断网走查一次离线包（DevTools offline + `/trip/{id}`）。
