// verification/run-with-verification.ts —— 集成接缝：runToolLoop 跑完顺手挂验收（Phase 1），
// 并持有 Run 边界的结构化事件发射（Phase 2：run.* / verification.* 全部落在这条缝上）。
//
// ── 为什么是这个接缝（最小侵入原则）───────────────────────────────────────
// agent-loop.ts 一行未改（Phase 1 事实）；Phase 2 也只加了可选 onEvent 发射——
// 验证是「跑完之后」的事，不进循环内部。调用方把 runToolLoop 换成
// runWithVerification（多传 verifiers），其余参数原样透传；既有调用方
// （CLI / api / evals）继续用 runToolLoop，行为逐字节不变。
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
//
// ── 事件接线（Phase 2，PRD §6.2 的 Run 边界发射点）────────────────────────
// 一次 runWithVerification = 一个 recorder（createRunEventRecorder）：
//   - 循环的 llm.request.* / tool.call.* 由 onEvent 接缝进 recorder.ingest
//     （恰好一次去重 + 空关联键补挂）——循环自己不认识 Run，关联性在这里成立；
//   - run.started 与 run.* 终态、verification.* 由本函数直接 emit——它是唯一
//     同时看得见「执行边界」与「验收边界」的位置，Run 终局只能在这里裁决。
// 调用方自带的 onEvent / onStep 原样先转发（观察者零感知），采集是追加行为。
//
// ── 终局映射（循环抛错 → run.cancelled / run.timed_out / run.failed）──────
// 映射规则按优先级（见 mapTerminalType）：
//   1. ToolLoopAbortedError            → cancelled（引擎类型化中止 = 调用方主动取消）
//   2. 调用方 signal 已中止且 reason 是 TimeoutError → timed_out
//      （AbortSignal.timeout 的 reason 是 DOMException TimeoutError——
//      这是「预算看门狗超时」的结构化判据，不需要猜）
//   3. 调用方 signal 已中止（其余 reason）→ cancelled（客户端断开/手动取消）
//   4. 错误形状像超时（name=TimeoutError 或消息含 timeout/timed out）→ timed_out
//      ——启发式，覆盖 llmCallPolicy 内部 AbortSignal.timeout 的路径；引擎在这条
//      接缝拿不到结构化的超时错误类型（SDK 会包装原始 AbortError），消息形状
//      是当下最诚实的判据，规则 2 的结构化判据优先于它。
//   5. 其余                            → failed
// 映射只决定**事件类型**，原始错误永远原样上抛（Phase 1 契约：循环抛错不吞）。

import { randomUUID } from "node:crypto";
import { runToolLoop, ToolLoopAbortedError } from "../agent-loop.js";
import type { RunToolLoopOptions, ToolLoopResult } from "../agent-loop.js";
import type { AgentRunEvent } from "../telemetry/events.js";
import type { RunEventRecorder, RunEventSink } from "../telemetry/recorder.js";
import { createRunEventRecorder } from "../telemetry/recorder.js";
import type { TraceSummary, VerificationResult, Verifier } from "./types.js";
import { VerificationRunner } from "./runner.js";

/** runWithVerification 的入参：循环参数原样 + 验收配置 + 事件观测配置 */
export interface RunWithVerificationOptions extends RunToolLoopOptions {
  /** 验收验证器清单（空数组 = 只跑循环，verification.status 恒为 passed 且 checks 为空） */
  verifiers: readonly Verifier[];
  /** Run 标识（缺省生成 UUID；要挂到编排器/评测时由调用方显式给） */
  runId?: string;
  /** 追踪链路 id（缺省生成 UUID；与上游 trace 系统对齐时显式给） */
  traceId?: string;
  /** 父 Run（编排器派生时指向发起方；裸调用缺省） */
  parentRunId?: string;
  /** 事件 sink 清单（缺省 = 内建 stderr JSON 行 sink，受 AGENT_TRACE 开关约束；测试传 [] 静音） */
  eventSinks?: readonly RunEventSink[];
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
  /** 本次 Run 的全部结构化事件（内存总账原文；computeRunMetrics 的直接原料） */
  events: readonly AgentRunEvent[];
}

/** 按引擎失败通道约定识别失败步骤（理由与边界见头注释） */
function isFailedStepOutput(output: unknown): boolean {
  return (
    typeof output === "object" && output !== null && "error" in output && typeof output.error === "string"
  );
}

/** 错误形状启发式：是不是超时形状（判据与优先级见头注释映射规则 4） */
function isTimeoutShaped(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError") return true;
  return /timed[\s-]?out|timeout/i.test(err.message);
}

/** 循环抛错 → 终局事件类型（映射规则见头注释，原始错误另行原样上抛） */
function mapTerminalType(
  err: unknown,
  signal: AbortSignal | undefined,
): "run.cancelled" | "run.timed_out" | "run.failed" {
  if (err instanceof ToolLoopAbortedError) return "run.cancelled";
  if (signal?.aborted) {
    return signal.reason?.name === "TimeoutError" ? "run.timed_out" : "run.cancelled";
  }
  if (isTimeoutShaped(err)) return "run.timed_out";
  return "run.failed";
}

/**
 * runToolLoop + 事后验收 + Run 边界事件发射。循环参数（model/messages/tools/
 * system/maxSteps/signal/onStep/onEvent）原样透传；调用方自己的 onStep / onEvent
 * 若有，先转发再采集——观察者零感知。循环本身抛错（中止/步数耗尽/超时）先落
 * 对应的 run.* 终态事件再原样上抛：那是执行失败（RunOutcome.failed 的领域），
 * 执行都没成立，验收无从谈起。
 */
export async function runWithVerification(
  options: RunWithVerificationOptions,
): Promise<RunWithVerificationResult> {
  const { verifiers, runId = randomUUID(), traceId = randomUUID(), task, ...loopOptions } = options;
  const { onStep, onEvent, signal } = loopOptions;
  const recorder: RunEventRecorder = createRunEventRecorder({
    runId,
    traceId,
    parentRunId: options.parentRunId,
    sinks: options.eventSinks,
  });
  const steps: TraceSummary["steps"] = [];
  const startedAt = Date.now();
  recorder.emit("run.started");
  try {
    const run = await runToolLoop({
      ...loopOptions,
      onStep: (event) => {
        onStep?.(event); // 链式转发：调用方原有的观察钩子照常收到事件
        steps.push({ toolName: event.toolCall.toolName, failed: isFailedStepOutput(event.output) });
      },
      onEvent: (event) => {
        onEvent?.(event); // 链式转发：调用方的事件订阅者照常收到（原始事件）
        recorder.ingest(event); // 收编：恰好一次去重 + 关联键补挂（头注释「事件接线」）
      },
    });
    // run.completed = 循环正常走完（RunStatus.succeeded 的语义），**不代表验收通过**
    // ——验收结论由 verification.* 事件独立表达，两个事实通道不合并
    recorder.emit("run.completed", { durationMs: Date.now() - startedAt });
    recorder.emit("verification.started");
    let verification: VerificationResult;
    try {
      verification = await new VerificationRunner(verifiers).run({
        runId,
        task,
        input: options.messages,
        output: run.text,
        traceSummary: { steps },
      });
    } catch (err) {
      // VerificationRunner 内部已兜住验证器抛错，这里炸的是 runner 自身——
      // 记 verification.failed（不吞观测事实）后照常上抛，终局事件走 failed 路径
      recorder.emit("verification.failed", {
        attributes: { errorMessage: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
    recorder.emit("verification.completed", {
      // 领域状态进 status 字段（passed/failed/inconclusive），验收通过率从这里数
      status: verification.status,
      attributes: { checkCount: verification.checks.length },
    });
    return { runId, run, verification, events: recorder.all() };
  } catch (err) {
    const terminalType = mapTerminalType(err, signal);
    recorder.emit(terminalType, {
      durationMs: Date.now() - startedAt,
      attributes: { errorMessage: err instanceof Error ? err.message : String(err) },
    });
    throw err; // 原始错误原样上抛（Phase 1 契约不变：映射只决定事件，不改执行语义）
  }
}
