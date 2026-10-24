# 多实例部署决策（DEPLOY-001）

> 2026-10-21 · 基于当前代码盘点。现状是**单实例**部署：文件型 guest 工作区、进程内限流、进程内文件锁。本文给出多实例化的目标架构、迁移顺序与验收标准。

## 1. 为什么现在不能直接多实例

| 机制 | 当前实现 | 多实例下的问题 |
|---|---|---|
| Guest 工作区 | `VOYAGE_DATA_DIR/guests/<uuid>/` 下的 JSON 文件（`src/app/api/voyage/workspace.ts`） | 实例本地磁盘不共享；同一 guest 的请求落到不同实例会看到不同行程 |
| 行程修订 | `revision` + `hash` + 进程内 `withWriteLock`（`src/skill/repository.ts`） | 锁只在单进程有效；两个实例同时写入会丢失更新（check-then-act） |
| 一次性提案 | `proposals/<id>.json` + `consumedAt` + token hash | 跨实例无法原子消费；重复 apply 可能成功两次 |
| 限流 | 进程内滑动窗口 `Map`（`src/lib/api-guards.ts`） | 每个实例独立计数，付费接口预算被放大 N 倍 |
| TTL 清理 | 请求触发的 debounce sweep | 每个实例各自 sweep，放大 IO 且不同步 |
| 生成任务 | `generate` 路由内 detached worker，客户端轮询同一会话 | 轮询可能落到另一实例，看不到生成进度；实例重启会丢任务 |
| 分享 token | `shares/<token>.json` | 跨实例不可见 |

已有 `SupabaseTripRepository`（`src/services/trips/supabase.ts`）用于登录用户的行程，但 runtime 的 guest 工作区仍走 JSON 文件，两者不是同一存储层。

## 2. 目标架构（推荐）

**存储：Postgres/Supabase 作为唯一权威存储；Redis 作为限流与短期状态。**

### 2.1 数据模型

| 表 | 关键列 | 说明 |
|---|---|---|
| `guest_workspaces` | `id uuid pk`, `created_at`, `last_seen_at` | 替代 guest 目录 |
| `trips` | `id`, `workspace_id`, `payload jsonb`, `revision int`, `hash text`, `updated_at` | `unique(workspace_id, id)`；`payload` 保持现有 `Trip` 结构 |
| `planning_sessions` | `id`, `workspace_id`, `payload jsonb`, `revision int`, `hash text`, `status`, `updated_at` | 现有 `StoredPlanningSession` 结构 |
| `proposals` | `id`, `workspace_id`, `trip_id`, `base_revision`, `base_hash`, `token_hash`, `change_set jsonb`, `proposed_trip jsonb`, `expires_at`, `consumed_at` | `unique(token_hash)`；`consumed_at` 一次性消费 |
| `shares` | `token`, `trip_id`, `payload jsonb`, `expires_at` | `token` 主键 |

### 2.2 并发控制

用**乐观并发**替代文件锁：

```sql
UPDATE trips
SET payload = $1, revision = revision + 1, hash = $2, updated_at = now()
WHERE id = $3 AND revision = $4 AND hash = $5
RETURNING revision, hash;
```

- 影响 0 行 → `REVISION_CONFLICT`（与现有错误码一致）。
- 提案 apply 在事务内完成：`UPDATE proposals SET consumed_at = now() WHERE id=$1 AND consumed_at IS NULL` → 更新 trip → 提交；`unique(token_hash)` + `consumed_at IS NULL` 保证一次性。
- 不需要跨实例锁；数据库事务边界就是临界区。

### 2.3 限流

- Redis（Upstash/ElastiCache）滑动窗口，key 仍为 `scope:guestWorkspaceId`，与现有 `RATE_LIMITS` 表和 `enforceRateLimit` 接口保持一致。
- 失败模式按 scope 区分：
  - `llm` / `amap` / `social` / `fliggy`：Redis 不可用时**失败关闭**（返回 503/429），保护付费预算。
  - `read`：失败打开（允许通过），避免 Redis 故障导致全站不可用。
- 需要保留单实例内存实现作为本地开发/测试 fallback，通过 `VOYAGE_RATE_LIMIT_STORE=redis|memory` 切换。

### 2.4 生成任务

- 将 detached worker 改为**队列任务**（BullMQ/Redis 或 Supabase `pg_cron` + 任务表）。
- 会话状态写 Postgres，轮询可在任意实例读取；任务重试幂等（按 session revision 写入）。
- 若短期不做队列，至少要求**粘性路由**（同一 guest 固定到同一实例）作为过渡，但实例重启仍会丢任务。

### 2.5 大文件

城市封面、导出包等大对象放 S3/R2/OSS；数据库只存 URL。`.env.local` 等凭据永不进入对象存储。

## 3. 迁移顺序

**阶段 0（过渡，1–2 天）**
1. 保持单实例 + 粘性会话（反向代理按 cookie/guest id 固定）。
2. 限流先接 Redis，接口不变；保留内存 fallback。
3. 把 `VOYAGE_DATA_DIR` 放到共享卷（EFS/NFS）只作为临时方案，**不解决锁与原子性问题**。

**阶段 1（存储，核心）**
1. 新建上述表与 RLS（guest workspace 通过服务端 key 访问；登录用户走 Supabase auth）。
2. 实现 `PostgresSkillRepository`，接口与 `JsonSkillRepository` 对齐；用 `VOYAGE_STORAGE=db|file` 灰度。
3. 双写/回填：导出 `.voyage/guests/**` 到 DB；读路径优先 DB，缺失回退文件；比对 revision/hash。
4. 提案 apply 改为事务 + 乐观并发；补并发测试。

**阶段 2（限流与清理）**
1. Redis 限流全量；429 指标与告警。
2. 过期提案/分享/guest 清理改 pg_cron 或定时任务，移除请求内 sweep。
3. 生成任务入队；轮询读 DB。

**阶段 3（多实例/多区域）**
1. 无状态实例水平扩容；健康检查不依赖本地磁盘。
2. 读副本/缓存按需；对象存储 CDN。
3. 压测：并发 apply、重复 token、跨实例轮询、Redis 故障演练。

## 4. 验收标准

- **并发 apply**：同一 token 两个实例同时 apply，恰好一个成功，另一个返回 `PROPOSAL_NOT_FOUND`/`PROPOSAL_ALREADY_APPLIED`。
- **并发写**：同一 revision 两个实例同时写，恰好一个成功，另一个 `REVISION_CONFLICT`，无静默丢更新。
- **跨实例轮询**：实例 A 发起 generate，实例 B 轮询能读到同一会话状态并最终拿到 trip。
- **限流**：两个实例合计不得超过 `RATE_LIMITS` 配置；Redis 宕机时付费 scope 失败关闭、read 失败打开。
- **故障恢复**：kill 一个实例后，进行中的生成任务可重试/恢复，不产生半写状态。
- **迁移校验**：文件→DB 回填后逐条比对 `revision`/`hash`/`payload`；回滚开关可切回文件存储。

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 双写漂移 | 回填脚本记录 checksum；灰度期以 DB 为准并告警不一致 |
| 事务冲突率升高 | 监控 `REVISION_CONFLICT` 比例；冲突是正确性行为，不是错误 |
| Redis 成为单点 | 付费 scope 失败关闭 + 明确 503 文案；多可用区部署 |
| 生成任务重复执行 | 任务幂等键 = session id + expectedRevision；写前再校验 revision |
| 数据迁移中断 | 迁移可重入（按 workspace/id upsert），保留文件快照与回滚开关 |

## 6. 决策摘要

- **采用 Postgres 作为权威存储 + Redis 限流**，不采用“共享文件卷 + 分布式文件锁”的长期方案。
- **乐观并发（revision + hash）**替代文件锁，保持现有错误码与 API 契约不变。
- **生成任务队列化**是多实例的必要条件；短期可用粘性路由过渡，但必须承认实例重启会丢任务。
- 迁移按 `VOYAGE_STORAGE` / `VOYAGE_RATE_LIMIT_STORE` 双开关灰度，任何阶段都可回滚到单实例文件模式。
