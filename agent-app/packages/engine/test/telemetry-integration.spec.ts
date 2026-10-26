// telemetry-integration.spec.ts —— Run 边界事件流的集成测试（离线、确定性、零网络）。
// 复用 Phase 1 spec 的 MockLanguageModelV2 剧本模型模式，覆盖 PRD §15.3 改编的四条
// 链路：happy path（全事件族同 runId）→ 工具抛错（tool.call.failed + 验收失败）→
// 调用方中止（run.cancelled）→ 预算超时（run.timed_out，挂死模型 + AbortSignal.timeout，
// 失败路径的事件经 eventSinks 收集——Run 抛错时没有返回值可拿，sink 是唯一观测出口）。
import { MockLanguageModelV2 } from "ai/test";
import type { LanguageModel } from "ai";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { tool } from "ai";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { ToolLoopAbortedError } from "../src/agent-loop.js";
import { createToolExecutionVerifier } from "../src/verification/verifiers/tool-execution.js";
import { runWithVerification } from "../src/verification/run-with-verification.js";
import { computeRunMetrics } from "../src/telemetry/metrics.js";
import type { AgentRunEvent } from "../src/telemetry/events.js";
import type { RunEventSink } from "../src/telemetry/recorder.js";

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
type ScriptedResponse = Awaited<ReturnType<LanguageModelV2["doGenerate"]>>;

/** 收集 sink：经脱敏通道观察事件（Run 抛错时 result 不可得，这是唯一出口） */
function collectingSink(): { seen: AgentRunEvent[]; sink: RunEventSink } {
  const seen: AgentRunEvent[] = [];
  return { seen, sink: (event) => void seen.push(event) };
}

/** 剧本模型：第一轮发起工具调用，第二轮给最终文本（usage 可注入总 token） */
function scriptedToolCallModel(options: { toolName: string; finalTotalTokens?: number }): LanguageModel {
  let cursor = 0;
  return new MockLanguageModelV2({
    doGenerate: async (): Promise<ScriptedResponse> => {
      const index = cursor;
      cursor += 1;
      if (index === 0) {
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "call-1",
              toolName: options.toolName,
              input: JSON.stringify({ orderId: "A-1024" }),
            },
          ],
          finishReason: "tool-calls",
          usage: ZERO_USAGE,
          warnings: [],
        };
      }
      return {
        content: [{ type: "text" as const, text: "订单已发货，预计明天送达。" }],
        finishReason: "stop",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: options.finalTotalTokens ?? 15,
        },
        warnings: [],
      };
    },
  });
}

/** 挂死模型：等到 abortSignal 才以 TimeoutError 形状拒绝（超时链路的剧本） */
function hangingModel(): LanguageModel {
  const rejectWithTimeout = (): Error => {
    const err = new Error("请求超时");
    err.name = "TimeoutError";
    return err;
  };
  return new MockLanguageModelV2({
    doGenerate: ({ abortSignal }) =>
      new Promise<ScriptedResponse>((_, reject) => {
        if (abortSignal?.aborted) {
          reject(rejectWithTimeout());
          return;
        }
        abortSignal?.addEventListener("abort", () => void reject(rejectWithTimeout()), { once: true });
      }),
  });
}

const chatTools = {
  get_order: tool({
    description: "查订单",
    inputSchema: z.object({ orderId: z.string() }),
    execute: async (): Promise<{ status: string }> => ({ status: "已发货" }),
  }),
};

/** 会炸的查订单工具：模拟上游故障 */
const explodingTools = {
  get_order: tool({
    description: "查订单",
    inputSchema: z.object({ orderId: z.string() }),
    execute: async (): Promise<{ status: string }> => {
      throw new Error("上游订单系统 500");
    },
  }),
};

describe("Run 边界事件流（runWithVerification）", () => {
  it("happy path：run/llm/tool/verification 全事件族落在同一 runId + traceId 上，指标可算", async () => {
    const result = await runWithVerification({
      model: scriptedToolCallModel({ toolName: "get_order", finalTotalTokens: 15 }),
      messages: [{ role: "user", content: "订单 A-1024 到哪了？" }],
      tools: chatTools,
      verifiers: [createToolExecutionVerifier({ expectedToolNames: ["get_order"] })],
      eventSinks: [], // 静音：本用例经返回值观测
    });
    const types = result.events.map((e) => e.type);
    expect(types).toContain("run.started");
    expect(types).toContain("llm.request.started");
    expect(types).toContain("llm.request.completed");
    expect(types).toContain("tool.call.started");
    expect(types).toContain("tool.call.completed");
    expect(types).toContain("verification.started");
    expect(types).toContain("verification.completed");
    expect(types).toContain("run.completed");
    // 两轮模型调用 → llm.request.started/completed 各两条；工具一对
    expect(types.filter((t) => t === "llm.request.started")).toHaveLength(2);
    expect(types.filter((t) => t === "llm.request.completed")).toHaveLength(2);
    // 关联性按构造成立：全部事件同 runId、同 traceId
    expect(result.events.every((e) => e.runId === result.runId)).toBe(true);
    expect(new Set(result.events.map((e) => e.traceId)).size).toBe(1);
    // 验收结论进 status 字段；usage 进属性
    const verificationCompleted = result.events.find((e) => e.type === "verification.completed");
    expect(verificationCompleted?.status).toBe("passed");
    const llmCompleted = result.events.filter((e) => e.type === "llm.request.completed");
    expect(llmCompleted.every((e) => e.durationMs !== undefined)).toBe(true);
    expect(llmCompleted.at(-1)?.attributes).toMatchObject({ usage: { totalTokens: 15 } });
    // 指标直接从事件总账聚合（看板最小闭环）
    const metrics = computeRunMetrics(result.events);
    expect(metrics.runsTotal).toBe(1);
    expect(metrics.runSuccessRate).toBe(1);
    expect(metrics.acceptancePassRate).toBe(1);
    expect(metrics.toolFailureRate).toBe(0);
    expect(metrics.totalTokens).toBe(15);
    expect(metrics.latencyMs?.p50).toBeTypeOf("number");
  });

  it("工具抛错（PRD §15.3 案例 3 改编）：tool.call.failed + run.completed + 验收 failed 并存", async () => {
    const result = await runWithVerification({
      model: scriptedToolCallModel({ toolName: "get_order" }),
      messages: [{ role: "user", content: "订单 A-1024 到哪了？" }],
      tools: explodingTools,
      verifiers: [createToolExecutionVerifier({ expectedToolNames: ["get_order"] })],
      eventSinks: [],
    });
    const types = result.events.map((e) => e.type);
    // 执行成功（模型拿到错误回灌后正常收尾）与验收失败两个事实同时成立
    expect(types).toContain("tool.call.failed");
    expect(types).toContain("run.completed");
    expect(types).toContain("verification.completed");
    const failedTool = result.events.find((e) => e.type === "tool.call.failed");
    expect(failedTool?.attributes).toMatchObject({ toolName: "get_order" });
    expect(result.verification.status).toBe("failed");
    expect(result.events.find((e) => e.type === "verification.completed")?.status).toBe("failed");
    // 指标：工具失败率 1，但 Run 仍算成功（执行成功 ≠ 验收通过，两通道独立）
    const metrics = computeRunMetrics(result.events);
    expect(metrics.toolFailureRate).toBe(1);
    expect(metrics.runSuccessRate).toBe(1);
    expect(metrics.acceptancePassRate).toBe(0);
  });

  it("调用方 abort → run.cancelled（错误原样上抛，事件经 sink 可观测）", async () => {
    const controller = new AbortController();
    controller.abort(); // 开跑前取消：循环前置检查抛 ToolLoopAbortedError
    const { seen, sink } = collectingSink();
    await expect(
      runWithVerification({
        model: scriptedToolCallModel({ toolName: "get_order" }),
        messages: [{ role: "user", content: "订单 A-1024 到哪了？" }],
        tools: chatTools,
        signal: controller.signal,
        verifiers: [],
        eventSinks: [sink],
      }),
    ).rejects.toBeInstanceOf(ToolLoopAbortedError);
    const types = seen.map((e) => e.type);
    expect(types).toContain("run.started");
    expect(types).toContain("run.cancelled");
    expect(types).not.toContain("run.completed");
    // 取消不是失败也不是超时（终局映射规则 1）
    expect(types).not.toContain("run.failed");
    expect(types).not.toContain("run.timed_out");
    // sink 收到的是脱敏副本，但关联键经 recorder 补挂后与 runId 同源
    expect(new Set(seen.map((e) => e.runId)).size).toBe(1);
    const metrics = computeRunMetrics(seen);
    expect(metrics.runsTotal).toBe(1);
    expect(metrics.cancelRate).toBe(1);
    expect(metrics.runSuccessRate).toBeUndefined(); // cancelled 不进成功率分母
  });

  it("预算超时（AbortSignal.timeout + 挂死模型）→ run.timed_out，错误照常上抛", async () => {
    const previousRetries = process.env.AGENT_LLM_MAX_RETRIES;
    process.env.AGENT_LLM_MAX_RETRIES = "0"; // 免 SDK 退避重试：第一轮拒绝即终局，测试保持快
    const { seen, sink } = collectingSink();
    try {
      await expect(
        runWithVerification({
          model: hangingModel(),
          messages: [{ role: "user", content: "订单 A-1024 到哪了？" }],
          tools: chatTools,
          signal: AbortSignal.timeout(120), // 预算看门狗：120ms 必须收场
          verifiers: [],
          eventSinks: [sink],
        }),
      ).rejects.toThrow();
    } finally {
      if (previousRetries === undefined) delete process.env.AGENT_LLM_MAX_RETRIES;
      else process.env.AGENT_LLM_MAX_RETRIES = previousRetries;
    }
    const types = seen.map((e) => e.type);
    expect(types).toContain("run.started");
    expect(types).toContain("run.timed_out"); // AbortSignal.timeout 的 reason 是 TimeoutError → 终局映射规则 2
    expect(types).not.toContain("run.cancelled");
    expect(types).not.toContain("run.failed");
    expect(types).not.toContain("llm.request.failed"); // 挂在中止上的请求不算模型失败（失败率不掺水）
    expect(computeRunMetrics(seen).timeoutRate).toBe(1);
  });
});
