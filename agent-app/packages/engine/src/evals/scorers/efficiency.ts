// scorers/efficiency.ts —— 效率打分器（Phase 3 §7.2）：核对用例声明的效率预算
//
// ── 为什么效率是确定性维度 ────────────────────────────────────────────────
// 效率断言只数事实：工具调了几次、整轮跑了多少毫秒——不依赖模型发挥、零网络，
// 与轨迹/路由同属离线确定性层。它不替代轨迹判分，而是叠加在其上的「预算合同」：
// 轨迹评「做没做对」，效率评「做的是否超支」。用例声明了哪项限额就核对哪项，
// 没声明的项直接跳过——预算是「声明了才生效」的合同，不打无声明之板。
//
// ── 为什么 actualDurationMs 是独立入参 ──────────────────────────────────
// ToolLoopStepEvent 里没有计时字段（它是协议事件，不是遥测行），整轮耗时由
// runner 用同一块表测出后传入；直接调用（单测）不传时耗时项跳过核对并在
// detail 里如实说明——绝不拿 0 冒充实测值（诚实 UI 原则的评测版）。
import type { ToolLoopStepEvent } from "../../agent-loop.js";
import type { EfficiencyLimits, ScorerOutput } from "../types.js";

/**
 * 核对效率预算（纯函数）：
 * @param steps 真实 runToolLoop 通过 onStep 广播的步骤事件（数工具调用次数用）
 * @param limits 用例声明的预算（两个限额字段都可缺省）
 * @param actualDurationMs 整轮实测耗时（runner 传入；缺省时耗时项跳过核对）
 */
export function scoreEfficiency(
  steps: ToolLoopStepEvent[],
  limits: EfficiencyLimits,
  actualDurationMs?: number,
): ScorerOutput {
  const checks: string[] = [];
  let passed = true;

  if (limits.maxToolCalls !== undefined) {
    const toolCalls = steps.length;
    checks.push(`工具调用 ${toolCalls} 次（预算 ${limits.maxToolCalls}）`);
    if (toolCalls > limits.maxToolCalls) passed = false;
  }

  if (limits.maxDurationMs !== undefined) {
    if (actualDurationMs === undefined) {
      checks.push("总耗时未测量（未提供实测值，跳过该项核对）");
    } else {
      checks.push(`总耗时 ${actualDurationMs}ms（预算 ${limits.maxDurationMs}ms）`);
      if (actualDurationMs > limits.maxDurationMs) passed = false;
    }
  }

  if (checks.length === 0) {
    return { passed: true, score: 1, detail: "效率达标：未声明任何效率限额，默认通过" };
  }

  const detail = passed ? `效率达标：${checks.join("，")}` : `效率超限：${checks.join("，")}`;
  return { passed, score: passed ? 1 : 0, detail };
}
