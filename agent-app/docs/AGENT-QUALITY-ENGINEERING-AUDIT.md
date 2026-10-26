# Agent Quality Engineering · 源码审计报告（Phase 0）

> 对应任务：看板 #4dc2361a（父）/ b9b15212（Phase 0）
> 审计日期：2026-10-26 · 工作区：`main@4c6a0d6`（变更未提交；任务绑定分支 `feat/agent-quality/phase-0-audit`，提交时切出）
> 审计范围：`agent-app/`（pnpm + turbo monorepo），引擎位于 `agent-app/packages/engine/src/`
> 方法约束：所有结论以源码阅读 + 实际运行命令为证据，未采信 README/注释/类型定义单独作为完成依据（README 仅作索引）。

---

## 一、盘点总表（§3.2 十项检查）

| #   | 检查项       | 状态（五态）                    | 一句话结论                                                                           |
| --- | ------------ | ------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Evaluation   | ✅ 已实现且有测试证明           | 76 例三档评测真实存在并实测通过；CI 仅 Tier 1 门禁，Tier 2/3 依赖 key                |
| 2   | Judge        | ✅ 已实现且有测试证明           | rubric 二元判定 + fail-closed 解析 + 负例校准；本轮 8/8 真实模型调用通过             |
| 3   | Trace        | ⚠️ 部分实现                     | 图标行 stderr 观测可用，但无 runId/事件结构/脱敏/持久化，远达不到 §6 统一事件模型    |
| 4   | Verification | ❌ 未实现                       | 无 verification/ 目录，无独立于模型自述的结果验证；「执行成功 ≠ 验收通过」语义不存在 |
| 5   | Orchestrator | ✅ 已实现且有测试证明           | 显式状态机 + 失败四分支 + 预算 + 断点续跑，30 例离线测试；取消并发场景未覆盖         |
| 6   | Guardrails   | ✅ 已实现且有测试证明（附条件） | 两闸一门完整；但默认全关、CLI 仅包 MCP 工具、API INPUT 闸默认关                      |
| 7   | Baseline     | ✅ 已实现且有测试证明（附条件） | 3% 容差/通过率零容差/stale 检测齐全；但基线是本地 gitignored 文件，CI 不比对         |
| 8   | CI           | ⚠️ 部分实现                     | agent-app.yml 有真门禁，但 **engine 287 例 + cli 11 例测试不进 CI**；基线不进 CI     |
| 9   | Reliability  | ⚠️ 部分实现                     | 超时/取消/重试/幂等零件齐全且各有测试；缺 §9.1 要求的故障注入穷举矩阵                |
| 10  | Security     | ⚠️ 部分实现                     | 注入/PII/审批/审计日志有实现有测试；红队脚本是 ad-hoc 未接门禁；trace 无脱敏         |

> 状态口径：已实现且有测试证明 / 已实现但缺少测试 / 部分实现 / 未实现 / 尚未验证。

---

## 二、逐项详述（现状 → 证据 → 缺口）

### 2.1 Evaluation —— 已实现且有测试证明

**现状**：自建三档评测框架（刻意未引 promptfoo/DeepEval）。

- 数据集：`agent-app/packages/engine/src/evals/dataset.ts`（18 离线 = 10 轨迹 + 8 路由；8 评审）、`corpus.ts`（10 文档 + 50 检索查询），`EVAL_DATASET_VERSION = "3"`。合计 **76 例**（与 `.data/eval-report.json` 的 totals.total=76、历史全绿记录一致）。
- 运行器：`evals/runner.ts`——单例失败不炸整轮（错误变该例 FAIL）、Tier 2/3 按 key 三态门控（skipped ≠ failed，退出码不受跳过影响）、检索套件管道级异常整体转 skipped、vitest 进程内门控套件缺席。评分器：`scorers/trajectory.ts`（逐位比对 + 空序列特判）、`routing.ts`（checkHardRules 纯函数）、`retrieval.ts`（Recall@k / MRR）、`judge.ts`。
- 报告：`evals/report.ts` 落盘 `.data/eval-report.json`（机器可读，含 datasetVersion/durationMs/per-case）。
- 实测证据（本次审计运行，agent-app 目录）：`pnpm eval` → **26 例执行全绿（18 Tier1 + 8 judge），50 条检索整体 skipped**（embedding 网关余额不足，跳过原因含中文修复指引），退出码 0。
- 测试证据：`packages/engine/test/evals.spec.ts`（43 例）覆盖全部评分器、runEvals 跳过/注入路径、数据集完整性（引用不存在的 docId 在 vitest 直接标红）。

**缺口（对应 PRD §7/§8）**：

1. 评测维度缺安全性/可靠性/效率维度（§7.2 仅部分覆盖：轨迹≈工具质量与轨迹质量、检索质量已覆盖）。
2. 数据集治理字段不全：无风险等级、来源、审核状态、独立 datasetId（§8.3）；dataset 是 TS fixture，git 即版本但无治理元数据。
3. 报告缺评测器版本、Agent/Prompt/模型配置标识（§7.4）。
4. Tier 2/3 在 CI 永远缺席（CI 无 key），真实模型评测只发生在本地有 key 机器。

### 2.2 Judge —— 已实现且有测试证明

**现状**：`evals/scorers/judge.ts`——rubric 二元判定（不打数字分）、编号列表防位置偏差、「宁可误杀」协议写死 system prompt、严格 JSON 指令 + `extractJson` 宽松解析（解析失败/形状不对一律 pass=false，fail-closed）、temperature 0、复用生产 `getModel()`；`JudgeFn` 注入缝支持零网络单测。数据集含 2 条负例（judge-07 编造政策 / judge-08 纯客套话）用于校准「好好先生」。

**实测证据**：本次 `pnpm eval` 中 judge 套件走**真实 GLM 模型调用**（8 例 14.6s）全部通过——负例被真实模型判为不通过，校准成立。

**测试证据**：`packages/engine/test/evals.spec.ts`（43 例）覆盖 `scoreJudge` 判定一致性比对、`buildJudgePrompt` 纯函数内容断言、评审数据集完整性（EVAL_JUDGE_CASES）与评审套件跳过/注入路径。

**缺口**：rubric 内嵌 dataset 无独立版本化资产（§7.3.1 部分满足：随 datasetVersion v3）；judge 输入不含验证证据（Verification 未实现所致，§7.3.3）；校准集仅 8 例，规模小。

### 2.3 Trace —— 部分实现

**现状**：`packages/engine/src/trace.ts`（65 行）——`AGENT_TRACE=1`/`--trace` 开关、icon 行打 stderr、`preview()` 截断 200 字符、`AGENT_LOG_FORMAT=json` 时输出 `{time, icon, event}` JSON 行。

**测试证据**：`apps/cli/src/selftest.ts`（轨迹开关状态与 `preview` 截断用例）、`packages/engine/test/structured-log.spec.ts`（json 模式结构化轨迹行为）。

**证据**：agent-loop.ts / supervisor / rag / orchestrator 全部经 `trace(icon, msg)` 打点；selftest 有轨迹开关用例；README 有图标约定表。

**缺口（对照 PRD §6.2 统一事件模型）**：

1. 无 `eventId/runId/traceId/parentRunId/stepId/attempt/durationMs/status/attributes` 字段——事件无法关联到 Run，重试次数无结构化记录。
2. 无脱敏策略：trace 原样打印工具入参出参（仅长度截断），API Key/PII 若出现在参数中将明文进日志（§6.3.6 违反）。
3. 无持久化与记录失败策略：进程内 stderr，无声丢失风险（§6.3.8）。
4. Token/成本：`ToolLoopResult.usage` 有 totalTokens（网关不回传时 undefined，未伪造为零——这条符合 §6.3.7），但无成本估算、无聚合指标（§6.4 全缺）。
5. 事件类型清单（run._、llm.request._、retry._、verification._、subrun.*、guardrail.triggered）均无对应结构化事件；guardrail 拒绝只有 `.data/audit.log` JSONL（H10 场景）。

### 2.4 Verification（结果验证）—— 未实现

**现状**：无 `packages/engine/src/verification/` 目录（glob 证实）。全库无「独立于模型自述的结果验证」实现：

- `runToolLoop` 返回 `ToolLoopResult{text, messages, steps, usage}`——执行成功即返回，无验收概念；
- Orchestrator 的验收闭环（`reviewing` 态 critic contains/llm-judge/manual）是**编排内子任务验收**，不是 §5 要求的 Run 级 Outcome Verification，且不可脱离编排器单独复用；
- 「Agent 声称完成但实际失败」「执行成功但验收失败」两种情况当前无法表达和统计（§4.3）。

**目标架构差异**：Phase 1 需新建 verification 模块 + Run 数据契约（RunOutcome / VerificationResult 分离），并把验证点挂到 agent-loop / orchestrator 的执行出口。

### 2.5 Orchestrator —— 已实现且有测试证明

**现状**：`packages/engine/src/orchestrator/`（Effect 版）。已核实 `types.ts` 的 `TASK_TRANSITIONS` 迁移表：

```text
pending → planning|executing|failed|escalated
planning → executing|failed|escalated
executing → reviewing|failed|escalated|compensated
reviewing → done|executing|failed|escalated
done → executing          （断点续跑：追加子任务后继续）
failed → executing        （重试整次编排）
escalated → []            （终态，人工裁决后换新 id 重开）
```

配套：`policies.ts` RetryPolicy（指数退避 + 全抖动）与失败四分支、`state-store.ts` StateStore 接口 + transition 守护、per-task `maxDurationMs`（Effect.timeout）/ `maxTokens` 预算、验收闭环（manual→escalated 终态；contains/llm-judge 不达标打回）。

**测试证据**：`packages/engine/test/orchestrator.spec.ts` **30 用例**（失败策略四分支、失败终态落盘与重入、预算、TestClock 虚拟时钟、断点续跑），全部离线；**并行派发亦有覆盖**——「循环依赖：dispatch 前拒绝（有环的 DAG 无法完成）」与波次间预算检查（两任务并行消耗预算，orchestrator.spec.ts:203/370/427）。另有 `apps/api/test/team.e2e-spec.ts`（4 例 SSE 编排 e2e）、`apps/cli/test/team.spec.ts`（11 例桩角色离线全链路）。

**缺口**：取消类场景（重复取消请求、取消与正常完成并发、子任务取消传播）无专项测试（§9.1）；StateStore 仅有内存实现（状态持久化失败场景无测试）；无结构化事件流持久化（事件只在 trace stderr）。

### 2.6 Guardrails —— 已实现且有测试证明（附条件）

**现状**：`packages/engine/src/guardrails/`——`pii-mask.ts`（手机/身份证/银行卡三正则，环视边界锁死，身份证→手机→银行卡顺序裁决）、`validate.ts`（零宽/全角规范化 + 5 条注入黑名单 + leet 字符类容忍 + 白名单解析）、`gate.ts`（`wrapToolWithGate` 五步编排：白名单→输入闸→确认→原 execute→输出闸；拒绝走结构化 `{denied, reason}` 不抛错）。人工确认双实现：CLI readline y/n（fail-closed）与 API SSE 审批（`apps/api/src/chat/tool-approval.ts`，60s 超时自动拒绝）。

**测试证据**：`test/guardrails.spec.ts`（37 例）、`test/hardening.spec.ts`（16 例：H1 入库闸、H7 RAG 围栏+数据性声明、H10 审计日志、E3 伪装系统指令）、`test/pii-mask-detectors.spec.ts`（6 例）、`apps/api/src/chat/tool-approval.spec.ts`（13 例，含 approval.timeout）、API e2e `llm-injection-scan.e2e-spec.ts`（9 例 LLM 语义自检）、`security.e2e-spec.ts`（helmet + 限流）。

**附条件与缺口**：

1. **默认全关**：`AGENT_GUARD_*`（PII/ALLOWLIST/CONFIRM/INPUT/MCP_STRICT/LLM_SCAN）不配置即零变化——真实执行链路默认无护栏（§10.2.1「安全控制应放在真实执行边界」打折）。
2. CLI 侧只对 **MCP 来源工具**套闸，本地工具不套（设计取舍已文档化）。
3. Guardrails 触发无统一结构化事件（只有 H10 场景写 `.data/audit.log` JSONL；gate 拒绝未发事件，§10.2.3 缺）。
4. 工具结果注入（工具返回内容夹带指令）无专项测试。

### 2.7 Baseline —— 已实现且有测试证明（附条件）

**现状**：`evals/baseline.ts`——`BASELINE_TOLERANCE = 0.03`（显式常量）；套件级聚合快照（passed/total/avgScore）；**通过率下降零容差即回归**；avg score 跌幅 >3% 即回归；数据集版本不一致 → stale 提示不拦退出码；只比对两边都有的套件；基线文件损坏显式报错（不做类型断言逐字段校验）。eval CLI：`--update-baseline` 生成；每轮自动比对，`[REGRESSION]` + 退出码 1。

**测试证据**：`evals.spec.ts` 覆盖 buildBaseline/compareBaseline/saveBaseline/loadBaseline。

**附条件与缺口**：基线是 `agent-app/.data/eval-baseline.json`（**gitignored 本地文件**），CI 不带基线也不比对（agent-app.yml 注释明示）——「团队共享回归门禁」不成立（§8.1.3 更新可追溯=仅 savedAt；无审核流）。当前基线内容：v3，trajectory 10/10、routing 8/8、retrieval 50/50（avg 0.99）、judge 8/8。

### 2.8 CI —— 部分实现

**现状**（`.github/workflows/`，仓库根；agent-app 无独立 .github）：

| Workflow        | 内容                                                                                                                           | 门禁性质                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `agent-app.yml` | job test：install→build→typecheck→lint:deps→selftest→`pnpm --filter @agent-app/api test`；job evals：install→build→`pnpm eval` | 全部是真门禁（失败拦合并）；evals 拦 Tier 1 的 18 例确定性用例       |
| `audit.yml`     | `pnpm audit --audit-level high`（根 + agent-app），push main + 每周 cron                                                       | 对自身 workflow 是门禁，对 Pages 部署仅报告（注释明示不阻塞 deploy） |
| `deploy.yml`    | VitePress build + Pages 发布                                                                                                   | build 仅作为部署前置门禁                                             |

**关键缺口**：

1. **engine vitest 套件（26 文件 / 287 例，其中 26 例 infra 门控）与 cli 测试（team.spec 11 例）不进 CI**——CI 只对 api 的 94 例跑 vitest；engine 测试仅被 typecheck 的 `tsconfig.test.json` 静态检查。`pnpm verify`（含 test:engine）只在本地跑。
2. 基线比对不进 CI（见 2.7）。
3. CI 无质量门禁聚合概念（passed/failed/inconclusive 三态不存在，§12）。
4. `skipped` 展示：eval 输出会打印跳过原因（未伪装成功，符合 §16 要求）。

### 2.9 Reliability —— 部分实现

**已有（零件级，均有测试）**：

- 模型调用超时/重试：`llm.ts llmCallPolicy`（`AGENT_LLM_TIMEOUT_MS` AbortSignal.timeout + `AGENT_LLM_MAX_RETRIES` SDK 传输层指数退避 429/5xx；`AbortSignal.any` 合并调用方 signal）——`test/llm-policy.spec.ts` 6 例。
- 取消：`agent-loop.ts` AbortSignal（步间检查 + 透传 generateText + `ToolLoopAbortedError` 类型化错误）——`test/agent-loop.spec.ts` 7 例 + API D2 系列（断开静默、token 流中断、不回写半截答案）。
- 应用层重试：supervisor JSON 不合规换提示词重发一次；orchestrator RetryPolicy（指数退避+全抖动）。
- 步数保险丝：`DEFAULT_MAX_STEPS=5`，耗尽抛错（明确失败，不无限重试）。
- 幂等：`tools/idempotency.ts` + Redis 实现（SET NX PX），`idempotency.spec.ts` 14 例 + `infra.idempotency-redis.spec.ts` 9 例（RUN_INFRA_TESTS 门控）。
- 编排故障：orchestrator 30 例（子任务失败四分支、超时 Effect.timeout、恢复重入）。

**缺口（对照 §9.1 必测场景）**：工具执行超时/进程中断、重复取消请求、取消与正常完成并发、等待模型响应期间取消（步间 vs 请求中两个时机中后者只有 API 层测试）、恢复后重复调度、状态持久化失败、非幂等副作用重放——多数无专项测试。重试策略无独立套件（仅 env 解析 + 依赖 SDK 内置行为）。

### 2.10 Security —— 部分实现

**已有**：注入扫描（规范化三层 + 5 模式 + leet 容忍）、RAG 围栏与「数据性声明」系统提示、API LLM 语义自检（9 e2e）、PII 脱敏 + 自定义检测器扩展、审计日志 JSONL（H10：追加写/不抛错/路径注入防护）、API 工具审批（名单默认 createTicket、60s 超时拒绝、跨会话不误唤醒）、helmet + 全局限流、MCP strict 模式开关。红队脚本 5 个（`agent-app/scripts/redteam-*.mjs`），产物见 `.data/rt-*.log` 与 `.data/audit.log`（含真实 gate.denied / ingest.rejected 记录）。

**缺口**：

1. 红队脚本 **ad-hoc**：不在 package.json scripts、不进 CI、无退出码门禁（§10.2.5 缺）。
2. trace/日志无脱敏（PII 或秘密可经工具参数进 stderr，§6.3.6 与 §10.1「秘密泄漏」测试缺）。
3. 工具结果注入、越权参数/资源访问、白名单绕过（模型侧）无专项用例。
4. 安全失败未接发布门禁（Quality Gate 不存在）。

---

## 三、缺失能力清单（映射到实施 Phase）

| 缺失能力                                                          | PRD 依据 | 归属 Phase      | 现有可复用基础                                                                    |
| ----------------------------------------------------------------- | -------- | --------------- | --------------------------------------------------------------------------------- |
| Run 统一数据契约（runId/attempt/终态机/RunOutcome）               | §4       | Phase 1         | orchestrator TASK_TRANSITIONS 的状态机范式、ToolLoopResult、EngineError 体系      |
| Verification 模块（Verifier 契约 + Runner + 确定性验证器）        | §5       | Phase 1（全新） | fixtures 的确定性工具、guardrails 的 wrap 模式、JudgeFn 注入缝范式                |
| 统一事件模型（AgentRunEvent 字段 + 事件类型清单）                 | §6.2     | Phase 2         | trace.ts 出口（改造成本低：单文件 65 行）、logger JSON 模式、audit.log JSONL 先例 |
| 敏感信息脱敏（trace 层）                                          | §6.3.5/6 | Phase 2         | pii-mask.ts 直接复用                                                              |
| 观测指标（成功率/延迟分位/失败率/Token 成本）                     | §6.4     | Phase 2         | eval-report 聚合范式可参考                                                        |
| 评测维度补齐（安全/可靠性/效率）+ 报告字段（评测器版本/配置标识） | §7.2/7.4 | Phase 3         | EvalReport 可选字段扩展先例（metrics/skipReasons）                                |
| Rubric 版本化 + Judge 输入含验证证据                              | §7.3     | Phase 3         | judge.ts 注入缝                                                                   |
| 基线进 CI / 团队共享 + 数据集治理字段                             | §8       | Phase 3         | baseline.ts 已显式讨论该局限（提交 git 仅需改 .gitignore 一行）                   |
| Quality Gate（三态判定 + 规则与执行分离 + 可解释输出）            | §12      | Phase 4（全新） | baseline violation 模型（stale 标记先例）、eval CLI 退出码                        |
| CI 补 engine/cli 测试 + 门禁聚合 job                              | §16      | Phase 4         | 现有 agent-app.yml 双 job 结构                                                    |
| 可靠性故障注入矩阵                                                | §9       | Phase 4         | orchestrator TestClock、fixtures 剧本模型、JudgeFn/RetrievalEvalDeps 注入范式     |
| 安全用例接入门禁 + 红队脚本退出码化                               | §10      | Phase 4         | redteam-*.mjs 现成脚本                                                            |
| Experimentation（实验配置入口 + 多次运行比较）                    | §11      | Phase 5         | eval CLI + datasetVersion 机制                                                    |
| 反馈闭环（失败案例候选区 + 审核流）                               | §13      | Phase 5         | audit.log / eval-report 失败记录可作来源                                          |

---

## 四、目标架构与实际代码差异（§3.3.3 声明）

| PRD 目标                                                       | 实际代码                                     | 差异处理建议（兼容优先）                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `AgentRunEvent` 结构化事件                                     | trace.ts 图标行                              | **扩展 trace.ts 而非重写**：保留 icon 行为 text 模式，新增结构化事件通道（json 模式已有先例），既有调用方零改动 |
| Run 状态机 queued/running/succeeded/failed/cancelled/timed_out | 引擎层无 Run 概念；orchestrator 有自己的八态 | 新建 Run 契约时**不并入** orchestrator 状态（两套语义不同层级）；提供映射说明即可                               |
| `packages/engine/src/verification/`                            | 不存在                                       | 按建议结构新建，但文件数按需精简（避免空壳模块）                                                                |
| Quality Gate 可放 `quality/` 或 evals 内                       | evals 已有 baseline（ violation 模型）       | **放 evals 内扩展**（baseline 是 gate 的输入之一），避免新顶层目录                                              |
| `pnpm eval`/`pnpm verify` 兼容                                 | 两命令均为既有入口且实测可用                 | 全程保持脚本名不变，新增能力以参数/新脚本补充                                                                   |
| 76 例数据集保留                                                | 实测存在且全绿                               | 不动 dataset.ts/corpus.ts 现有用例；新增用例追加                                                                |

## 五、文件修改计划（按 Phase，供后续子任务直接引用）

- **Phase 1**：新增 `packages/engine/src/verification/`（types/verifier/runner/registry/index 按需）、`src/run-contract.ts`（或并入 types.ts）；改 `agent-loop.ts`（出口挂验证点）、`orchestrator/defaults.ts`（验收 critic 对接 Verification，可选）；新增 `test/verification.spec.ts`、`test/run-contract.spec.ts`。
- **Phase 2**：改 `trace.ts`（结构化事件 + 脱敏钩子）；新增 `src/telemetry/`（或并入 trace.ts，按规模定）；改 `agent-loop.ts`/`llm.ts`/`orchestrator.ts` 补事件点；新增 `test/trace-events.spec.ts`、`test/trace-redaction.spec.ts`。
- **Phase 3**：改 `evals/{types,report,dataset,scorers/judge}.ts`（评测器版本、配置标识、新维度评分器）；改 eval CLI（门禁聚合输入）；改 `.github/workflows/agent-app.yml`（补 engine/cli 测试 job）；`.data/eval-baseline.json` 是否进 git 需人工确认（涉及敏感数据审查）。
- **Phase 4**：新增 `evals/quality-gate.ts`（或 `src/quality/`）；改 CI（门禁 job）；新增 `test/quality-gate.spec.ts`、`test/reliability-*.spec.ts`（故障注入矩阵）；redteam 脚本包一层带退出码的 runner。
- **Phase 5**：新增 `evals/experiments.ts` + 失败案例导出（`evals/failure-cases.ts`）；文档与 .data 约定更新。

## 六、测试计划

1. **不删任何现有测试**；现有 40 个 spec 文件（≈392 例）全部保留并持续运行。
2. 新增测试一律离线优先：复用既有注入缝（剧本模型 / JudgeFn / RetrievalEvalDeps / 确定性夹具工具），无 key 机器可全绿。
3. Phase 1–5 各阶段新增单测 + 契约测试外，按 PRD §15.3 补 10 条集成路径（现有覆盖：路径 1 部分、3 部分；缺失：2/4/5/6/7/8/9/10 的端到端断言）。
4. 测试失败区分三类：代码缺陷 / 环境问题（如本次 embedding 余额不足）/ 缺外部凭据——遵循既有 skipped 语义。

## 七、实施规则确认（§3.3）

1. 已有能力优先补齐：Evaluation/Judge/Baseline/Orchestrator/Guardrails 全部原地扩展，不重建。
2. 已有接口优先扩展：trace.ts、EvalReport（可选字段先例）、eval CLI 参数面。
3. 与 PRD 冲突处已在上表「差异处理建议」声明（最重要的是：Run 状态机与 orchestrator 状态机分层并存，不合并非 renaming）。
4. 不新增外部服务依赖：OpenTelemetry 第一阶段不引入（§6.5）；观测先做内部结构化事件。
5. 本报告与 `AGENT-QUALITY-ENGINEERING.md` 一并保留作为验收依据。

## 八、本次审计实际执行的命令与结果（2026-10-26）

| 命令（cwd=agent-app） | 结果                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm eval`           | 76 例：26 执行全绿（traj 10/10、routing 8/8、judge 8/8 真实模型 14.6s）、50 skipped（embedding 余额不足，中文指引明确）；报告落盘 `.data/eval-report.json`；退出码 0                                                            |
| `pnpm verify`         | typecheck 7/7 包通过 → engine vitest **261 passed / 26 skipped**（21 文件过 / 5 infra 文件跳过）→ api vitest **94 passed**（13 文件）→ selftest 13/13 → examples tsc 通过 → dependency-cruiser **101 模块 / 302 依赖 / 0 违规** |

环境备注：`.env` 配有有效 chat key（judge 真实调用成功）；embedding 配额耗尽（Tier 2 检索套件本轮无法真实运行）——后续 Phase 3 验收若需 Tier 2 真跑，需人工充值或换网关。

## 九、结论

现有基础比 PRD 预期更扎实：评测、护栏、编排、基线四大件「已实现且有测试证明」，且工程哲学（离线优先、确定性优先、跳过≠失败、拒绝即数据）与 PRD 高度同构。真正的缺口集中在三处：**① Verification 完全缺失（Phase 1 核心）；② Trace 无结构化事件与脱敏（Phase 2）；③ 质量门禁与 CI 覆盖不完整（Phase 3/4）**。按既定 Phase 1→5 串行推进即可，无破坏性重构风险点。
