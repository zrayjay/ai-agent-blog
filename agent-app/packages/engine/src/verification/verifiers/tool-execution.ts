// verification/verifiers/tool-execution.ts —— ToolExecutionVerifier：对照轨迹核实工具真的跑成过（Phase 1）。
//
// ── 这是「执行成功 ≠ 验收通过」的正主（PRD §15.3 案例 2）───────────────────
// 模型可以在最终文本里理直气壮地说「工单已创建」——文字自述零证据价值。
// 本验证器只认 traceSummary 里的结构化事实：每个期望工具都必须
//   ① 真的在轨迹里出现过（没调 = 编排没发生），
//   ② 且没有任何一次执行标记为 failed（调了但失败 = 执行没成立）。
// 两条都不满足才算 passed。ctx.output（模型的话）本验证器一眼都不看。
//
// ── 证据缺失的边界 ────────────────────────────────────────────────────────
// context.traceSummary 缺省 → 全部检查 skipped（没有轨迹就没有事实，无法既不
// 误报也不粉饰）——必查时由 Runner 聚合成 inconclusive。

import type { VerificationContext, Verifier, VerifierCheck } from "../types.js";

export interface ToolExecutionVerifierOptions {
  /** 验收要求「必须执行成功过」的工具名清单 */
  expectedToolNames: readonly string[];
  id?: string;
  version?: string;
  required?: boolean;
}

export const TOOL_EXECUTION_VERIFIER_ID = "tool-execution";

export function createToolExecutionVerifier(options: ToolExecutionVerifierOptions): Verifier {
  const { expectedToolNames, required } = options;
  const id = options.id ?? TOOL_EXECUTION_VERIFIER_ID;
  const version = options.version ?? "1";
  return {
    id,
    version,
    required,
    verify(context: VerificationContext): readonly VerifierCheck[] {
      const steps = context.traceSummary?.steps;
      if (steps === undefined) {
        return [
          {
            id: `${id}:no-trace`,
            status: "skipped",
            message: "轨迹摘要（context.traceSummary）未提供，无法核实工具执行事实",
          },
        ];
      }
      return expectedToolNames.map((toolName) => {
        const attempts = steps.filter((step) => step.toolName === toolName);
        if (attempts.length === 0) {
          return {
            id: `${id}:${toolName}`,
            status: "failed" as const,
            message: `期望工具 ${toolName} 未在轨迹中出现（轨迹共 ${steps.length} 步）`,
            evidence: { toolName, stepCount: steps.length },
          };
        }
        const failedSteps = attempts.filter((step) => step.failed);
        if (failedSteps.length > 0) {
          return {
            id: `${id}:${toolName}`,
            status: "failed" as const,
            message: `工具 ${toolName} 有 ${failedSteps.length}/${attempts.length} 次执行失败（模型自述不代表执行成立）`,
            evidence: { toolName, failedStepCount: failedSteps.length, totalAttempts: attempts.length },
          };
        }
        return {
          id: `${id}:${toolName}`,
          status: "passed" as const,
          message: `工具 ${toolName} 已执行 ${attempts.length} 次，全部成功`,
          evidence: { toolName, totalAttempts: attempts.length },
        };
      });
    },
  };
}
