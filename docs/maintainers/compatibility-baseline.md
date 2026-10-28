# P0-04 兼容基线（API / CLI / SSE / 包导出 / Env / 测试）

基线：`7600320`。本文件是重构期间的**行为兼容清单**：任何后续任务不得改变下述端点、命令语义、事件结构、导出面与环境变量含义，除非任务明确声明破坏性变更并单独评审。证据为 2026-10-28 源码核对 + P0-01 基线测试运行。

## 1. HTTP API（apps/api，NestJS，前缀 `/api`）

| 端点                                                  | 方法     | 位置                                | 语义要点                                                        |
| ----------------------------------------------------- | -------- | ----------------------------------- | --------------------------------------------------------------- |
| `/api/health`                                         | GET      | `app.module.ts:26`                  | 存活检查                                                        |
| `/api/chat`                                           | POST     | `chat/chat.controller.ts:53`        | 非流式对话；**不提供挂起式审批**（README 明示，需审批走 SSE）   |
| `/api/chat/sessions`、`/api/chat/sessions/:sessionId` | GET      | 同上:81,93                          | 会话列表/详情                                                   |
| `/api/chat/approve`                                   | POST     | 同上:107                            | 工具审批决策                                                    |
| `/api/chat/stream`                                    | GET(SSE) | 同上:132                            | 流式对话 + 审批挂起                                             |
| `/api/kb/ingest`、`/api/kb/ingest-path`               | POST     | `kb/kb.controller.ts:31,42`         | 入库（内容/文件路径两种形态）                                   |
| `/api/kb/documents`                                   | GET      | 同上:49                             | 已入库文档列表                                                  |
| `/api/kb/query`                                       | POST     | 同上:63                             | 带引用问答                                                      |
| `/api/service/message`                                | POST     | `service/service.controller.ts:101` | 客服消息（非流式）                                              |
| `/api/service/stream`                                 | GET(SSE) | 同上:157                            | 事件：`route / step / token / handoff / done`（README §6 声明） |
| `/api/service/sessions`、`/:sessionId`                | GET      | 同上:313,325                        | 客服会话                                                        |
| `/api/team/stream`                                    | GET(SSE) | `team/team.controller.ts:24`        | 编排事件流                                                      |

横切：全局 `ThrottlerGuard`（`AGENT_THROTTLE_LIMIT` 可调、`THROTTLE_DISABLED=1` 连模块都不装配）；`all-exceptions.filter.ts` 统一错误体；`llm-injection-scan.ts`、`message-limits.ts` 入口防护；审批登记簿为进程内存（重启失效，MATURITY 已声明 Demo）。

## 2. CLI（apps/cli，tsx 直跑）

| 命令                                                     | 语义                                                       | 测试/证据                           |
| -------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------- |
| `pnpm chat`（`--trace`/`--selftest`/`--mcp`/`--skills`） | 聊天 REPL：会话窗口 + 工具循环 + 演示工具                  | selftest 13/13（P0-01 基线）        |
| `pnpm cli chat\|kb\|service\|eval\|mcp-server\|team`     | 入口路由（`apps/cli/src/index.ts:22-26`）                  | 各 app 目录存在，2026-10-28 核对    |
| `pnpm kb:ingest <file>` → `pnpm kb`                      | 入库 + 带引用问答 REPL                                     | engine rag 套件 + kb e2e（api）     |
| `pnpm service`                                           | 客服 REPL                                                  | `pnpm test:service`                 |
| `pnpm eval` / `pnpm quality-gate --gate-policy ci`       | 评测 / 门禁（Tier 1 必跑，Tier 2/3 无 key 跳过并显式留痕） | agent-app.yml evals job             |
| `pnpm mcp:server`                                        | stdio MCP 服务器                                           | test/mcp-server.spec.ts             |
| `pnpm examples:minimal` / `examples:custom-tool`         | 最小示例                                                   | examples/tsconfig.json 进 typecheck |

退出语义约定：CLI 顶层路由未知命令打印用法并以非零退出（`index.ts:26`）；eval/quality-gate 门禁失败非零退出（CI 依赖此语义）。

## 3. SSE 事件契约（@agent-app/shared，纯类型）

- chat：`step`（工具步骤）与 `token`（回复片段）事件（README §3、shared 包）。
- service：`route / step / token / handoff / done`（README §6 明示顺序语义）。
- team：编排生命周期事件流（orchestrator events）。
- 约束：事件结构由 `@agent-app/shared` 单一来源定义，web/api 双端消费；重构不得改变字段名与事件序列。

## 4. 包导出面（重构的兼容红线）

`@agent-app/engine` 子路径导出（package.json `exports`，2026-10-28 逐项核对）：
`.`、`./config`、`./errors`、`./logger`、`./llm`、`./agent-loop`、`./trace`、`./json-utils`、`./rag`、`./rag/store.factory`、`./memory`、`./memory/factory`、`./orchestrator`、`./tools`、`./service`、`./evals`、`./skills`、`./mcp`、`./platform`。

根出口（`src/index.ts`）额外 re-export：config、llm、agent-loop、trace、json-utils、guardrails/_、run-contract、verification/_、telemetry/*（注释明确"导出面保持最小"，guardrails/verification/telemetry 不单开子路径）。

`@agent-app/shared`：仅 `.` 单一导出（纯类型，零运行时逻辑）。

**规则**：P3/P4 任何模块移动必须保持上述路径可用；新增导出允许，删除/改名需破坏性变更决策。

## 5. 环境变量契约

引擎（`engine/src/config.ts` 白名单）：`OPENAI_API_KEY/BASE_URL/MODEL`、`EMBEDDING_MODEL`、`EMBEDDING_DIM`、`SESSION_STORE`、`IDEMPOTENCY_STORE`、`AGENT_LLM_MAX_RETRIES`、`AGENT_LLM_TIMEOUT_MS`、`AGENT_LOG_FORMAT`、`AGENT_LOG_LEVEL`、`AGENT_TOKEN_ESTIMATOR`、`MODEL_CONTEXT_TOKENS`、`AGENT_MCP_TOOL_TIMEOUT_MS`、`AGENT_GUARD_{PII,ALLOWLIST,CONFIRM,INPUT,MCP_STRICT,LLM_SCAN}`（`.env` 回填家族，config.ts:189-202）。

API/CLI 直接读取：`AGENT_TRACE`、`AGENT_SHOW_STEPS`、`AGENT_CONFIRM_TOOLS`、`AGENT_CONFIRM_TIMEOUT_MS`、`AGENT_AUDIT_LOG`、`AGENT_THROTTLE_LIMIT`、`THROTTLE_DISABLED`、`PORT`。

基础设施门控：`RUN_INFRA_TESTS`（infra.* 套件）、`RUN_PLATFORM_PG_TESTS`（platform store）、`PG_CONNECTION_STRING`（默认 `postgres://agent:agent@localhost:5433/agent`）。

`.env.example` 仅含 4 个必填样例（OPENAI 四件套）；其余变量文档散布在 README/MATURITY——不属阻断，P6-02 文档收口时统一索引。

## 6. 测试基线（2026-10-28，P0-01 独立运行）

| 套件                             | 结果                                                                 | 说明                               |
| -------------------------------- | -------------------------------------------------------------------- | ---------------------------------- |
| engine vitest                    | 436 pass / 33 skip                                                   | skip 全部为 infra.*（无 Docker）   |
| API vitest                       | 94 pass                                                              | 单测 + e2e，引擎 mock              |
| selftest                         | 13/13                                                                | 零网络假模型                       |
| eval Tier 1                      | pass（18 pass / 58 skip）                                            | skip 为无 key 的 Tier 2/3          |
| quality-gate --gate-policy ci    | PASS                                                                 |                                    |
| typecheck / lint:deps / -r build | PASS / 0 违规 / PASS                                                 |                                    |
| 根 docs:build                    | PASS                                                                 |                                    |
| 未运行（如实记录）               | infra.* 六套件真实 PG/Redis、MCP dogfood、compose 全栈、Web 手动回归 | 需要 Docker/密钥/浏览器，跳过≠通过 |

## 7. 兼容性守护规则（供 P3/P4 引用）

1. 上述端点/命令/事件/导出/env 清单变更 = 兼容性影响，必须在 PR 描述列出并走独立审查。
2. 行为变更须先有 characterization test 证明旧行为（方案 §3.5）。
3. CI 三个 job（test/evals/platform-store）为必需门禁，不得削弱触发条件或移除步骤。
4. 幂等、审批、取消、重试语义不因目录重构改变。
