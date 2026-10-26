# Agent Quality Engineering · 实施文档（v0 骨架）

> 对应任务：看板 #4dc2361a（父）
> 本文档是质量工程体系的**正式实施文档**，与 [AGENT-QUALITY-ENGINEERING-AUDIT.md](./AGENT-QUALITY-ENGINEERING-AUDIT.md)（Phase 0 审计报告）配对保留，作为后续验收依据。
> 状态标注：🟦 待 Phase N 填充。

---

## 1. 目标与范围

在 `agent-app` 现有架构（Agent Engine / Evaluation / Guardrails / Trace / Orchestrator）基础上补齐质量闭环：结果可验证、过程可追踪、能力可评估、故障可复现、版本可比较、发布有门禁、改进有闭环。不重写 Agent 框架。

现状基线见审计报告「盘点总表」——四大件（评测/护栏/编排/基线）已实现且有测试（护栏与基线为「附条件」：护栏默认全关、基线不进 CI），缺口集中于 Verification（无）、结构化 Trace（弱）、Quality Gate 与 CI 覆盖（不完整）。

## 2. 总体架构（🟦 待 Phase 2 收敛后补架构图）

逻辑依赖方向（与 PRD §2.2 一致）：

```text
Agent Engine ─┬─ Trace / Run Events（Phase 2 扩展 trace.ts）
              ├─ Verification（Phase 1 新建 verification/）
              ├─ Guardrails（已有，默认关闭待评估）
              └─ Orchestrator（已有）
Evaluation（已有 evals/，Phase 3 补维度）←─ Run Results + Trace Summaries + Verifier Results
Quality Gate（Phase 4，落 evals/ 内）←─ Evaluation + Baseline + Reliability + Security
```

## 3. 统一数据契约（🟦 待 Phase 1 填充）

- Run 标识体系：runId / parentRunId / taskId / agentId / stepId / attempt / traceId / datasetId / caseId
- Run 状态机与既有 orchestrator 状态机的分层关系
- RunOutcome 与 VerificationResult 分离保存
- 兼容性映射（pending/completed 等既有状态的处置）

## 4. Outcome Verification（🟦 待 Phase 1 填充）

- Verifier 契约与 VerificationRunner
- 第一批确定性验证器及选择依据
- 验证状态判定规则（passed/failed/inconclusive）

## 5. Observability & Tracing（🟦 待 Phase 2 填充）

- 事件模型（AgentRunEvent）与 trace.ts 的兼容扩展方案
- 脱敏策略（复用 pii-mask）
- 观测指标口径（分母/窗口/排除规则）

## 6. Evaluation & Regression（🟦 待 Phase 3 填充）

- 评测维度补齐清单、Judge 加固点
- 报告字段扩展（评测器版本/配置标识）
- 基线共享策略（进 git 与否，需人工确认）与数据集治理

## 7. Quality Gate & Reliability（🟦 待 Phase 4 填充）

- 门禁规则表（passed/failed/inconclusive 判定依据）
- CI 分层（PR 必跑 / 按需）与 engine/cli 测试补入 CI
- 可靠性故障注入矩阵覆盖表

## 8. Experimentation & Feedback Loop（🟩 Phase 5 已落地第一版）

**第一版口径（PRD §11/§13 原文）**：不建完整实验平台，实现「可重复运行、配置留档和结果比较」。

- **实验台账**（`src/evals/experiments.ts`）：`runExperimentRepeats({ repeat, maxRuns })` 驱动评测重复 N 轮（默认 1，预算上限 5），每轮重算 `buildConfigId()` 留档「实际跑了什么配置」；跨轮聚合 passRate 均值/样本标准差/95% 置信区间（正态近似，n<2 无区间——随机性任务不凭单次运行下结论）、失败归因（caseId → 失败轮数）与 P50/P95 延迟（nearest-rank）。repeat 超预算 → 正好跑 maxRuns 轮并标 `stopReason="budget-exhausted:maxRuns"`（§11.3 超限明确停止）。记录追加进 append-only 台账 `.data/experiments.jsonl`（坏行容错跳过；写失败只警告不炸评测）。
- **报告比较**：`compareReports(a, b)` 出套件级 delta 行 + 用例级 newlyFailing/newlyPassing 翻转；基准组比较 = `compareReports` + 既有 `compareBaseline`（baseline.ts 的套件级基线口径，不重复实现）。
- **失败案例候选区与审核流**（`src/evals/failure-cases.ts`，PRD §13 反馈闭环）：

```text
评测失败（passed=false，含 errored）
   │  pnpm eval --export-failures
   ▼
候选区 .data/failure-candidates.jsonl（candidateId=内容哈希，PII 已脱敏，重复导出自动去重）
   │  pnpm eval --list-failures → 人工逐条裁决
   ▼
--approve-failure <id> --reviewer <人> ／ --reject-failure <id> --reviewer <人>
   │  （reviewStatus 落痕：approved/rejected (by 人 at 时间)）
   ▼
转正 = 人工手工把候选题目写进 dataset.ts 并登记 governance（升版数据集）
```

**铁律（§13.3）**：Agent 代码只写候选区，dataset.ts / baseline.ts / quality-gate.ts 三个门禁对象对 Agent 代码只读——审核通过的候选也必须由人手工改正式集，不存在任何自动晋升代码路径。

- **v1 刻意不做（后续阶段）**：模型/Prompt/工具等实验变量的自动切换（v1 = 人工换配置各跑一轮，靠台账 configId + compareReports 对比）；门禁 overrides 的自动应用；自动优化候选版本管线。

## 9. 命令与 CI

现有入口（保持兼容，Phase 0 实测全绿）：

| 命令                          | 现状                                                                                                                                            | 计划                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `pnpm eval`                   | 76 例三档，Tier 1 门禁，退出码 0/1                                                                                                              | Phase 3 起增加门禁聚合输入 |
| `pnpm quality-gate`           | Phase 4：等价 `pnpm eval --gate`，质量门禁裁决退出码（FULL 策略四套件必跑；`--gate-policy ci` 切 Tier 1 预设，`--strict` 把 inconclusive 也拦） | 保持                       |
| `pnpm verify`                 | typecheck→engine/api 测试→selftest→examples→架构红线                                                                                            | 保持不变                   |
| `pnpm test:engine`            | 261+ 例（本地，Phase 5 增补实验/候选区两套）                                                                                                    | 🟦 Phase 4 补入 CI         |
| `pnpm eval --update-baseline` | 本地基线快照                                                                                                                                    | 🟦 Phase 3 评估进 git      |

**失败案例候选区 CLI（Phase 5，均为增量旗标，默认行为不变）**：

| 命令                                               | 作用                                                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm eval --export-failures`                      | 评测跑完后把失败案例（含 errored）导出进候选区 `.data/failure-candidates.jsonl`（内容哈希去重，PII 脱敏后落盘），打印新增/跳过计数 |
| `pnpm eval --list-failures`                        | 列出候选区全部候选（id / caseId / 审核状态 / 详情），不跑评测                                                                      |
| `pnpm eval --approve-failure <id> --reviewer <人>` | 审核通过一条候选（留痕审核人+时间）；通过 ≠ 转正，转正由人手工改 dataset.ts                                                        |
| `pnpm eval --reject-failure <id> --reviewer <人>`  | 驳回一条候选（留痕存档，不进正式集）                                                                                               |

**实验台账（Phase 5）**：CLI 未加实验子命令——实验经 `runExperimentRepeats()` 驱动（引擎导出），台账落 `.data/experiments.jsonl`；比较用 `compareReports()` / `compareBaseline()`。变量实验 v1 = 人工换配置各跑一轮（§8）。

## 10. 变更记录

| 日期       | 变更                                                         | 依据          |
| ---------- | ------------------------------------------------------------ | ------------- |
| 2026-10-26 | 创建骨架 + 完成源码审计（Phase 0）                           | 看板 b9b15212 |
| 2026-10-26 | Phase 5：实验台账 + 失败案例候选区与人工审核流（§8/§9 更新） | 看板 2f3c33be |
