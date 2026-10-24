# Trust 评测（Voyage 新管线 vs 纯 LLM 基线）

对 `docs/PROJECT_INNOVATION.md` §6.5 中约定的 20 条旅行任务做端到端评测，产出
`report.json` / `report.md`，并回答一个问题：**加了候选检索、证据、校验与重规划之后，
是否真的比直接问 LLM 更可靠？**

## 运行

```bash
npm run eval:trust                          # 全量 20 条
npm run eval:trust -- --limit 3 --verbose   # 冒烟
npm run eval:trust -- --only cq-001,bj-008  # 指定任务
npm run eval:trust -- --skip-baseline       # 只跑新管线
npm run eval:trust -- --no-route-check      # 跳过基线路线测量（更快）
```

需要真实环境变量：`AMAP_SERVER_KEY`（POI/路线/名称核实）与
`LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY`（baseline 与管线共用）。
脚本会从 `.env.local` 读取配置，并强制关闭 `VOYAGE_DEMO_MODE`，避免用 fixture 数据
计算“事实准确率”。

产物：

- `benchmarks/eval/trust/report.json`：逐任务明细 + 汇总指标
- `benchmarks/eval/trust/report.md`：可直接引用的对比报告
- `benchmarks/results/eval-trust.json`：与其他 eval 一致的摘要文件
- `report.partial.json`：运行中断时的检查点（完成后删除）

## 两条被测系统

**Voyage 新管线**：高德实时 POI 候选 → LLM 只做排序/排程 → `repairOutlineForTrust`
确定性修复 → `validateTripTrust` 校验 → `propose-trust-replan` / `apply-change`
重规划闭环。每个 stop 都带来源证据。

**纯 LLM 基线**：单次 `chatJson` 调用，凭模型知识直出 JSON 行程，不提供候选池、
不提供地图、不提供校验器。生成后把它给出的地点逐个拿到高德按名称核实。

## 指标

| 指标 | 定义 |
|---|---|
| 事实准确率 | 新管线：stop 对应证据卡 `real=true`（高德来源）的比例；基线：stop 的地点名能在高德检索到的比例 |
| 地址可用率 | stop 是否提供了地址；**不衡量地址逐字正确** |
| 同日重复地点率 | 同一天内重复出现的地点项 / 总 stop 数 |
| 正餐覆盖率 | 有午餐或晚餐的天数 / 期望天数 |
| 每天平均 stop 数 | 总 stop 数 / 天数 |
| 约束满足率 | 天数、每天 ≥N 个 stop、正餐、无同日重复、最大交通时间、预算全部满足的任务占比 |
| 校验通过率 | `validateTripTrust` 无 error 的任务占比 |
| 重规划成功率 | 有可修复问题时，应用提案后问题数下降且未发明地点；无提案（不可自动修复）不计入分母 |
| 生成时延 | 端到端生成耗时（p50/p95），不含评测侧的名称核实与路线测量 |

## 公平性与已知局限

- 管线拿到真实候选池，基线没有；这正是要量化的差距，不是实现细节。
- 基线的事实准确率依赖“高德按名称检索 + 归一化匹配”，同名连锁店或俗称可能误判，
  因此基线可能被高估或低估；未匹配的地点会列在报告的“编造/未核实地点”一节。
- 地址指标只检查是否提供了地址，不校验逐字正确。
- 预算口径不同：管线用产品内置估算（约预算的 85% 再分项），基线用模型自报的
  stop 花费之和，仅作趋势参考。
- 天气取运行时实时数据，不同日期重跑会有差异；其余输入固定（`startDate` 固定）。
- 所有 LLM 调用共享同一模型与温度（管线 `temperature=0.2`，基线 `chatJson` 默认）。
