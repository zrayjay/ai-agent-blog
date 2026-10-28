# P0-03 源码能力矩阵

基线：`7600320`。状态定义：`implemented` = 有源码 + 有离线测试证据；`partial` = 有源码但测试/入口有缺口或依赖可选基础设施；`planned` = 仅有文档/设计；`deprecated` = 明确废弃。每行给出可复验证据路径。离线测试 = 无需密钥/网络即可在 CI 运行的测试；infra.* 套件无基础设施时自动 skip（跳过≠通过，真实环境验证见行内标注）。

## A. 引擎核心（packages/engine/src）

| 能力                                                         | 状态        | 源码                    | 公开入口                            | 测试证据                                                                        | CI                       | 对应课                 |
| ------------------------------------------------------------ | ----------- | ----------------------- | ----------------------------------- | ------------------------------------------------------------------------------- | ------------------------ | ---------------------- |
| 手写 Agent Loop（多步工具调用/终止/错误回灌/maxSteps/abort） | implemented | `agent-loop.ts`         | `@agent-app/engine`、`./agent-loop` | `test/agent-loop.spec.ts`；`test/reliability.spec.ts`；`test/hardening.spec.ts` | agent-app.yml `test` job | guide/02、reference/01 |
| LLM 网关（OpenAI 兼容/懒创建/多供应商切换）                  | implemented | `llm.ts`                | `@agent-app/engine`、`./llm`        | `test/llm-policy.spec.ts`；`pnpm selftest` 假模型                               | 同上                     | guide/01               |
| 配置（.env 手动解析/白名单）                                 | implemented | `config.ts`             | `./config`                          | `test/config-env.spec.ts`                                                       | 同上                     | guide/11               |
| 轨迹/结构化日志                                              | implemented | `trace.ts`、`logger.ts` | `./trace`、`./logger`               | `test/structured-log.spec.ts`                                                   | 同上                     | guide/10               |
| 宽松 JSON 提取                                               | implemented | `json-utils.ts`         | `./json-utils`                      | agent-loop 套件覆盖                                                             | 同上                     | guide/01               |
| Run 契约                                                     | implemented | `run-contract.ts`       | `@agent-app/engine`                 | `test/run-contract.spec.ts`                                                     | 同上                     | guide/02               |
| 领域错误                                                     | implemented | `errors.ts`             | `./errors`                          | 各套件 instanceof 分支                                                          | 同上                     | guide/05               |

## B. 能力层

| 能力                                    | 状态        | 源码                                              | 公开入口                       | 测试证据                                                                                                                                | CI                                        | 对应课                                                   |
| --------------------------------------- | ----------- | ------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| RAG（切块/嵌入/内存检索/引用拼装）      | implemented | `rag/{chunker,embedder,store.memory,retrieve}.ts` | `./rag`                        | `test/rag.contract.spec.ts`、`test/kb-search.spec.ts`、selftest                                                                         | agent-app.yml `test`                      | guide/04、reference/05                                   |
| RAG 持久化（JSON 快照库）               | implemented | `rag/persistence.ts`、`rag/ingest.ts`             | `./rag`                        | rag.contract + kb 套件                                                                                                                  | 同上                                      | guide/04、products/kb                                    |
| RAG pgvector 存储                       | partial     | `rag/store.pgvector.ts`                           | `./rag/store.factory`          | `test/infra.pgvector.spec.ts`（RUN_INFRA_TESTS=1；无 PG 自动 skip）                                                                     | 不在 CI（本地 test:infra / compose）      | guide/04                                                 |
| 三层记忆（会话/偏好/情景 + 压缩水位）   | implemented | `memory/*.ts`                                     | `./memory`、`./memory/factory` | `test/memory.contract.spec.ts`、`test/memory-factory.spec.ts`、`test/compression-watermark.spec.ts`、`test/session-concurrency.spec.ts` | agent-app.yml `test`                      | guide/03、reference/04                                   |
| 情景记忆 pgvector                       | partial     | `memory/`（pg 变体经 factory）                    | `./memory/factory`             | `test/infra.episodic-pgvector.spec.ts`（同上门控）                                                                                      | 不在 CI                                   | guide/03                                                 |
| 工具层（registry/幂等/组合壳）          | implemented | `tools/`                                          | `./tools`                      | `test/idempotency.spec.ts`、`test/compose.spec.ts`                                                                                      | agent-app.yml `test`                      | guide/05                                                 |
| 幂等 Redis 版                           | partial     | `tools/`（Redis 实现）                            | `./tools`                      | `test/infra.idempotency-redis.spec.ts`（门控）                                                                                          | 不在 CI                                   | guide/05、11                                             |
| Skills（SKILL.md 加载注入）             | implemented | `skills/`                                         | `./skills`                     | `test/skills.spec.ts`                                                                                                                   | agent-app.yml `test`                      | guide/07（规划中专题）、`.agent-skills/refund-flow` 实例 |
| MCP（client 合并工具表 + stdio server） | implemented | `mcp/`                                            | `./mcp`                        | `test/mcp-client.spec.ts`、`test/mcp-server.spec.ts`；dogfood `test/infra.mcp-readdoc.spec.ts`（门控）                                  | client/server 套件在 agent-app.yml `test` | guide/07、reference/07                                   |
| Guardrails（gate/pii/validate/audit）   | implemented | `guardrails/`                                     | 包根（`index.ts` export *）    | `test/guardrails.spec.ts`、`test/pii-mask-detectors.spec.ts`、`test/security-chain.spec.ts`                                             | agent-app.yml `test`                      | guide/06、reference/06                                   |

## C. 编排与质量

| 能力                                              | 状态        | 源码                          | 公开入口         | 测试证据                                                                          | CI                                                                  | 对应课                                |
| ------------------------------------------------- | ----------- | ----------------------------- | ---------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| Orchestrator（拆·派·跑/DAG/验收/失败四分支/预算） | implemented | `orchestrator/`（Effect 版）  | `./orchestrator` | `test/orchestrator.spec.ts`（30 离线用例）；`test/failure-cases.spec.ts`          | agent-app.yml `test`                                                | guide/09b、reference/10               |
| Verification（runner/registry）                   | implemented | `verification/`               | 包根             | `test/verification.spec.ts`、`test/verified-run-gate.spec.ts`                     | agent-app.yml `test`                                                | guide/08、11                          |
| Telemetry（events/metrics/recorder/redact）       | implemented | `telemetry/`                  | 包根             | `test/telemetry.spec.ts`、`test/telemetry-integration.spec.ts`                    | agent-app.yml `test`                                                | guide/11                              |
| Evals（76 例数据集/三档/Tier 1 CI 门禁）          | implemented | `evals/`                      | `./evals`        | `test/evals.spec.ts`、`test/evals-governance.spec.ts`、`test/experiments.spec.ts` | agent-app.yml `evals` job（Tier 1；Tier 2/3 无 key 跳过并显式留痕） | guide/08、reference/08                |
| Quality Gate（ci 策略）                           | implemented | `evals/` + cli `quality-gate` | CLI              | `test/quality-gate.spec.ts`                                                       | agent-app.yml `evals` job                                           | guide/08                              |
| Platform store（PG Task/Run/Inbox/Outbox）        | partial     | `platform/`                   | `./platform`     | `test/platform-store.infra.spec.ts`（RUN_PLATFORM_PG_TESTS=1）                    | agent-app.yml `platform-store` job（真实 PG service 容器）          | personal-agent 方案（非本期产品功能） |

## D. 应用层

| 能力                                                                | 状态        | 源码                                                   | 公开入口                               | 测试证据                                                             | CI                                       | 对应课            |
| ------------------------------------------------------------------- | ----------- | ------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------- | ----------------- |
| CLI chat REPL                                                       | implemented | `apps/cli/src/apps/chat/`                              | `pnpm chat`                            | `apps/cli` test:chat + engine 套件；selftest 13 项                   | agent-app.yml `test`（selftest）         | guide/02          |
| CLI kb / service / team / eval / mcp-server                         | implemented | `apps/cli/src/apps/{kb,service,team,eval,mcp-server}/` | `pnpm cli …`                           | service：`pnpm test:service`；其余由 engine 套件 + selftest 间接覆盖 | agent-app.yml `test`                     | guide/04、09、09b |
| NestJS API（chat/kb/service/team/SSE/审批/限流）                    | implemented | `apps/api/src/`                                        | `pnpm api`                             | 8 个 spec（vitest 单测 + e2e，引擎 mock）                            | agent-app.yml `test`（test:api）         | guide/10、20      |
| Web（Next.js：聊天/kb/客服页面 + SSE 消费 + 审批/Handoff/步骤组件） | implemented | `apps/web/app/`、`apps/web/components/`（12 组件）     | `pnpm stack:up`（compose app profile） | 无自动化测试（build + typecheck 过）                                 | agent-app.yml `build`（-r build 含 web） | guide/10、20      |
| Docker compose 全栈                                                 | partial     | `docker-compose.yml`                                   | `pnpm stack:up`                        | 无自动化断言；本地验收                                               | 不在 CI                                  | guide/11          |
| 基础设施集成（compose PG/Redis）                                    | partial     | `scripts/run-infra-tests.mjs`                          | `pnpm test:infra`                      | infra.* 六套件（需 Docker）                                          | 不在 CI                                  | guide/11          |

## E. 明确的 planned（文档存在、代码不存在）

| 能力                                                               | 文档位置                                               | 状态边界                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Personal Agent 平台（Factory/Worker/Goal/主动通知/用户自建 Agent） | `agent-app/docs/personal-agent/0*.md`                  | planned——另一仓库产品线，非本仓库功能；PR #1-3 的 platform store 是其地基，不属于本期交付承诺 |
| BullMQ 持久后台队列                                                | `agent-app/docs/personal-agent/03-QUEUE-SCHEDULING.md` | planned                                                                                       |
| RAG Hybrid/重排（BM25+向量双路）                                   | `agent-app/BACKLOG.md`                                 | planned（触发条件挂账）                                                                       |
| Skills/MCP 专题教程                                                | `agent-app/README.md` 命令表脚注                       | planned（代码已有，教程待写）                                                                 |

## 与教程声明的核对

- `how-to/MATURITY.md` 成熟度档位与上表一致（agent-loop 单实例、trace Demo、evals 单实例等）——未发现"文档声称高于实现"的情况。
- `docs/guide/12-roadmap.md` "编排器 ✅ 已实现"与 C 节一致；"一键体验 pnpm team"入口存在（apps/cli/src/apps/team）。
- `docs/products/kb|service` 所述能力与 B/D 节一致；引用编号后端生成、转人工 mock 的边界声明如实。
- 未发现 deprecated 能力。

## 证据快照命令（2026-10-28 实测）

- `cd agent-app && pnpm typecheck` exit 0
- `node scripts/p0-check.mjs` PASS
- P0-01 基线记录（baseline.md）含全量测试结果：engine 436 pass、API 94 pass、selftest 13/13、eval Tier1 pass
- CI 定义核对：`.github/workflows/agent-app.yml` 三 job（test/evals/platform-store）与上表 CI 列一致

## 已知缺口（移交后续任务）

1. `agent-app/README.md:88` 与 `ARCHITECTURE.md` 第 3 节目录树仍写 "web/ 占位"——与 D 节 implemented 矛盾（F2-1），P3-02 修正文档。
2. `apps/web` 无自动化测试；`docker-compose` 无冒烟断言——P2/P5 视需要补，不在 P0 补测试。
3. infra.* 真实环境验证（PG/Redis/MCP readdoc）本地 NOT RUN，P0-01 baseline 已如实记录"跳过≠通过"。
