// main.ts —— 06 示例：编排器三段核心语义（离线、确定性桩驱动）。
// 编排 1：静态任务单 DAG —— 状态 done、产出汇总
// 编排 2：验收打回 —— acceptance.contains 不满足 → 默认 AcceptanceCritic 拒绝 →
//         AcceptanceFailedError 属不可重试类 → 降级占位续链（引擎的显式设计：不空转重试）
// 编排 3：失败降级 —— 执行器持续抛错 → retry 耗尽 → 降级占位续链
// REAL 路径：assembleTeamOrchestrator() 装配 LLM 三角色 → pnpm cli team "目标" --trace。
import { Orchestrator, MemoryStateStore } from "@agent-app/engine/orchestrator";
import { happyPlanner, happyExecutor, passCritic, flakyExecutor, failingExecutor } from "./roles.js";

// 编排 1：静态任务单 DAG
const orch1 = new Orchestrator({
  stateStore: new MemoryStateStore(),
  planner: happyPlanner(),
  executor: happyExecutor(),
  critic: passCritic,
});
const r1 = await orch1.runAsync({
  id: "orch-demo-1",
  goal: "查订单并汇总",
  tasks: [
    { id: "t1", title: "查订单", goal: "查订单 A-1024 状态" },
    { id: "t2", title: "写摘要", goal: "汇总查询结果", dependsOn: ["t1"] },
  ],
});
console.log(`[编排 1] 两任务 DAG：状态 ${r1.state}，产出 ${r1.outputs.length} 条`);

// 编排 2：验收打回（不传 critic → 引擎默认 AcceptanceCritic 按 acceptance.contains 判定）
const orch2 = new Orchestrator({
  stateStore: new MemoryStateStore(),
  planner: happyPlanner(),
  executor: flakyExecutor(),
});
const r2 = await orch2.runAsync({
  id: "orch-demo-2",
  goal: "汇总并给出结论",
  tasks: [
    { id: "t1", title: "查订单", goal: "查订单" },
    {
      id: "t2",
      title: "写摘要",
      goal: "汇总",
      dependsOn: ["t1"],
      acceptance: { type: "contains", anyOf: ["完成"] },
    },
  ],
});
const t2Out = r2.outputs.find((o) => o.taskId === "t2");
console.log(
  "[编排 2] 验收不达标：第一次产出不含关键词 → AcceptanceFailedError 不可重试 → 降级占位续链" +
    (t2Out ? `（${t2Out.text}）` : ""),
);

// 编排 3：失败重试耗尽（RetriableError → defaultRetryPolicy 退避重试 3 次 → 全失败 → 降级占位续链）
const orch3 = new Orchestrator({
  stateStore: new MemoryStateStore(),
  planner: happyPlanner(),
  executor: failingExecutor(),
  critic: passCritic,
});
const r3 = await orch3.runAsync({
  id: "orch-demo-3",
  goal: "演示失败重试耗尽",
  tasks: [{ id: "t1", title: "会失败的任务", goal: "调用持续不可用的下游" }],
});
console.log(`[编排 3] 失败重试耗尽：RetriableError ×3（退避重试）→ 降级占位续链 → 编排继续到 ${r3.state}`);
