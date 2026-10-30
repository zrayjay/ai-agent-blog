# P4-01 · engine 全模块拆包评估（结论：不拆包，P4 按「不拆包 + ADR」完成）

- 状态：Accepted（2026-10-30）
- 关联任务：P4-01（本文件即其交付物）；上位依据：ADR-0004 第 2 条（拆包门槛）、compatibility-baseline.md §4（导出面即契约）、p3-04-service-assessment.md（service/rag 已裁决不迁移，方法沿用）

## 评估问题

ADR-0004 要求 P4「只选择 P3 确认的高价值模块」做单模块单 PR 迁移；三门槛（真实依赖循环 / 职责混杂导致构建成本可量化上升 / 存在独立复用方）全部满足并经新 ADR 批准才可拆。P3-04 已裁决 service/rag 不迁移；本评估将门槛逐项套到 engine 其余全部模块，决定 P4-02~04 是否存在任何值得迁移的对象。

## 逐模块实测（2026-10-30，证据全部可复现）

模块构成（13 个功能模块 + src 根内核文件共 10 个 .ts，模块合计 10790 行 + 根内核 1031 行 = 11821 行）：evals 3310、memory 1347、orchestrator 1099、rag 1116、tools 728、verification 688、telemetry 612、mcp 526、guardrails 500、service 382（P3-04 已裁决）、platform 266、skills 207、typings 9。

### 门槛 1：真实依赖循环 —— 全仓库 0 违规，模块间单向

`pnpm lint:deps`（124 modules 381 dependencies，含循环规则）：0 violations。

模块间依赖边实测（`grep 'from "\.\./'` 逐目录枚举，方向均自高向低）：

| 模块         | 依赖（→）                                                         | 被依赖（仓内 import 计数）                               |
| ------------ | ----------------------------------------------------------------- | -------------------------------------------------------- |
| evals        | agent-loop, config, guardrails, rag, service, types, verification | 3（cli eval + examples/07）                              |
| orchestrator | agent-loop, json-utils, llm, tools, types                         | 7                                                        |
| memory       | config, llm, logger, rag, trace                                   | 8                                                        |
| service      | agent-loop, json-utils, llm, memory, tools, trace, types          | 3                                                        |
| tools        | config, guardrails, logger, rag, types                            | 7                                                        |
| mcp          | config, rag, tools, types                                         | 4                                                        |
| rag          | config, guardrails, llm, logger, trace                            | 13                                                       |
| guardrails   | telemetry, trace, types                                           | 0（import 口径；chat/cli.ts 注释提及，经根出口全员可用） |
| verification | agent-loop, telemetry, types                                      | 0（经根出口）                                            |
| telemetry    | —（叶子）                                                         | 0（经根出口）                                            |
| skills       | trace                                                             | 3                                                        |
| platform     | —（仅 node:crypto + postgres，零引擎内边）                        | 0（独立子路径导出）                                      |

无任何双向边（service↔evals 双向 grep 零命中，P3-04 已证；本轮复验）。分层与 dependency-cruiser 语义分层（kernel→L1→L2→L3）完全一致。

### 门槛 2：构建成本 —— 可量化上升无证据

CI test job 全链 53s（2026-10-30 @PR#41 合并点实测：test 53s、evals 34s、platform-store 29s，三 job 并行）；engine tsc 在 turbo 缓存下秒级。engine 是单 tsconfig 单构建单元，拆包不会减少任何模块的实际编译量，只会增加 N 份 package.json/tsconfig/exports 配置与跨包声明解析成本。

### 门槛 3：独立复用方 —— 仓内消费方全部经根出口/子路径，无外部仓库

13 个模块的仓内消费方（apps/api、apps/cli、examples 01~07，文件数口径，不含 engine 自身 test）合计 48 个消费文件，全部走 `@agent-app/engine` 根出口或既有子路径（compatibility-baseline §4 的 19 项导出）；无任何仓库外消费方。platform 零消费（仅 CI platform-store job 的契约测试 + personal-agent 规划引用，ADR-0004 第 4 条已定性「维持现状不扩展」）。

## 逐模块裁决

| 模块                                    | 门槛 1 循环      | 门槛 2 构建 | 门槛 3 复用方          | 裁决                                                                                                         |
| --------------------------------------- | ---------------- | ----------- | ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| rag / memory / tools / mcp / guardrails | 无               | 无证据      | 全仓内                 | 不拆（L1/L2 交集密集：rag→guardrails、tools→rag、tools→guardrails 三角紧邻单向互连，拆开必加跨包边）         |
| service                                 | 无               | 无证据      | 仅 api/cli             | 不拆（P3-04 已裁决，本轮复核不变）                                                                           |
| evals                                   | 无               | 无证据      | cli + examples/07      | 不拆（依赖 service/rag/verification 三域，拆出反而制造最多跨包边）                                           |
| orchestrator                            | 无               | 无证据      | api/cli/examples       | 不拆（依赖内核 5 模块，独立拆出无复用收益）                                                                  |
| verification / telemetry / guardrails   | 无               | 无证据      | 经根出口               | 不拆（引擎注释明确「导出面保持最小」，三者为内核伴生件）                                                     |
| skills                                  | 无               | 无证据      | cli/chat + examples/05 | 不拆（207 行，拆包成本 > 收益）                                                                              |
| platform                                | 无（零引擎内边） | 无证据      | 0 消费方               | 不拆（ADR-0004 第 4 条：维持现状，是 personal-agent 地基非教学主线必需；已有独立子路径导出，隔离需求已满足） |

**13/13 模块三门槛全部不满足——拆包候选集为空。**

## 结论

**不拆包。** P4 按 ADR-0004 预留路径以「不拆包 + 本 ADR」完成：P4-02（兼容导出迁移路径）无迁移对象，以兼容性红线复核交付；P4-03（scenarios 收敛）是唯一含实际工程内容的任务，单独评估实施；P4-04 记录同步与性能口径。触发重评条件（ADR-0004 同款 + P3-04 同款）：出现仓库外复用方 / engine 构建耗时因规模增长不可接受 / lint:deps 报出涉及任一模块的新循环。

## 后果

- 正面：零迁移风险、导出面契约（19 项子路径 + 根出口）继续由 compatibility-baseline §4 与 lint:deps 守护；P4-03 的 scenarios 整理不再与拆包耦合，可聚焦「样本/脚本归位 + 旧入口保留」本身。
- 负面：单包持续承载 13 模块（~11k 行）——但 124 modules 0 violations 的机械化守护已证明分层规则可约束单包内部秩序，规模增长由重评条件兜底。
