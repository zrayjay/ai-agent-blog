# P4-02 · 兼容性红线复核（结论：19 项导出面全部可用，零迁移对象零漂移）

- 状态：Accepted（2026-10-30）
- 关联任务：P4-02（本文件即其交付物）；上位依据：ADR-0004 第 5 条「导出面即契约」、compatibility-baseline.md §4/§5（基线）、p4-01-module-extraction-assessment.md（拆包候选集为空）

## 复核问题

方案 P4-02 要求「先加兼容导出，再切换新实现，再逐个替换调用方」。P4-01 裁决拆包候选集为空——不存在任何模块移动，兼容导出迁移路径**无对象**。本任务据此转为**兼容性红线复核**：逐项验证 compatibility-baseline §4 的 19 项子路径导出与根出口在当前 main 上真实可用（消费方实际解析口径），确认零漂移；同时复核 §5 环境变量契约无变更。

## 逐项实测（2026-10-30 @e4a7d82，可复现）

### 1. 导出面解析复核 —— 19/19 OK

方法：从真实消费方（`apps/api`，其 `node_modules/@agent-app/engine` 为 pnpm workspace 符号链接）以 Node ESM `import()` 逐项解析 `@agent-app/engine` 全部子路径，经 package.json `exports` → `dist/` 编译产物（消费方真实加载路径，非源码直读）。前置 `pnpm build`（1.7s，turbo 缓存命中）。

| 导出                  | 实测命名导出数 | 结果 |
| --------------------- | -------------- | ---- |
| `.`（根出口）         | 59             | OK   |
| `./agent-loop`        | 5              | OK   |
| `./config`            | 7              | OK   |
| `./errors`            | 1              | OK   |
| `./evals`             | 53             | OK   |
| `./json-utils`        | 1              | OK   |
| `./llm`               | 4              | OK   |
| `./logger`            | 4              | OK   |
| `./mcp`               | 6              | OK   |
| `./memory`            | 25             | OK   |
| `./memory/factory`    | 6              | OK   |
| `./orchestrator`      | 19             | OK   |
| `./platform`          | 2              | OK   |
| `./rag`               | 22             | OK   |
| `./rag/store.factory` | 2              | OK   |
| `./service`           | 15             | OK   |
| `./skills`            | 3              | OK   |
| `./tools`             | 18             | OK   |
| `./trace`             | 4              | OK   |

19/19 解析成功、命名导出非空；与 §4 声明的清单逐项一致（19 项 = 18 子路径 + 根 `.`）。空导出（`exports` 指到空模块）会被探针判 FAIL——全部通过即证明无「声明存在但实际为空」的漂移。

### 2. 与基线零漂移核对

- `git log --follow` 确认 compatibility-baseline.md 自 4bd4175（P0-04 建档）后未再修改——§4/§5 基线原样。
- `packages/engine/package.json` exports 与 §4 清单 diff：零增删改。
- P3 全阶段（5 任务）零 src 迁移（P3-04/P4-01 两轮评估裁决）；P3-01/03 仅新增 dependency-cruiser 规则与 ADR-006 文档，无导出面触碰。

### 3. 环境变量契约复核（§5）

`engine/src/config.ts` 白名单与 §5 清单一致（`OPENAI_*`、`EMBEDDING_*`、`SESSION_STORE`、`IDEMPOTENCY_STORE`、`AGENT_LLM_*`、`AGENT_LOG_*`、`AGENT_TOKEN_ESTIMATOR`、`MODEL_CONTEXT_TOKENS`、`AGENT_MCP_TOOL_TIMEOUT_MS`、`AGENT_GUARD_*` 家族）；基础设施门控 `RUN_INFRA_TESTS`/`RUN_PLATFORM_PG_TESTS`/`PG_CONNECTION_STRING` 在位（P3-05 service.contract 投毒实验亦从侧面验证了 config 环境变量优先级契约仍生效）。

### 4. 运行时行为回归（导出面的语义层）

P3-05 的 9 条 service characterization（硬规则路由/supervise 短路/handoff 纯函数）+ 引擎全套件 445 pass / 33 skip——导出面背后行为的抽样冻结在位，本轮复跑通过（见 tracker checks）。

## 结论

**零迁移对象（P4-01 裁决）+ 零导出面漂移（19/19 实测解析）+ 零环境变量变更 + 行为回归全绿 → 兼容性红线完好。** P4-02 以本复核报告完成：ADR-0004 的「迁移须兼容层先行」约束当前无触发场景；若未来任何模块移动，本报告的探针方法（真实消费方 ESM 解析 + 命名导出计数）可直接复用为迁移前后的红线校验。触发重评条件与 P4-01 同款。

## 后果

- 正面：导出面契约获得「声明清单 ↔ 实际解析」双向对账的方法论（此前 §4 只有静态清单核对）；P4-03 scenarios 整理与 P4-04 同步记录可在红线完好前提下聚焦自身目标。
- 负面：探针为一次性脚本未入 CI（19 项全量 import 校验每 PR 跑会拖慢 CI）——现有 vitest 全套件已隐式覆盖主要消费路径；若未来迁移启动，建议将探针纳入迁移 PR 的必跑项而非全局门禁。
