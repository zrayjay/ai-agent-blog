// roles.ts —— 确定性三角色桩（与引擎测试同款接缝）：零模型、零网络、行为可剧本。
import { RetriableError } from "@agent-app/engine/orchestrator";
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

/** 验收不达标剧本：第一次产出不含关键词（默认 AcceptanceCritic 拒绝 → 降级占位） */
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

/**
 * 失败重试耗尽剧本：抛 RetriableError（可重试类）→ 引擎按 defaultRetryPolicy
 * 退避重试（maxAttempts 3）→ 三次全失败 → 降级占位续链。
 */
export function failingExecutor(): Executor {
  let attempts = 0;
  return {
    execute: async (task) => {
      attempts += 1;
      throw new RetriableError({ message: `任务 ${task.id} 下游 503（第 ${attempts} 次尝试）` });
    },
  };
}
