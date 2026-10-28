# ADR-0001：唯一主线学习路线与七阶段结构

- 状态：Accepted（2026-10-28）
- 关联任务：P0-05、P1-01~P1-06
- 背景：仓库并存三套叙事——23 周按天归档课（161 篇）、13 站 guide 主线、reference 深讲 + products 三篇。侧边栏"开始"区仍指旧双轨，新读者面对多条竞争路线（D01/D02）。
- 决策：
  1. 唯一正式学习路线为 7 阶段能力主线：S1 基础与模型交互 → S2 Agent Runtime → S3 Capabilities → S4 Orchestration → S5 质量与可靠 → S6 全栈交付 → S7 产品案例，落位 `docs/learn/01~07`。
  2. `docs/start/` 为唯一入口（面向谁/环境/路线图/术语）；preface、roadmap、guide/index 并入或归档。
  3. 23 周课程原位归档 `docs/archive/weeks/`，不混入主侧边栏，仅页脚/历史入口可达，页首加归档提示。
  4. 每阶段有索引页；每课有上一章/下一章；课程顺序按技术依赖，不预示未来产品功能。
- 后果：guide 13 章逐篇 MIGRATE（P1-03），09b 重编号；products → cases、how-to → advanced（P1-05）；旧路径保留迁移说明页（VitePress 1.6.3 无内置重定向，已核实）。
- 否决方案：保留双路线并行（否决原因：D01 冲突未解，搜索与导航持续互相稀释）；一次性删除旧课（违反方案"不得无声删除"红线）。

# ADR-0002：TypeScript 主线优先，Python 为归档选修

- 状态：Accepted（2026-10-28）
- 关联任务：P0-05、P1-05
- 背景：`docs/roadmap.md` 阶段三仍把 Python/FastAPI/LangGraph 混排进主线；而 agent-app 全部实现、guide 13 站、CI 门禁均为 Node/TS（D02）。
- 决策：TS 为唯一主线技术栈；Python 周（9/10/12 部分/16 部分/17 部分）归档保留、不删除、不翻译，作为 `advanced` 的"第二引擎"选修入口链接到归档。教程中 Python 内容维持 2026-09 版本声明原样。
- 后果：新路线图不再出现 Python 必修节点；reference/guide 不新增 Python 内容；文档口径与 agent-app 实现一致。
- 否决方案：补齐 Python 对应实现（否决原因：超出本期范围且无证据需求）；删除 Python 内容（违反非目标 §12）。

# ADR-0003：示例策略——examples 渐进系列 + 离线确定性优先

- 状态：Accepted（2026-10-28）
- 关联任务：P0-05、P2-01~P2-06
- 背景：`engine/examples` 现有 2 个示例，不能逐章覆盖主线（D06）；方案要求每章有可执行示例 + 离线测试。
- 决策：
  1. 新建 `agent-app/examples/01-llm … 08-evaluation` 渐进系列，每例含 README/src/至少 1 条离线确定性测试（CI 可跑）。
  2. 示例只用 `@agent-app/engine` 公开导出面（见 compatibility-baseline.md §4），不 import 引擎私有源码；与主工程共享 pnpm workspace，不建平行内核。
  3. 真实模型路径显式可选（无 key 跳过并打印原因）；默认演示走 mock/fake。
  4. 每篇主课最多 1 个主示例 + 少量补充示例；课内不整段复制引擎源码，改重点片段 + 固定版本链接。
- 后果：`engine/examples/minimal-agent.ts` 等旧示例保留（`pnpm examples:*` 命令兼容），新系列为其教学化扩展而非替代。
- 否决方案：每课独立 npm 项目（否决原因：依赖漂移、CI 成本、与 workspace 导出面脱节）。

# ADR-0004：模块分层与依赖规则——先立规不拆包

- 状态：Accepted（2026-10-28）
- 关联任务：P0-05、P3-01~P3-05、P4-01~P4-04
- 背景：`packages/engine` 单包承载 Loop/RAG/Memory/MCP/Service/Orchestrator/Evals/Platform（D07）；dependency-cruiser 已有规则（lint:deps 0 违规）。
- 决策：
  1. 逻辑分层采纳方案 §3.2（core → capabilities → orchestration → scenarios → apps），第一阶段仅作为**依赖规则的语义**写入 dependency-cruiser 配置与文档，不做物理拆包。
  2. 拆包门槛（须全部满足并经新 ADR 批准）：真实依赖循环 / 职责混杂导致构建成本可量化上升 / 存在独立复用方。三者皆无则 P4 以"不拆包 + 本 ADR"完成。
  3. `service`（客服领域）从通用内核解耦为候选观察项：在出现非客服消费方或 engine 构建显著变慢之前不动；一旦迁移须兼容层先行。
  4. `platform`（PG Task/Outbox）已独立子路径导出，维持现状；它是 personal-agent 地基，不是教学主线必需。
  5. 导出面即契约：子路径导出清单见 compatibility-baseline.md §4，任何调整需破坏性变更评审。
- 后果：P3-01 收紧规则（core 不 import apps/scenarios）；evals 可依赖测试接缝但运行时默认不加载评测数据集；`@agent-app/shared` 保持纯类型零运行时。
- 否决方案：立即拆 core/capabilities/orchestration 三包（否决原因：无依赖循环证据，纯目录美观，违反 §3.1 优先级）。

# ADR-0005：Personal Agent 仓库边界

- 状态：Accepted（2026-10-28）
- 关联任务：P0-05、P1 各任务、全程约束
- 背景：`agent-app/docs/personal-agent/` 六篇是独立产品 `zrayjay/personal-agent` 的历史规划（D08）；近期试合并（PR #1-3）把 platform store 地基带入了本仓库。
- 决策：
  1. 该目录定性为**历史设计材料**：加边界声明（非本仓库当前功能、非执行计划），指向独立仓库的现行文档为权威；不一致处标 superseded，不反向覆盖。
  2. 本仓库本期不实施 Personal Agent 产品需求；platform store 维持已合并现状（ADR-0004 第 4 条），不扩展。
  3. 站点案例文章可讲其**通用架构原则**（任务持久化/审批/评估），但必须标注"设计讨论"，不得写成已实现能力。
  4. 禁止向 `zrayjay/personal-agent` 仓库提交任何变更；发现跨仓库依赖问题开建议 issue，不阻塞教学改造。
- 后果：capability-matrix E 节为唯一 planned 认定来源；任何 PR 不得把 personal-agent 规划伪装为本仓库功能。
- 否决方案：从本仓库删除 personal-agent 文档（否决原因：历史有引用价值且 PR #1-3 已合并，删除需独立评审与映射）。
