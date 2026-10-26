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

## 8. Experimentation & Feedback Loop（🟦 待 Phase 5 填充）

- 实验配置入口与结果比较
- 失败案例候选区与审核流

## 9. 命令与 CI

现有入口（保持兼容，Phase 0 实测全绿）：

| 命令                          | 现状                                                 | 计划                       |
| ----------------------------- | ---------------------------------------------------- | -------------------------- |
| `pnpm eval`                   | 76 例三档，Tier 1 门禁，退出码 0/1                   | Phase 3 起增加门禁聚合输入 |
| `pnpm verify`                 | typecheck→engine/api 测试→selftest→examples→架构红线 | 保持不变                   |
| `pnpm test:engine`            | 261 例（本地）                                       | 🟦 Phase 4 补入 CI         |
| `pnpm eval --update-baseline` | 本地基线快照                                         | 🟦 Phase 3 评估进 git      |

## 10. 变更记录

| 日期       | 变更                               | 依据          |
| ---------- | ---------------------------------- | ------------- |
| 2026-10-26 | 创建骨架 + 完成源码审计（Phase 0） | 看板 b9b15212 |
