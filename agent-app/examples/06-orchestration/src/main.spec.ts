// main.spec.ts —— 06 示例的离线确定性测试（CI 必跑，零密钥）。
// 断言编排器三段语义：DAG 汇总、验收打回重做、失败降级续链（终态合法）。
import { describe, expect, it } from "vitest";
import { Orchestrator, MemoryStateStore } from "@agent-app/engine/orchestrator";
import { happyPlanner, happyExecutor, passCritic, flakyExecutor, failingExecutor } from "./roles.js";

describe("06-orchestration", () => {
  it("DAG：依赖任务串行完成，产出按任务单汇总，状态 done", async () => {
    const orch = new Orchestrator({
      stateStore: new MemoryStateStore(),
      planner: happyPlanner(),
      executor: happyExecutor(),
      critic: passCritic,
    });
    const r = await orch.runAsync({
      id: "spec-dag-1",
      goal: "查订单并汇总",
      tasks: [
        { id: "t1", title: "查订单", goal: "查" },
        { id: "t2", title: "写摘要", goal: "汇总", dependsOn: ["t1"] },
      ],
    });
    expect(r.state).toBe("done");
    expect(r.outputs.map((o) => o.taskId).sort()).toEqual(["t1", "t2"]);
  });

  it("验收打回：contains 不满足 → AcceptanceFailedError 不可重试 → 降级占位续链", async () => {
    const orch = new Orchestrator({
      stateStore: new MemoryStateStore(),
      planner: happyPlanner(),
      executor: flakyExecutor(),
      // 不传 critic → 引擎默认 AcceptanceCritic 按 acceptance.contains 判定
    });
    const r = await orch.runAsync({
      id: "spec-accept-1",
      goal: "汇总",
      tasks: [
        { id: "t1", title: "查订单", goal: "查" },
        {
          id: "t2",
          title: "写摘要",
          goal: "汇总",
          dependsOn: ["t1"],
          acceptance: { type: "contains", anyOf: ["完成"] },
        },
      ],
    });
    // 引擎语义：验收不达标属不可重试类 → 降级占位（不空转重试），编排不卡死
    expect(r.state).toBe("done");
    const t2 = r.outputs.find((o) => o.taskId === "t2");
    expect(t2?.text).toBe("（降级跳过）");
  });

  it("失败降级：执行器持续失败 → 编排仍到终态（降级占位续链）", async () => {
    const orch = new Orchestrator({
      stateStore: new MemoryStateStore(),
      planner: happyPlanner(),
      executor: failingExecutor(),
      critic: passCritic,
    });
    const r = await orch.runAsync({
      id: "spec-fail-1",
      goal: "演示失败降级",
      tasks: [{ id: "t1", title: "会失败的任务", goal: "调用不可用下游" }],
    });
    // 失败被降级吸收（占位续链），编排状态机走到合法终态而非卡死
    expect(["done", "failed"]).toContain(r.state);
  });
});
