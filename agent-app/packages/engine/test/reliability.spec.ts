// reliability.spec.ts —— 可靠性故障注入矩阵（Phase 4，PRD §9 / §15.3 案例 4/7；离线零网络）。
// 剧本模型 + 故障工具复用 telemetry-integration.spec.ts / orchestrator.spec.ts 的既有模式：
// MockLanguageModelV2 逐轮吐内容、runWithVerification 的 eventSinks 作抛错路径的唯一观测出口、
// Orchestrator 注入确定性桩。矩阵覆盖：
//   LLM：请求超时 / 畸形输出（非法入参）/ 步数耗尽（§15.3 案例 4：明确失败终态，无无限重试）
//   工具：抛异常 / 业务错误返回 / 工具内部超时 / 调用方中途 abort / 空结果
//   取消：模型等待中 abort / 重复 abort 幂等 / cancel-vs-complete 竞态
//   编排：子任务失败落终态后断点续跑（§15.3 案例 7）/ StateStore 持久化抛错不脏状态
//   幂等（§9.2）：重试形状的重复调用经幂等壳去重
import { describe, expect, it } from "vitest";
import { tool } from "ai";
import type { LanguageModel } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { z } from "zod";
import { runToolLoop, ToolLoopAbortedError } from "../src/agent-loop.js";
import type { ToolLoopStepEvent } from "../src/agent-loop.js";
import { runWithVerification } from "../src/verification/run-with-verification.js";
import { createScriptedModel } from "../src/evals/fixtures.js";
import type { ScriptedModelTurn } from "../src/evals/types.js";
import { IdempotencyRegistry, wrapToolsWithIdempotency } from "../src/tools/idempotency.js";
import { Orchestrator } from "../src/orchestrator/orchestrator.js";
import { MemoryStateStore } from "../src/orchestrator/state-store.js";
import type { OrchestrationSnapshot, StateStore } from "../src/orchestrator/state-store.js";
import type { Executor } from "../src/orchestrator/roles.js";
import type { AgentRunEvent } from "../src/telemetry/events.js";
import type { RunEventSink } from "../src/telemetry/recorder.js";

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
type ScriptedResponse = Awaited<ReturnType<LanguageModelV2["doGenerate"]>>;

/** 收集 sink：Run 抛错时没有返回值可拿，sink 是唯一观测出口（telemetry-integration 同款） */
function collectingSink(): { seen: AgentRunEvent[]; sink: RunEventSink } {
  const seen: AgentRunEvent[] = [];
  return { seen, sink: (event) => void seen.push(event) };
}

/** unknown → Record 的运行时收窄（不用断言，形状不对按空对象处理） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 看门狗超时形状的挂死模型：等到 abort 才以 TimeoutError 拒绝（telemetry-integration 同款，
 *  AbortSignal.timeout 的 reason 即 TimeoutError → 终局映射规则 2 判 run.timed_out） */
function hangingModelRejectingTimeout(): LanguageModel {
  return new MockLanguageModelV2({
    doGenerate: ({ abortSignal }) =>
      new Promise<ScriptedResponse>((_, reject) => {
        const rejectWithTimeout = (): void => {
          const err = new Error("请求超时");
          err.name = "TimeoutError";
          reject(err);
        };
        if (abortSignal?.aborted) {
          rejectWithTimeout();
          return;
        }
        abortSignal?.addEventListener("abort", () => void rejectWithTimeout(), { once: true });
      }),
  });
}

/** 客户端取消形状的挂死模型：等到 abort 才以普通 AbortError 拒绝（终局映射规则 3 → run.cancelled；
 *  与 TimeoutError 形状分开，正是 run.timed_out 与 run.cancelled 的结构化分界） */
function hangingModelRejectingAbort(): LanguageModel {
  return new MockLanguageModelV2({
    doGenerate: ({ abortSignal }) =>
      new Promise<ScriptedResponse>((_, reject) => {
        const rejectWithAbort = (): void => {
          const err = new Error("请求已中止");
          err.name = "AbortError";
          reject(err);
        };
        if (abortSignal?.aborted) {
          rejectWithAbort();
          return;
        }
        abortSignal?.addEventListener("abort", () => rejectWithAbort(), { once: true });
      }),
  });
}

/** 脚本轮快捷构造 */
function toolTurn(toolName: string, input: Record<string, unknown>): ScriptedModelTurn {
  return { kind: "tool-calls", calls: [{ toolName, input }] };
}
function textTurn(text: string): ScriptedModelTurn {
  return { kind: "text", text };
}

/** 抛错路径统一关掉 SDK 传输层重试（telemetry-integration 同款 env 纪律） */
async function withNoRetries(body: () => Promise<void>): Promise<void> {
  const previous = process.env.AGENT_LLM_MAX_RETRIES;
  process.env.AGENT_LLM_MAX_RETRIES = "0";
  try {
    await body();
  } finally {
    if (previous === undefined) delete process.env.AGENT_LLM_MAX_RETRIES;
    else process.env.AGENT_LLM_MAX_RETRIES = previous;
  }
}

// ══ LLM 故障注入 ═════════════════════════════════════════════════════════

describe("可靠性矩阵 · LLM 故障", () => {
  it("请求超时：挂死模型 + AbortSignal.timeout → run.timed_out + 错误原样上抛（预算看门狗收场，不无限等）", async () => {
    await withNoRetries(async () => {
      const { seen, sink } = collectingSink();
      await expect(
        runWithVerification({
          model: hangingModelRejectingTimeout(),
          messages: [{ role: "user", content: "订单 A-1024 到哪了？" }],
          tools: {},
          signal: AbortSignal.timeout(120),
          verifiers: [],
          eventSinks: [sink],
        }),
      ).rejects.toThrow();
      const types = seen.map((e) => e.type);
      expect(types).toContain("run.started");
      expect(types).toContain("run.timed_out");
      expect(types).not.toContain("run.completed");
      expect(types).not.toContain("run.cancelled");
    });
  });

  it("畸形模型输出 / 非法工具参数：入参未过 schema → error-json 回灌，execute 零调用（循环存活；修复配套）", async () => {
    // SDK 对没过 schema 校验的工具调用不打断 generateText，而是把调用标成 invalid 混进
    // toolCalls（Phase 4 故障注入实测）。修复前的循环会无视标记把垃圾入参塞进 execute；
    // 修复后按失败通道折成 error-json 回灌——模型看得见、循环不死、工具不被脏参调用。
    const executeInputs: unknown[] = [];
    const steps: ToolLoopStepEvent[] = [];
    const tools = {
      query_logistics: tool({
        description: "按订单号查询物流",
        inputSchema: z.object({ orderId: z.string() }),
        execute: async (input) => {
          executeInputs.push(input);
          return { orderId: "A-1024", status: "已发货" };
        },
      }),
    };
    const run = await runToolLoop({
      model: createScriptedModel([
        toolTurn("query_logistics", { orderId: 123 }), // 畸形：schema 要 string，剧本给了数字
        textTurn("订单号格式不对，请核对后再试。"),
      ]),
      messages: [{ role: "user", content: "查订单 123 的物流" }],
      tools,
      maxSteps: 5,
      onStep: (event) => void steps.push(event),
    });
    expect(executeInputs).toHaveLength(0); // 脏参数绝不进 execute
    expect(run.text).toContain("核对");
    expect(steps).toHaveLength(1);
    const output = steps[0]?.output;
    if (!isRecord(output)) throw new Error("畸形入参步骤应产出 error-json 值");
    expect(typeof output.error).toBe("string");
    expect(String(output.error)).toContain("入参不合法");
    expect(String(output.error)).toContain("query_logistics");
  });

  it("§15.3 案例 4 · 步数耗尽：模型永远要工具 → 明确失败终态 run.failed，步数有界（无无限重试）", async () => {
    await withNoRetries(async () => {
      const { seen, sink } = collectingSink();
      // 剧本 3 轮全是要工具 + maxSteps=3：循环在第 3 步后以「步数用完」明确失败，
      // 模型调用次数 == maxSteps（有界），绝不出现无限重试
      await expect(
        runWithVerification({
          model: createScriptedModel([
            toolTurn("query_logistics", { orderId: "A-1024" }),
            toolTurn("query_logistics", { orderId: "A-1024" }),
            toolTurn("query_logistics", { orderId: "A-1024" }),
          ]),
          messages: [{ role: "user", content: "查物流" }],
          tools: {
            query_logistics: tool({
              description: "按订单号查询物流",
              inputSchema: z.object({ orderId: z.string() }),
              execute: async ({ orderId }) => ({ orderId, status: "已发货" }),
            }),
          },
          maxSteps: 3,
          verifiers: [],
          eventSinks: [sink],
        }),
      ).rejects.toThrow("步数用完");
      const types = seen.map((e) => e.type);
      expect(types.filter((t) => t === "llm.request.started")).toHaveLength(3); // 有界
      expect(types).toContain("run.failed"); // 明确失败终态（不是 cancelled/timed_out）
      expect(types).not.toContain("run.completed");
    });
  });
});

// ══ 工具故障注入 ═════════════════════════════════════════════════════════

describe("可靠性矩阵 · 工具故障", () => {
  it("工具抛异常：error-json 回灌（模型消息历史可见失败与原因），循环存活并收尾", async () => {
    const tools = {
      get_order: tool({
        description: "查订单",
        inputSchema: z.object({ orderId: z.string() }),
        execute: async (): Promise<{ status: string }> => {
          throw new Error("上游订单系统 500");
        },
      }),
    };
    const run = await runToolLoop({
      model: createScriptedModel([
        toolTurn("get_order", { orderId: "A-1024" }),
        textTurn("订单系统开小差了，请稍后再试。"),
      ]),
      messages: [{ role: "user", content: "订单 A-1024 到哪了？" }],
      tools,
      maxSteps: 5,
    });
    expect(run.text).toContain("稍后再试");
    // 失败以 error-json 回灌进消息历史：模型（与断言）都能区分「失败」与「业务数据」
    const toolMessage = run.messages.find((m) => m.role === "tool");
    const part = Array.isArray(toolMessage?.content) ? toolMessage.content[0] : undefined;
    const output = isRecord(part) ? part.output : undefined;
    if (!isRecord(output)) throw new Error("工具失败应产出 error-json 输出");
    expect(output.type).toBe("error-json");
    if (!isRecord(output.value)) throw new Error("error-json 应带 value 对象");
    expect(output.value.error).toContain("上游订单系统 500");
  });

  it("业务错误返回（resolve {error}，非抛错）：按引擎契约走成功通道原样透传——与失败通道区分", async () => {
    // 引擎契约（agent-loop.ts / run-with-verification.ts 头注释）：失败通道 = 抛错折成
    // error-json；工具业务上返回 { error: "..." } 属「业务数据」，循环按成功透传，
    // 语义修复责任在工具自身——本用例把这条边界钉进测试，防有人把两个通道悄悄合并。
    const steps: ToolLoopStepEvent[] = [];
    const tools = {
      check_stock: tool({
        description: "查库存",
        inputSchema: z.object({ sku: z.string() }),
        execute: async () => ({ error: "业务校验失败：库存服务返回不可用" }),
      }),
    };
    const run = await runToolLoop({
      model: createScriptedModel([toolTurn("check_stock", { sku: "X-1" }), textTurn("库存服务暂不可用。")]),
      messages: [{ role: "user", content: "查 X-1 库存" }],
      tools,
      maxSteps: 5,
      onStep: (event) => void steps.push(event),
    });
    expect(run.text).toContain("暂不可用");
    expect(steps[0]?.output).toEqual({ error: "业务校验失败：库存服务返回不可用" });
  });

  it("工具内部超时：AbortSignal.timeout 的工具 → error-json 回灌，模型看到失败后收尾，循环存活", async () => {
    const steps: ToolLoopStepEvent[] = [];
    const tools = {
      slow_search: tool({
        description: "慢查询",
        inputSchema: z.object({ q: z.string() }),
        execute: async ({ q }): Promise<{ q: string; result: string }> => {
          // 工具内部超时的标准姿势：预算到了就以 TimeoutError 形状拒绝
          //（AbortSignal.timeout 本身不是 thenable，直接 await 它不会抛——必须挂 reject）
          await new Promise<void>((_, reject) => {
            setTimeout(() => {
              const err = new Error("工具执行超时（60ms 预算耗尽）");
              err.name = "TimeoutError";
              reject(err);
            }, 60);
          });
          return { q, result: "ok" };
        },
      }),
    };
    const run = await runToolLoop({
      model: createScriptedModel([
        toolTurn("slow_search", { q: "退货政策" }),
        textTurn("查询超时，请稍后重试。"),
      ]),
      messages: [{ role: "user", content: "退货政策是什么" }],
      tools,
      maxSteps: 5,
      onStep: (event) => void steps.push(event),
    });
    const output = steps[0]?.output;
    if (!isRecord(output)) throw new Error("超时工具应产出 error-json 值");
    expect(output.error).toContain("slow_search 执行失败");
    expect(run.text).toContain("超时");
  });

  it("调用方在工具挂起期间 abort → 工具失败回灌 + 下一循环头抛 ToolLoopAbortedError（run.cancelled）", async () => {
    await withNoRetries(async () => {
      const controller = new AbortController();
      const { seen, sink } = collectingSink();
      const tools = {
        hang: tool({
          description: "挂起工具",
          inputSchema: z.object({ q: z.string().optional() }),
          execute: async (): Promise<{ status: string }> =>
            new Promise<{ status: string }>((_, reject) => {
              controller.signal.addEventListener("abort", () => reject(new Error("工具被调用方中止")), {
                once: true,
              });
            }),
        }),
      };
      setTimeout(() => controller.abort(), 40);
      await expect(
        runWithVerification({
          model: createScriptedModel([toolTurn("hang", { q: "" }), textTurn("不应到达")]),
          messages: [{ role: "user", content: "x" }],
          tools,
          signal: controller.signal,
          maxSteps: 3,
          verifiers: [],
          eventSinks: [sink],
        }),
      ).rejects.toBeInstanceOf(ToolLoopAbortedError);
      const types = seen.map((e) => e.type);
      expect(types).toContain("tool.call.failed"); // 工具先按失败通道收场
      expect(types).toContain("run.cancelled"); // 随后循环头的前置检查中止整轮
      expect(types).not.toContain("run.completed");
    });
  });

  it("空结果：工具返回 null / 空串 → 正常回灌（不捏造占位），循环存活", async () => {
    const outputs: unknown[] = [null, ""];
    const steps: ToolLoopStepEvent[] = [];
    const tools = {
      fetch_note: tool({
        description: "取便签",
        inputSchema: z.object({ q: z.string().optional() }),
        execute: async (): Promise<unknown> => outputs.shift(),
      }),
    };
    const run = await runToolLoop({
      model: createScriptedModel([
        toolTurn("fetch_note", { q: "" }),
        toolTurn("fetch_note", { q: "" }),
        textTurn("便签是空的。"),
      ]),
      messages: [{ role: "user", content: "取便签" }],
      tools,
      maxSteps: 5,
      onStep: (event) => void steps.push(event),
    });
    expect(steps.map((s) => s.output)).toEqual([null, ""]); // 空值原样回灌
    expect(run.text).toContain("便签是空的");
  });
});

// ══ 取消语义 ═════════════════════════════════════════════════════════════

describe("可靠性矩阵 · 取消语义", () => {
  it("模型等待中 abort → run.cancelled（无 llm.request.failed——取消不算模型失败，失败率不掺水）", async () => {
    await withNoRetries(async () => {
      const controller = new AbortController();
      const { seen, sink } = collectingSink();
      setTimeout(() => controller.abort(), 40);
      await expect(
        runWithVerification({
          model: hangingModelRejectingAbort(),
          messages: [{ role: "user", content: "x" }],
          tools: {},
          signal: controller.signal,
          verifiers: [],
          eventSinks: [sink],
        }),
      ).rejects.toThrow();
      const types = seen.map((e) => e.type);
      expect(types).toContain("run.cancelled");
      expect(types).not.toContain("llm.request.failed");
      expect(types).not.toContain("run.failed");
      expect(types).not.toContain("run.timed_out");
    });
  });

  it("重复 abort 幂等：连续两次 abort → 恰好一条 run.cancelled 终态，不炸不重记", async () => {
    await withNoRetries(async () => {
      const controller = new AbortController();
      const { seen, sink } = collectingSink();
      controller.abort();
      controller.abort(); // 第二次是 no-op：DOM AbortController 首次生效，重复调用无副作用
      await expect(
        runWithVerification({
          model: hangingModelRejectingAbort(),
          messages: [{ role: "user", content: "x" }],
          tools: {},
          signal: controller.signal,
          verifiers: [],
          eventSinks: [sink],
        }),
      ).rejects.toThrow();
      expect(seen.filter((e) => e.type === "run.cancelled")).toHaveLength(1);
      expect(seen.filter((e) => e.type.startsWith("run."))).toHaveLength(2); // started + cancelled，仅此两条
    });
  });

  it("cancel-vs-complete 竞态：循环 resolve 之后再 abort → resolution wins（run.completed 在案，事后 abort 不追认）", async () => {
    const controller = new AbortController();
    const { seen, sink } = collectingSink();
    const result = await runWithVerification({
      model: createScriptedModel([toolTurn("get_order", { orderId: "A-1024" }), textTurn("已发货。")]),
      messages: [{ role: "user", content: "订单 A-1024 到哪了？" }],
      tools: {
        get_order: tool({
          description: "查订单",
          inputSchema: z.object({ orderId: z.string() }),
          execute: async ({ orderId }) => ({ orderId, status: "已发货" }),
        }),
      },
      signal: controller.signal,
      verifiers: [],
      eventSinks: [sink],
    });
    controller.abort(); // 完成之后才取消：信号只在循环内被检查，追认不了已 resolve 的 Run
    expect(result.run.text).toBe("已发货。");
    const terminalTypes = seen
      .map((e) => e.type)
      .filter(
        (t) => t === "run.completed" || t === "run.failed" || t === "run.cancelled" || t === "run.timed_out",
      );
    expect(terminalTypes).toEqual(["run.completed"]);
    expect(seen.some((e) => e.type === "run.cancelled")).toBe(false);
  });
});

// ══ 编排器故障注入（§9.1 / §15.3 案例 7）═════════════════════════════════

describe("可靠性矩阵 · 编排器故障注入", () => {
  it("§15.3 案例 7 · 子任务失败落 failed 终态 → 断点续跑不重跑已成功子任务，下游补跑解锁（修复配套）", async () => {
    const store = new MemoryStateStore();
    const run1Executed: string[] = [];
    const flakyExecutor: Executor = {
      execute: async (task) => {
        run1Executed.push(task.id);
        if (task.id === "t2") throw new Error("下游依赖服务挂了");
        return { taskId: task.id, text: `${task.title} 完成`, tokensUsed: 100, durationMs: 1, steps: 1 };
      },
    };
    const orch1 = new Orchestrator({
      stateStore: store,
      executor: flakyExecutor,
      // compensate：补偿后上抛原始错误 → failed 终态（failed → executing 合法，可续跑）
      failurePolicy: { onFail: "compensate", compensate: async () => {} },
    });
    await expect(
      orch1.runAsync({
        id: "orch-resume-fail",
        goal: "",
        tasks: [
          { id: "t1", title: "前置任务", goal: "" },
          { id: "t2", title: "下游任务", goal: "", dependsOn: ["t1"] },
        ],
      }),
    ).rejects.toThrow("下游依赖服务挂了");

    // 修复点 1：失败路径把已完成子任务回写快照——修复前快照 outputs 为空，续跑会重跑 t1
    const snapshot = await store.load("orch-resume-fail");
    expect(snapshot?.state).toBe("failed");
    expect(snapshot?.outputs.map((o) => o.taskId)).toEqual(["t1"]);
    expect(run1Executed).toEqual(["t1", "t2"]);

    // 续跑：t1 不重跑；t2 的依赖边已在上一轮满足（修复点 2），补跑直接解锁
    const run2Executed: string[] = [];
    const orch2 = new Orchestrator({
      stateStore: store,
      executor: {
        execute: async (task) => {
          run2Executed.push(task.id);
          return {
            taskId: task.id,
            text: `${task.title} 补跑成功`,
            tokensUsed: 100,
            durationMs: 1,
            steps: 1,
          };
        },
      },
    });
    const result = await orch2.runAsync({
      id: "orch-resume-fail",
      goal: "",
      tasks: [
        { id: "t1", title: "前置任务", goal: "" },
        { id: "t2", title: "下游任务", goal: "", dependsOn: ["t1"] },
      ],
    });
    expect(result.state).toBe("done");
    expect(run2Executed).toEqual(["t2"]);
    expect(result.outputs.map((o) => o.taskId)).toEqual(["t1", "t2"]);
  });

  it("StateStore 持久化抛错 → 错误原样上抛，快照停留在最后一次成功保存的完整状态（不脏）", async () => {
    // 半写不进的磁盘：第一次 save 放行，之后全炸——编排器必须把存储错误上抛
    //（Effect.tryPromise 的 cause 通道）而不是吞掉假装成功；快照永远只含完整保存
    //（MemoryStateStore 的 structuredClone 语义），不存在半截状态。executing 态
    // 按迁移表不可重入（只有 done/failed → executing 合法）：崩溃恢复属编排器
    // 状态机语义，不在本阶段改动范围。
    class FlakySaveStore implements StateStore {
      private readonly inner = new MemoryStateStore();
      private saves = 0;
      async save(snapshot: OrchestrationSnapshot): Promise<void> {
        this.saves += 1;
        if (this.saves > 1) throw new Error("磁盘写满：持久化失败");
        await this.inner.save(snapshot);
      }
      load(id: string): Promise<OrchestrationSnapshot | undefined> {
        return this.inner.load(id);
      }
    }
    const store = new FlakySaveStore();
    const orch = new Orchestrator({
      stateStore: store,
      executor: {
        execute: async (task) => ({
          taskId: task.id,
          text: `${task.title} 完成`,
          tokensUsed: 100,
          durationMs: 1,
          steps: 1,
        }),
      },
    });
    await expect(
      orch.runAsync({ id: "orch-store-crash", goal: "", tasks: [{ id: "t1", title: "子任务", goal: "" }] }),
    ).rejects.toThrow("磁盘写满");

    // 状态不脏：停在最后一次成功保存的 executing（子任务内存里完成了，但没落盘就是没完成）
    const snapshot = await store.load("orch-store-crash");
    expect(snapshot?.state).toBe("executing");
    expect(snapshot?.outputs).toHaveLength(0);
  });
});

// ══ 幂等（§9.2）══════════════════════════════════════════════════════════

describe("可靠性矩阵 · 幂等（§9.2）", () => {
  it("重试形状的重复调用经幂等壳去重：同 scope 同参二次调用不重复执行副作用", async () => {
    // 生产纪律：有副作用的工具（建工单/退款/发消息）必须先包幂等壳再允许任何重试
    // 发生——传输层/应用层重试叠加没有幂等键 = 重复扣款。本用例在真实 runToolLoop
    // 里用「模型两轮点名同一工具同一参数」的 retry 形状验证去重。
    let executeCalls = 0;
    const baseTools = {
      create_ticket: tool({
        description: "建工单",
        inputSchema: z.object({ subject: z.string(), description: z.string() }),
        execute: async (input) => {
          executeCalls += 1;
          return { ticketId: "TK-RETRY-0001", ...input };
        },
      }),
    };
    const wrapped = wrapToolsWithIdempotency(baseTools, new IdempotencyRegistry(), { scope: "sess-retry" });
    const steps: ToolLoopStepEvent[] = [];
    const run = await runToolLoop({
      model: createScriptedModel([
        toolTurn("create_ticket", { subject: "催单", description: "订单 A-1024 三天未发货" }),
        toolTurn("create_ticket", { subject: "催单", description: "订单 A-1024 三天未发货" }), // 重试形状：同参重放
        textTurn("工单已建好。"),
      ]),
      messages: [{ role: "user", content: "帮我催单" }],
      tools: wrapped,
      maxSteps: 5,
      onStep: (event) => void steps.push(event),
    });
    expect(run.text).toContain("已建好");
    expect(executeCalls).toBe(1); // 副作用只执行一次
    expect(steps).toHaveLength(2);
    expect(steps[0]?.output).toEqual(steps[1]?.output); // 重放拿到首次的同一结果
  });
});
