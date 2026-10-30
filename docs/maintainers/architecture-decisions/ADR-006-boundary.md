# ADR-0006：通用接口与业务实现的模块边界——现状裁决与机械化守护

- 状态：Accepted（2026-10-30）
- 关联任务：P3-03（本 ADR 即其交付物）
- 上位依据：ADR-0004（模块分层与依赖规则——先立规不拆包）第 5 条「导出面即契约」、P3-01 的 dependency-cruiser 规则集

## 背景

方案 P3-03 原任务为「将通用接口/业务实现边界写成 ADR，修复确认存在的错误跨层 import」。执行 P3-03 时，P3-01 已先行把分层规则机械化（dependency-cruiser 八条 forbidden 规则 + lint:deps 双包扫描），因此本 ADR 回答三个问题：**边界是什么、现状有没有违规、未来靠什么守护**。

## 裁决

### 1. 边界定义（engine 内部三层 + 外部消费方向）

| 边界                                                    | 规则（正向）                                              | 违规（反向）                                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| kernel（根模块 agent-loop/config/llm/trace/json-utils） | 被一切层使用；不自知上层                                  | kernel import L1/L2/L3                                                                       |
| L1 rag（最底层特性）                                    | 可用 kernel                                               | rag import L2/L3（豁免：ingest → guardrails 的 validate/audit 两个纯函数模块，红队 H1 指定） |
| L2 tools/memory/guardrails                              | 可用 kernel + L1                                          | L2 import L3；guardrails 横向 import tools/memory                                            |
| L3 service/mcp/evals                                    | 可用 kernel + L2 + L1；evals/service 合法使用 runToolLoop | L3 import apps                                                                               |
| 零件层禁用调度器                                        | —                                                         | rag/tools/memory/guardrails/mcp import agent-loop.ts（evals/service 放行）                   |
| shared 契约叶子                                         | 纯类型零运行时；被 web/api/cli/examples 消费              | shared import engine 任何实现                                                                |
| engine 不认识应用                                       | 被消费方 import                                           | engine import apps/examples                                                                  |

### 2. 现状裁决（2026-10-30 实测）

- `pnpm lint:deps`（engine + shared 双 src，124 modules / 381 dependencies）：**0 violations**。
- app 层（api/cli/web）对 engine 的消费全部走公开导出面（子路径 exports），无 src 相对路径跨包 import。
- shared 对 engine：仅 2 处 **type-only** 契约导入（service/handoff.ts、service/supervisor.ts）——方向合法（契约引用类型而非实现），且 ADR-0004 的「shared 零运行时」不受影响。
- **结论：不存在需要修复的错误跨层 import。方案预设的「修复」动作为零，如实记录。**

### 3. 守护机制（未来靠什么）

- 机械化：`pnpm lint:deps`（CI test job 步骤）每次触 agent-app 的 PR 全量执行；新规则（shared 叶子、engine 禁依赖 apps）经负向探针实证有牙（P3-01 审查记录）。
- 免疫缺口（如实声明）：dependency-cruiser 对 `doNotFollow: node_modules` 下跨 workspace 的相对路径解析存在形态依赖——相对形式的边依赖 tsconfig 解析结果（P3-01 复审确认正确相对路径可命中规则，但错误深度的相对路径会静默不报）。防线：代码规约禁止跨包相对 import（code review 纪律）+ 包名形式规则兜底。

## 后果

- 正面：边界从「文件头注释约定」升级为「机器可执行规则 + 本 ADR 文字裁决」；零代码改动（方案预设的修复动作为零是如实结论而非规避）。
- 负面/限制：相对路径形态的解析缺口依赖 CI 全量 checkout（fetch-depth: 0，P3-01 已修）与 code review 纪律双保险。
- 触发重审的条件：出现新的顶层目录（新「层」）、service 被非客服消费方复用、或 lint:deps 在合并后主干出现非探针类违规。
