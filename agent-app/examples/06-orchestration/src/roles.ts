// roles.ts —— 确定性三角色桩（与引擎测试同款接缝）：零模型、零网络、行为可剧本。
import type { Executor, Planner, Critic } from "@agent-app/engine/orchestrator";
import type { TaskOutput, TaskSpec } from "@agent-app/engine/orchestrator";

const stubOutput = (taskId: string, text: string, tokensUsed = 100): TaskOutput => ({
  taskId,
  text,
  tokensUsed,
  durationMs: 1,
  steps: 1,
});

/** 双任务 DAG 剧本：每任务产出含「完成」，验收 contains 直接通过 */
export function happyPlanner(): Planner {
  return {
    plan: async () => [
      { id: "t1", title: "查订单", goal: "查订单 A-1024 状态" },
      { id: "t2", title: "写摘要", goal: "汇总查询结果", dependsOn: ["t1"] },
    ],
  };
}

export function happyExecutor(): Executor {
  return { execute: async (task) => stubOutput(task.id, `${task.title} 完成`) };
}

export const passCritic: Critic = { review: async () => {} };

/** 验收打回剧本：第一次产出不含关键词（critic 抛错 → 编排器重做），第二次达标 */
export function flakyExecutor(): Executor {
  let t2Attempts = 0;
  return {
    execute: async (task) => {
      if (task.id === "t2" && t2Attempts++ === 0) {
        return stubOutput(task.id, "（第一次写偏了，没提关键词）");
      }
      return stubOutput(task.id, "汇总完成");
    },
  };
}

/** 失败降级剧本：任务永远抛错——retry 耗尽后编排器按策略降级占位续链 */
export function failingExecutor(): Executor {
  return {
    execute: async (task) => {
      throw new Error(`任务 ${task.id} 的下游服务持续不可用`);
    },
  };
}
