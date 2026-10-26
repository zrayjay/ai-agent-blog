# Personal Agent 平台改造方案（V3，2026-10-26）

> **定位**：在现有 `agent-app` 代码上增量建设自托管 Personal Agent，不以重写项目为前提。此目录是 **Personal Agent 新产品规划的单一入口**；[旧 ARCHITECTURE](../../ARCHITECTURE.md) 和 [旧 BACKLOG](../../BACKLOG.md) 继续记录现有教学项目的实现与遗留，不能把未来计划误写成已完成代码。

## 文档导航

| 文档 | 职责 |
| --- | --- |
| [01-ARCHITECTURE.md](./01-ARCHITECTURE.md) | 目标架构、复用决策、运行模型、数据与安全契约 |
| [02-ROADMAP.md](./02-ROADMAP.md) | **实施总计划 V3**：P0–P7 阶段重排、P2-A/B/C 队列门禁、M0–M4 交付、54 场景追踪与 OpenCode PR 拆分 |
| [03-QUEUE-SCHEDULING.md](./03-QUEUE-SCHEDULING.md) | 六类逻辑队列、Agent 唤醒、并发隔离、调度和恢复协议 |
| [04-SCENARIO-MATRIX.md](./04-SCENARIO-MATRIX.md) | 54 个核心场景、系统不变量、场景分级与测试验收 |
| [05-EVALUATION-ARCHITECTURE.md](./05-EVALUATION-ARCHITECTURE.md) | **新增：Agent Quality Engineering / Evaluator Agent**，已有实现复用、评估时机、工作流、E01–E12 场景及阶段映射 |

## 产品定义

目标是一个具备 **持续任务、可控操作、长期记忆、用户自建 Agent、长期目标与多 Agent 协作** 的 Personal Agent，参考 Muse / Dots 的产品方向，**不推断其私有内部架构**。

首版交付范围是“单用户/单部署实例的可靠平台基础”；模型多供应商、Agent 隔离与授权设计预留多用户维度，**不承诺首版多租户 SaaS**。用户通过自然语言创建 Agent；创建结果是通过 schema 验证的 **AgentSpec 版本记录**，不是任意生成并运行 TypeScript 代码。

## 不可破坏的现状

- 工程：pnpm + Turborepo，`apps/api` 为 NestJS、`apps/web` 为 Next.js、`apps/cli`、`packages/engine` 和 `packages/shared`。
- 已有引擎能力：手写 `agent-loop.ts`、Effect `orchestrator`、Memory / RAG、MCP / Skills、Guardrails、Telemetry、Verification、Evals、Quality Gate，**以及新落地的 Experiments / Failure Candidates / 人工审核反馈闭环**。其中 Evals 的 safety/reliability 维度与统一质量门禁的自动证据汇聚仍有缺口（见评估架构）。
- 已有原始产品线：chat、kb、service，以及相应 CLI/API/页面，必须作为回归兼容面保留。
- 代码目前**不是**持久化后台个人 Agent：chat stream 在客户端断开时中止；`MemoryStateStore` 是内存版；现有编排状态、任务 Run、会话和用户生命周期尚未统一。
- [质量工程实施记录](../AGENT-QUALITY-ENGINEERING.md) 比历史 [审计快照](../AGENT-QUALITY-ENGINEERING-AUDIT.md) 更新；不可从旧审计报告直接断言 Verification / Telemetry / Quality Gate 至今不存在。

## 决策

1. **保留现有仓库并渐进演进**，禁止为“架构一致”直接抛弃可用模块。若以后要独立产品仓库，再按稳定 package/API 边界迁移。
2. **首选现有 Agent Loop + Effect Orchestrator**。定义 RuntimeAdapter 后，LangGraph.js 才作为复杂 DAG / interrupt / checkpoint 场景的**可选后续实现**；不让 Pi、LangGraph、现有 Loop 同时拥有一次 Run 的工具执行主控权。
3. 新增 **Durable Worker + BullMQ + PostgreSQL 业务主存储**；Redis 是投递与缓存基础设施，不是业务事实源。**以 [队列规范](./03-QUEUE-SCHEDULING.md) 与 [54 场景矩阵](./04-SCENARIO-MATRIX.md) 为强制设计依据**：首期完成 Task/Wake/Approval，后续补 Tool/Trigger/Notification。
4. **安全默认拒绝**：外部写入、付费、账号变更、跨信任边界的工具执行经过服务端权限校验，必要时人工批准；提示词不能代替权限控制。
5. 首版 **Web + NestJS + Worker + PostgreSQL/pgvector + Redis**，Browser Worker 独立隔离；不在 P0 即实现浏览器自动化或多 Agent 平台。
6. **先持久化任务，再开放用户创建 Agent**；必须实现网页关闭后运行不取消，且服务重启不自动重放不确定的外部动作。

## 全局完成定义（DoD）

每阶段必须提交架构决策更新、API 契约、迁移与回滚、确定性单测、NestJS 集成测试、关键端到端用例、失败/取消/重试案例、**场景矩阵对应的 SC 编号与执行证据**、文档及 CI 结果。未获第三方账号实测的连接器只能显示“已实现适配/待授权”，不得写“已接通”。变更应由 OpenCode 按 [Roadmap](./02-ROADMAP.md) 顺序提交 PR，不在同一 PR 混入无关重构。

## 计划与实际实施状态

- [02-ROADMAP.md](./02-ROADMAP.md) 是**唯一开发总计划**：先完成基线/身份，再交付 Task/Wake/Approval 三类可靠队列与故障恢复，M1 验收后才开始 Agent Factory；后续扩展 Tool/Memory/Trigger/Notification/Multi-Agent。
- [05-EVALUATION-ARCHITECTURE.md](./05-EVALUATION-ARCHITECTURE.md) 是评估及 Evaluator Agent 体系，区别现有完成项与待集成项；[03-QUEUE-SCHEDULING.md](./03-QUEUE-SCHEDULING.md) 是队列和调度协议；[04-SCENARIO-MATRIX.md](./04-SCENARIO-MATRIX.md) 以 SC01–SC54 定义必须通过的可靠性场景。
- 目前这些文档**均为规划**，未将未来模块当成已实现代码。P0 启动后创建独立实现进度表，记录每个阶段的 PR、CI 和验收证据。
