// telemetry.spec.ts —— 统一观测模块的行为测试（离线、确定性）：事件模型不变量 /
// 脱敏政策 / 记录器（关联性 + sink 故障兜底 + legacy 开关）/ 指标聚合（分母与排除
// 规则）/ 闸门的 guardrail.triggered 可选发射缝。缺数据政策的 JSON 键缺席用
// JSON.stringify 往返校验（undefined 值的键会被剔除——政策靠语言原生行为执行）。
import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RUN_EVENT_TYPES, createRunEvent, UNASSIGNED_CORRELATION } from "../src/telemetry/events.js";
import type { AgentRunEvent, RunEventType } from "../src/telemetry/events.js";
import { redactEvent } from "../src/telemetry/redact.js";
import { createRunEventRecorder, createStderrJsonSink } from "../src/telemetry/recorder.js";
import type { RunEventSink } from "../src/telemetry/recorder.js";
import { computeRunMetrics } from "../src/telemetry/metrics.js";
import { wrapToolWithGate } from "../src/guardrails/gate.js";

/** 测试事件夹具：身份键随机、其余按需覆盖 */
function ev(type: RunEventType, runId: string, extra: Partial<AgentRunEvent> = {}): AgentRunEvent {
  return {
    eventId: randomUUID(),
    runId,
    traceId: `trace-${runId}`,
    type,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

describe("事件模型不变量", () => {
  it("createRunEvent 填齐身份键：eventId 为 UUID、timestamp 为合法 ISO 8601", () => {
    const event = createRunEvent("run.started", { runId: "run-1", traceId: "trace-1" });
    expect(event.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
    expect(event.runId).toBe("run-1");
    expect(event.traceId).toBe("trace-1");
    expect(event.type).toBe("run.started");
  });

  it("事件目录完整且唯一：无重复、覆盖七个域、子目录成对", () => {
    expect(new Set(RUN_EVENT_TYPES).size).toBe(RUN_EVENT_TYPES.length);
    for (const domain of ["run", "llm", "tool", "retry", "verification", "subrun", "guardrail"]) {
      expect(RUN_EVENT_TYPES.some((t) => t.startsWith(`${domain}.`))).toBe(true);
    }
    // 终态四值与 run-contract 的 TerminalRunStatus 对齐（completed↔succeeded）
    for (const terminal of ["run.completed", "run.failed", "run.cancelled", "run.timed_out"]) {
      expect(RUN_EVENT_TYPES).toContain(terminal);
    }
  });

  it("缺数据 = 键缺席：不给细节时可选键在 JSON 里不存在（绝不捏造零值）", () => {
    const event = createRunEvent("llm.request.started", { runId: "run-1", traceId: "trace-1" });
    const roundtrip = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
    for (const key of ["parentRunId", "stepId", "durationMs", "status", "attempt", "attributes"]) {
      expect(key in event).toBe(false);
      expect(key in roundtrip).toBe(false);
    }
  });

  it("给了细节就落键：undefined 之外的原生形状原样保留", () => {
    const event = createRunEvent(
      "tool.call.completed",
      { runId: "run-1", traceId: "trace-1", parentRunId: "parent-1" },
      { stepId: "call-1", durationMs: 5, attempt: 2, attributes: { toolName: "get_order" } },
    );
    expect(event.parentRunId).toBe("parent-1");
    expect(event.stepId).toBe("call-1");
    expect(event.durationMs).toBe(5);
    expect(event.attempt).toBe(2);
    expect(event.attributes).toEqual({ toolName: "get_order" });
  });
});

describe("redactEvent 脱敏政策", () => {
  it("字符串值里的 OpenAI 风格密钥 → [REDACTED:openai_key]", () => {
    const event = ev("llm.request.failed", "run-1", {
      attributes: { errorMessage: "调用失败：密钥 sk-proj-abcdef1234567890abcdef 无效" },
    });
    const redacted = redactEvent(event);
    expect(JSON.stringify(redacted.attributes)).not.toContain("sk-proj-abcdef");
    expect(redacted.attributes).toMatchObject({
      errorMessage: expect.stringContaining("[REDACTED:openai_key]"),
    });
  });

  it("字符串值里的 Bearer 令牌 → [REDACTED:bearer_token]", () => {
    const event = ev("llm.request.started", "run-1", {
      attributes: { header: "Bearer abc12345xyz9" },
    });
    const redacted = redactEvent(event);
    expect(redacted.attributes).toMatchObject({ header: expect.stringContaining("[REDACTED:bearer_token]") });
  });

  it("秘密属性 KEY（api_key / apiKey / password / authorization）整值替换为类别标记", () => {
    const event = ev("tool.call.started", "run-1", {
      attributes: {
        api_key: "raw-secret-value-123",
        apiKey: "raw-camel-456",
        password: "hunter2",
        authorization: "Basic dXNlcjpwYXNz",
        openai_api_key: "sk-proj-abcdef1234567890abcdef",
      },
    });
    const redacted = redactEvent(event);
    expect(redacted.attributes).toEqual({
      api_key: "[REDACTED:api_key]",
      apiKey: "[REDACTED:api_key]",
      password: "[REDACTED:password]",
      authorization: "[REDACTED:token]",
      openai_api_key: "[REDACTED:api_key]",
    });
  });

  it("普通 KEY 不误伤：tokenizer / tokenCount 这类只沾边的键原样保留", () => {
    const event = ev("llm.request.completed", "run-1", {
      attributes: { tokenizer: "cl100k_base", toolCount: 3 },
    });
    const redacted = redactEvent(event);
    expect(redacted.attributes).toEqual({ tokenizer: "cl100k_base", toolCount: 3 });
  });

  it("中文语境 PII 走 maskPii：手机号保头尾，非 PII 文本原样", () => {
    const event = ev("tool.call.completed", "run-1", {
      attributes: { output: "用户手机号 13812345678 已核实" },
    });
    const redacted = redactEvent(event);
    expect(redacted.attributes).toMatchObject({ output: expect.stringContaining("138****5678") });
    expect(JSON.stringify(redacted.attributes)).not.toContain("13812345678");
  });

  it("非字符串属性原样保留（数字/布尔/null 是指标聚合的原料）", () => {
    const event = ev("llm.request.completed", "run-1", {
      attributes: {
        usage: { totalTokens: 42, paid: true, note: null },
        attempt: 2,
      },
    });
    const redacted = redactEvent(event);
    expect(redacted.attributes).toEqual({ usage: { totalTokens: 42, paid: true, note: null }, attempt: 2 });
  });

  it("嵌套结构里的字符串值同样脱敏（递归下钻：秘密 KEY 整值替换 + 普通 KEY 走 PII）", () => {
    const event = ev("tool.call.started", "run-1", {
      attributes: {
        context: { nested: { api_key: "raw-nested-secret" }, plain: "含手机号 13911112222 的备注" },
      },
    });
    const redacted = redactEvent(event);
    expect(redacted.attributes).toMatchObject({
      context: { nested: { api_key: "[REDACTED:api_key]" }, plain: expect.stringContaining("139****2222") },
    });
  });

  it("默认开启（fail-safe）：不传 policy 与传 {} 等效；显式 enabled:false 才放行原文", () => {
    const event = ev("tool.call.started", "run-1", {
      attributes: { api_key: "raw-secret-value" },
    });
    expect(redactEvent(event)).toEqual(redactEvent(event, {}));
    expect(redactEvent(event, { enabled: false }).attributes).toEqual({ api_key: "raw-secret-value" });
  });

  it("纯函数：入参事件不被修改（脱敏产物是新对象）", () => {
    const event = ev("tool.call.started", "run-1", { attributes: { api_key: "raw-secret-value" } });
    const snapshot = JSON.stringify(event);
    redactEvent(event);
    expect(JSON.stringify(event)).toBe(snapshot);
  });
});

describe("createRunEventRecorder", () => {
  it("关联性按构造成立：emit 的所有事件共享 runId/traceId，eventId 唯一", () => {
    const recorder = createRunEventRecorder({ runId: "run-1", traceId: "trace-1", sinks: [] });
    recorder.emit("run.started");
    recorder.emit("llm.request.started", { attempt: 1 });
    recorder.emit("run.completed", { durationMs: 10 });
    const all = recorder.all();
    expect(all).toHaveLength(3);
    expect(all.every((e) => e.runId === "run-1" && e.traceId === "trace-1")).toBe(true);
    expect(new Set(all.map((e) => e.eventId)).size).toBe(3);
  });

  it("ingest 补挂空关联键：外部发射点的事件落账后与本 Run 同源", () => {
    const recorder = createRunEventRecorder({ runId: "run-1", traceId: "trace-1", sinks: [] });
    const loopEvent = createRunEvent(
      "tool.call.started",
      { runId: UNASSIGNED_CORRELATION, traceId: UNASSIGNED_CORRELATION },
      { attempt: 1 },
    );
    recorder.ingest(loopEvent);
    const [recorded] = recorder.all();
    expect(recorded?.runId).toBe("run-1");
    expect(recorded?.traceId).toBe("trace-1");
    expect(recorded?.attempt).toBe(1);
  });

  it("ingest 恰好一次：同一 eventId 重复收编是 no-op", () => {
    const recorder = createRunEventRecorder({ runId: "run-1", traceId: "trace-1", sinks: [] });
    const loopEvent = createRunEvent("llm.request.started", {
      runId: UNASSIGNED_CORRELATION,
      traceId: UNASSIGNED_CORRELATION,
    });
    recorder.ingest(loopEvent);
    recorder.ingest(loopEvent); // 调用方转发 + 手动收编的双路径去重
    expect(recorder.all()).toHaveLength(1);
  });

  it("sink 抛错被兜住：总账分毫无损，emit 不上抛", () => {
    const exploding: RunEventSink = () => {
      throw new Error("下游采集器宕机");
    };
    const recorder = createRunEventRecorder({ runId: "run-1", traceId: "trace-1", sinks: [exploding] });
    expect(() => recorder.emit("run.started")).not.toThrow();
    expect(() => recorder.emit("run.completed", { durationMs: 1 })).not.toThrow();
    expect(recorder.all()).toHaveLength(2);
  });

  it("sink 只见脱敏副本，总账保留原文（指标聚合要用真实数字）", () => {
    const seen: AgentRunEvent[] = [];
    const recorder = createRunEventRecorder({
      runId: "run-1",
      traceId: "trace-1",
      sinks: [(e) => seen.push(e)],
    });
    recorder.emit("tool.call.started", { attributes: { api_key: "raw-secret-value" } });
    expect(seen[0]?.attributes).toEqual({ api_key: "[REDACTED:api_key]" });
    expect(recorder.all()[0]?.attributes).toEqual({ api_key: "raw-secret-value" });
  });

  it("legacy AGENT_TRACE 未开启 → 内建 stderr sink 零输出（默认行为逐字节不变）", () => {
    const previous = process.env.AGENT_TRACE;
    delete process.env.AGENT_TRACE;
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const recorder = createRunEventRecorder({ runId: "run-1", traceId: "trace-1" }); // 默认 sink = stderr
      recorder.emit("run.started");
      const relevant = stderrSpy.mock.calls.filter((args) => String(args[0]).includes("run.started"));
      expect(relevant).toHaveLength(0);
    } finally {
      stderrSpy.mockRestore();
      if (previous === undefined) delete process.env.AGENT_TRACE;
      else process.env.AGENT_TRACE = previous;
    }
  });

  it("内建 stderr sink 开着 AGENT_TRACE 时输出 JSON 行（新事件流与 icon 行并存）", () => {
    process.env.AGENT_TRACE = "1";
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const sink = createStderrJsonSink();
      const event = createRunEvent("run.started", { runId: "run-1", traceId: "trace-1" });
      sink(event);
      const lines = stderrSpy.mock.calls
        .map((args) => String(args[0]))
        .filter((s) => s.includes("run.started"));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ runId: "run-1", type: "run.started" });
    } finally {
      stderrSpy.mockRestore();
      delete process.env.AGENT_TRACE;
    }
  });
});

describe("computeRunMetrics", () => {
  it("空事件流：runsTotal 0，一切比率 undefined（不冒充 0%）", () => {
    const metrics = computeRunMetrics([]);
    expect(metrics.runsTotal).toBe(0);
    expect(metrics.runSuccessRate).toBeUndefined();
    expect(metrics.cancelRate).toBeUndefined();
    expect(metrics.latencyMs).toBeUndefined();
    const roundtrip = JSON.parse(JSON.stringify(metrics)) as Record<string, unknown>;
    expect("runSuccessRate" in roundtrip).toBe(false);
  });

  it("in-flight（只有 run.started）不计终态：runsTotal 0", () => {
    expect(computeRunMetrics([ev("run.started", "run-1")]).runsTotal).toBe(0);
  });

  it("cancelled 不进成功率分母：1 成功 + 1 取消 → 成功率 1（不是 0.5），取消率 0.5", () => {
    const metrics = computeRunMetrics([
      ev("run.started", "run-1"),
      ev("run.completed", "run-1", { durationMs: 100 }),
      ev("run.started", "run-2"),
      ev("run.cancelled", "run-2", { durationMs: 5 }),
    ]);
    expect(metrics.runsTotal).toBe(2);
    expect(metrics.runSuccessRate).toBe(1);
    expect(metrics.cancelRate).toBe(0.5);
    expect(metrics.timeoutRate).toBe(0);
  });

  it("取消的时长不进分位数样本：latency 只剩成功 Run 的 durationMs", () => {
    const metrics = computeRunMetrics([
      ev("run.completed", "run-1", { durationMs: 100 }),
      ev("run.cancelled", "run-2", { durationMs: 9999 }),
    ]);
    expect(metrics.latencyMs).toEqual({ p50: 100, p95: 100 });
  });

  it("P50/P95 用 nearest-rank：4 样本 p50=第2、p95=第4；10 样本 p50=第5、p95=第10", () => {
    const four = computeRunMetrics(
      [10, 20, 30, 40].map((d, i) => ev("run.completed", `r${i}`, { durationMs: d })),
    );
    expect(four.latencyMs).toEqual({ p50: 20, p95: 40 });
    const ten = computeRunMetrics(
      Array.from({ length: 10 }, (_, i) => ev("run.completed", `s${i}`, { durationMs: (i + 1) * 10 })),
    );
    expect(ten.latencyMs).toEqual({ p50: 50, p95: 100 });
  });

  it("验收通过率：到达验收的 2 个 Run 中 1 个最终 passed → 0.5（started 无 completed 也算分母）", () => {
    const metrics = computeRunMetrics([
      ev("run.started", "run-1"),
      ev("run.completed", "run-1", { durationMs: 10 }),
      ev("verification.started", "run-1"),
      ev("verification.completed", "run-1", { status: "passed" }),
      ev("run.started", "run-2"),
      ev("run.completed", "run-2", { durationMs: 10 }),
      ev("verification.started", "run-2"), // 中断：没有 completed
      ev("run.started", "run-3"),
      ev("run.completed", "run-3", { durationMs: 10 }), // 没到验收：不进任何一侧
    ]);
    expect(metrics.acceptancePassRate).toBe(0.5);
  });

  it("领域失败率：3 完成 + 1 失败 → 0.25；0/0 → undefined", () => {
    const llmEvents = [
      ...[1, 2, 3].map((i) => ev("llm.request.completed", `run-${i}`)),
      ev("llm.request.failed", "run-4"),
    ];
    expect(computeRunMetrics(llmEvents).llmFailureRate).toBe(0.25);
    expect(computeRunMetrics([ev("run.started", "run-1")]).llmFailureRate).toBeUndefined();
    const toolEvents = [
      ...[1, 2].map((i) => ev("tool.call.completed", `run-${i}`)),
      ev("tool.call.failed", "run-4"),
    ];
    expect(computeRunMetrics(toolEvents).toolFailureRate).toBeCloseTo(1 / 3);
  });

  it("retryRate：无 retry 事件 → undefined（没观测到 ≠ 没重试）；有数据 → 命中 Run 数 / 终态 Run 数", () => {
    const withoutRetry = [ev("run.completed", "run-1"), ev("run.failed", "run-2")];
    expect(computeRunMetrics(withoutRetry).retryRate).toBeUndefined();
    const withRetry = [
      ...withoutRetry,
      ev("retry.scheduled", "run-1"),
      ev("retry.scheduled", "run-1"), // 同 Run 多次调度只算一个 Run
    ];
    expect(computeRunMetrics(withRetry).retryRate).toBe(0.5);
  });

  it("timeoutRate 用质量分母（1/3），cancelRate 用全终态分母（1/4）——两个口径并存", () => {
    const metrics = computeRunMetrics([
      ev("run.completed", "run-1", { durationMs: 10 }),
      ev("run.failed", "run-2", { durationMs: 10 }),
      ev("run.timed_out", "run-3", { durationMs: 10 }),
      ev("run.cancelled", "run-4"),
    ]);
    expect(metrics.timeoutRate).toBeCloseTo(1 / 3);
    expect(metrics.runSuccessRate).toBeCloseTo(1 / 3);
    expect(metrics.cancelRate).toBeCloseTo(1 / 4);
  });

  it("totalTokens 只累加真实 usage：缺席事件不贡献也不清零，全缺 → undefined", () => {
    const partial = [
      ev("llm.request.completed", "run-1", { attributes: { usage: { totalTokens: 10 } } }),
      ev("llm.request.completed", "run-2"), // 无 usage：不贡献，但不清掉已有的 10
      ev("llm.request.completed", "run-3", { attributes: { usage: { totalTokens: 30 } } }),
    ];
    expect(computeRunMetrics(partial).totalTokens).toBe(40);
    expect(computeRunMetrics([ev("llm.request.completed", "run-1")]).totalTokens).toBeUndefined();
    expect(computeRunMetrics([]).totalTokens).toBeUndefined();
  });

  it("estimatedCost 只认显式 costUsd 标注：无标注 → undefined（引擎不猜成本）", () => {
    const withCost = [
      ev("llm.request.completed", "run-1", { attributes: { usage: { totalTokens: 100 }, costUsd: 0.5 } }),
      ev("llm.request.completed", "run-2", { attributes: { usage: { totalTokens: 50 }, costUsd: 0.25 } }),
    ];
    expect(computeRunMetrics(withCost).estimatedCostUsd).toBeCloseTo(0.75);
    expect(computeRunMetrics(withCost).totalTokens).toBe(150);
    expect(computeRunMetrics([ev("llm.request.completed", "run-1")]).estimatedCostUsd).toBeUndefined();
  });

  it("同一 Run 多条终态（脏数据）取最后一条，不双记", () => {
    const metrics = computeRunMetrics([
      ev("run.started", "run-1"),
      ev("run.failed", "run-1", { durationMs: 1 }),
      ev("run.completed", "run-1", { durationMs: 100 }),
    ]);
    expect(metrics.runsTotal).toBe(1);
    expect(metrics.runSuccessRate).toBe(1);
    expect(metrics.latencyMs).toEqual({ p50: 100, p95: 100 });
  });
});

describe("guardrail.triggered 可选发射缝（wrapToolWithGate）", () => {
  const gatedTool = tool({
    description: "演示工具",
    inputSchema: z.object({ q: z.string() }),
    execute: async () => ({ ok: true }),
  });

  it("不传 emitEvent → 拒绝路径零变化（结构化拒绝照常返回）", async () => {
    const gated = wrapToolWithGate(gatedTool, { name: "demo", allowlist: [] });
    const result = (await gated.execute?.({ q: "x" }, { toolCallId: "c1", messages: [] })) as {
      denied: boolean;
    };
    expect(result.denied).toBe(true);
  });

  it("传 emitEvent → 拒绝时收到 guardrail.triggered，工具名与原因在属性里", async () => {
    const seen: AgentRunEvent[] = [];
    const gated = wrapToolWithGate(gatedTool, {
      name: "demo",
      allowlist: [],
      emitEvent: (e) => seen.push(e),
    });
    await gated.execute?.({ q: "x" }, { toolCallId: "c1", messages: [] });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.type).toBe("guardrail.triggered");
    expect(seen[0]?.attributes).toMatchObject({ toolName: "demo" });
    expect(seen[0]?.runId).toBe(UNASSIGNED_CORRELATION); // 闸门无 Run 归属，经 recorder.ingest 补挂
  });

  it("放行路径不发射（只有拒绝才是 guardrail 事件）", async () => {
    const seen: AgentRunEvent[] = [];
    const gated = wrapToolWithGate(gatedTool, {
      name: "demo",
      allowlist: null,
      emitEvent: (e) => seen.push(e),
    });
    await gated.execute?.({ q: "x" }, { toolCallId: "c1", messages: [] });
    expect(seen).toHaveLength(0);
  });
});

afterEach(() => {
  delete process.env.AGENT_TRACE;
});
