# Agent Quality Engineering · 实施文档（v1 · 全阶段落地）

> 对应任务：看板 #4dc2361a（父）
> 本文档是质量工程体系的**正式实施文档**，与 [AGENT-QUALITY-ENGINEERING-AUDIT.md](./AGENT-QUALITY-ENGINEERING-AUDIT.md)（Phase 0 审计报告）配对保留，作为验收依据。
> 状态：Phase 0–5 全部落地（2026-10-26）；各节标注落地提交所在分支链（串行：phase-0 → … → phase-5 → final-acceptance）。

---

## 1. 目标与范围

在 `agent-app` 现有架构（Agent Engine / Evaluation / Guardrails / Trace / Orchestrator）基础上补齐质量闭环：结果可验证、过程可追踪、能力可评估、故障可复现、版本可比较、发布有门禁、改进有闭环。不重写 Agent 框架。

现状基线见审计报告「盘点总表」——四大件（评测/护栏/编排/基线）已实现且有测试（护栏与基线为「附条件」：护栏默认全关、基线不进 CI），缺口集中于 Verification（无）、结构化 Trace（弱）、Quality Gate 与 CI 覆盖（不完整）。

## 2. 总体架构（已落地）

逻辑依赖方向（与 PRD §2.2 一致，全部实现）：

```text
Agent Engine ─┬─ Trace / Run Events（src/telemetry/，trace.ts 保留为人类可读出口，零改动）
              ├─ Verification（src/verification/，Phase 1 新建）
              ├─ Guardrails（已有 + Phase 2 加 emitEvent 发射缝）
              └─ Orchestrator（已有 + Phase 4 修复失败路径回写/续跑入度两处缺陷）
Evaluation（src/evals/，Phase 3 补治理/维度/报告字段）←─ Run Results + Trace Summaries + Verifier Results
Quality Gate（src/evals/quality-gate.ts，Phase 4）←─ Evaluation + Baseline + Reliability + Security
Experimentation / Failure candidates（src/evals/experiments.ts、failure-cases.ts，Phase 5）
```

## 3. 统一数据契约（✅ Phase 1 落地）

- `src/run-contract.ts`：`RunIdentifiers`（runId/parentRunId/taskId/agentId/stepId/attempt 从 1 起/traceId/datasetId/caseId）；`RunStatus` 六态（queued/running/succeeded/failed/cancelled/timed_out）；`RUN_TRANSITIONS` 数据表 + `assertRunStatusTransition`（终态不可被改写、同终态幂等放行，非法迁移抛 `RunStatusTransitionError`）；`RunOutcome`（status 收窄终态，**succeeded ≠ 验收通过**已成文）。
- 与 orchestrator 八态状态机**分层并存、互不收编**（头注释文档化）。
- `RunOutcome` 与 `VerificationResult` 分离返回/保存（`runWithVerification` 返回两者）。

## 4. Outcome Verification（✅ Phase 1 落地）

- `src/verification/`：`Verifier` 契约（id/version/required 缺省 true/verify 纯确定性）+ `VerificationRunner`（聚合规则：必查 failed→failed 一票否决；验证器抛错/空清单/skipped→**inconclusive 绝不默认通过**且落账不吞错；可选只落账永不翻转）+ 注册表。
- 内置验证器：Schema（Zod）/ ToolExecution（不信任自述，只看轨迹）/ Artifact（只读 fs，ENOENT→failed、其余 fs 错误→inconclusive）。
- 集成接缝：`runWithVerification()`（agent-loop 零改动，onStep/onEvent 链式转发）。

## 5. Observability & Tracing（✅ Phase 2 落地）

- `src/telemetry/`：`AgentRunEvent` 模型（19 型事件目录）+ `createRunEventRecorder`（内存总账为真源、sink 抛错降级不丢事件、ingest 去重+空关联键补挂）+ `redactEvent`（秘密 KEY/sk-/Bearer 模式 + maskPii 复用，默认开启）+ `computeRunMetrics`（分母规则成文：成功率排除 cancelled、cancelRate 全终态分母、0/0→undefined 不伪造零）。
- 发射接缝全部 additive-optional：agent-loop `onEvent?`（llm.request._/tool.call._）、runWithVerification（run._/verification._ + 终局映射）、gate `emitEvent`（guardrail.triggered）。
- 兼容：text 模式逐字节不变；JSON 模式保留；`AGENT_TRACE=1`/`--trace` 不变；retry._/subrun._ 目录占位、发射延迟（无数据→undefined 不误报）。

## 6. Evaluation & Regression（✅ Phase 3 落地）

- 治理：`src/evals/governance.ts`（datasetId、7 维维度、8 条 critical 用例一票否决、候选区机制）；效率维度 `scorers/efficiency.ts`；安全/可靠性评分器递延 Phase 4（安全链路测试落地，维度评分接入仍开放）。
- Judge：`JUDGE_RUBRIC_VERSION` 进 prompt、【验证证据】段（数据性声明栅栏）、`parseJudgeVerdict` 导出 + 错误类型对抗测试（失败不默认通过既有语义保持）。
- 报告：`evaluatorVersion` / `configId`（buildConfigId，无秘密）/ `totals.errors` 分列（skipped ≠ failed ≠ errored）。
- 基线：`getBaselineTolerance`（env 可配，默认 0.03）、configId 口径不一致→stale 提示、`criticalCaseViolations` 进 CLI 退出码。**基线文件仍在 .data（gitignored），进 git 与否待人工决策**。

## 7. Quality Gate & Reliability（✅ Phase 4 落地）

- `src/evals/quality-gate.ts`：R1–R6 规则与执行分离、FULL / CI_TIER1 双具名策略、inconclusive 绝不自动转 passed（R2 必需套件跳过→inconclusive）、每条规则输出中文判定原因、缺席可选检查→not_applicable 不假装通过。CLI `--gate/--gate-policy/--strict`；`pnpm quality-gate` 脚本 + CI evals job 接入（ci 策略）。
- 可靠性：`test/reliability.spec.ts` 故障矩阵 14 例（LLM 超时/畸形输出/步数耗尽、工具异常/超时/空结果、取消四态+重复 abort 幂等+竞态、幂等重放）；**暴露并修复 3 个真实引擎缺陷**（agent-loop 畸形入参静默透传、orchestrator 失败路径不回写产出、续跑入度不扣已完成依赖）。
- 安全：`test/security-chain.spec.ts` 5 例真实链路（注入入参 denied-as-data+事件、白名单绕过、PII 出边界打码、案例 10 密钥总账留原文/sink 副本脱敏、高危确认事件）；既有 hardening/guardrails/kb-search/API e2e 保持。

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

| 日期       | 变更                                                                                                                  | 依据          |
| ---------- | --------------------------------------------------------------------------------------------------------------------- | ------------- |
| 2026-10-26 | 创建骨架 + 完成源码审计（Phase 0）                                                                                    | 看板 b9b15212 |
| 2026-10-26 | Phase 5：实验台账 + 失败案例候选区与人工审核流（§8/§9 更新）                                                          | 看板 2f3c33be |
| 2026-10-26 | 最终收口：§3–§7 骨架填充为落地实态；CI test job 补入引擎 vitest 套件（闭掉 Phase 0 审计的「engine 测试不进 CI」缺口） | 看板 f89bb391 |
