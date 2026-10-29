# 06 · 多 Agent 编排（离线版）

> 对应课：[learn/09b · 多 Agent 编排](../../../docs/learn/04-orchestration/multi-agent-orchestration.md) · 对应源码：`packages/engine/src/orchestrator/`
> 本示例用**确定性三角色桩**（与引擎测试同款接缝）演示编排器的核心语义：DAG 并行派发、验收打回、失败降级。**零密钥、零网络**。
> 真实 LLM 拆单/执行的形态见 `pnpm cli team "目标" --trace`（`examples:list` 之外的入口）。

## 前置

无。完全离线；`pnpm install` 后即可运行（角色桩不调模型）。

## 命令与预期输出

```bash
pnpm examples:list
pnpm examples:check
pnpm exec tsx examples/06-orchestration/src/main.ts
```

`main.ts` 预期输出（桩剧本，确定性）：

```text
[编排 1] 两任务 DAG：状态 done，产出 2 条
[编排 2] 验收打回：第一次产出不含关键词 → critic 拒绝 → 重做后通过
[编排 3] 失败降级：任务反复失败 → 降级占位续链 → 编排继续到 done
```

## 学到什么

- **拆 · 派 · 跑**：静态任务单（TaskSpec[]）+ 依赖 DAG 波次并行 + 显式状态机
- **验收闭环**：`acceptance.contains` 不满足 → critic 打回重做——「完成」必须有定义
- **失败四分支**：retry 耗尽 → degrade 占位续链（编排不因单点卡死）
- **三角色可插拔**：Planner/Executor/Critic 都是接口——测试用桩、生产用 LLM 实现，编排器一行不改

## 真实路径（可选）

`assembleTeamOrchestrator()`（`@agent-app/engine/orchestrator`）装配 LLM 三角色——`pnpm cli team "查订单A-1024的物流状态" --trace` 一条命令体验完整拆 · 派 · 跑。
