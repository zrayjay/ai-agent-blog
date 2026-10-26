// verification/run-with-verification.ts —— 集成接缝：runToolLoop 跑完顺手挂验收（Phase 1）。
//
// ── 为什么是这个接缝（最小侵入原则）───────────────────────────────────────
// agent-loop.ts 一行未改：验证是「跑完之后」的事，不进循环内部。调用方把
// runToolLoop 换成 runWithVerification（多传 verifiers），其余参数原样透传；
// 既有调用方（CLI / api / evals）继续用 runToolLoop，行为逐字节不变。
// 两者返回类型不同（多一个 verification 字段）——验收结果与执行结果各自独立
// 表达：循环正常结束（执行成功）而 verification.status === "failed"（验收失败）
// 是合法且必须能表达的状态，绝不互相污染。
//
// ── 轨迹采集与失败判定的约定 ──────────────────────────────────────────────
// runToolLoop 的失败通道是 errorOutput({ error: string })（见 agent-loop.ts
// 头注释：失败用 { type: "error-json" }，value 形如 { error: "工具 X 执行失败：…" }），
// onStep 广播的 output 即该 value。本包装按这条**引擎自身约定**识别失败步骤：
// output 是带 string 类型 error 字段的对象 → failed。两个已知边界：
//   1. 工具业务上「成功返回 { error: "..." }」会被误标——demo/评测工具无此形状，
//      真出现时是工具自身契约与引擎失败通道冲突，应先修工具；
//   2. 闸门的拒绝即数据（{ denied, reason }，见 guardrails/gate.ts）不带 error
//      字段 → 不算失败——「被策略拒绝」不是「执行炸了」，与仓库语义一致。

import { randomUUID } from "node:crypto";
import { runToolLoop } from "../agent-loop.js";
import type { RunToolLoopOptions, ToolLoopResult } from "../agent-loop.js";
import type { TraceSummary, VerificationResult, Verifier } from "./types.js";
import { VerificationRunner } from "./runner.js";

/** runWithVerification 的入参：循环参数原样 + 验收配置 */
export interface RunWithVerificationOptions extends RunToolLoopOptions {
  /** 验收验证器清单（空数组 = 只跑循环，verification.status 恒为 passed 且 checks 为空） */
  verifiers: readonly Verifier[];
  /** Run 标识（缺省生成 UUID；要挂到编排器/评测时由调用方显式给） */
  runId?: string;
  /** 验收任务描述（透传 VerificationContext.task） */
  task?: string;
}

/** 执行 + 验收的双结果：两个事实通道刻意分开，不做布尔合并 */
export interface RunWithVerificationResult {
  runId: string;
  /** 循环产物（与 runToolLoop 返回值同构） */
  run: ToolLoopResult;
  /** 验收结论（独立于 run.text 的自述） */
  verification: VerificationResult;
}

/** 按引擎失败通道约定识别失败步骤（理由与边界见头注释） */
function isFailedStepOutput(output: unknown): boolean {
  return (
    typeof output === "object" && output !== null && "error" in output && typeof output.error === "string"
  );
}

/**
 * runToolLoop + 事后验收。循环参数（model/messages/tools/system/maxSteps/signal）
 * 原样透传；调用方自己的 onStep 若有，先转发再采集——观察者零感知。
 * 循环本身抛错（中止/步数耗尽）原样上抛：那是执行失败（RunOutcome.failed 的
 * 领域），执行都没成立，验收无从谈起。
 */
export async function runWithVerification(
  options: RunWithVerificationOptions,
): Promise<RunWithVerificationResult> {
  const { verifiers, runId = randomUUID(), task, ...loopOptions } = options;
  const steps: TraceSummary["steps"] = [];
  const run = await runToolLoop({
    ...loopOptions,
    onStep: (event) => {
      options.onStep?.(event); // 链式转发：调用方原有的观察钩子照常收到事件
      steps.push({ toolName: event.toolCall.toolName, failed: isFailedStepOutput(event.output) });
    },
  });
  const verification = await new VerificationRunner(verifiers).run({
    runId,
    task,
    input: options.messages,
    output: run.text,
    traceSummary: { steps },
  });
  return { runId, run, verification };
}
