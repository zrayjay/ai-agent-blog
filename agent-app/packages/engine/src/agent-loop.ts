// agent-loop.ts —— 手写多步工具循环：《week11 主线补篇 · Agent 循环 TS 深入》的逐行对应
//
// SDK 替你转的三件事这里亲笔写（对应教程的 ①②③）：
//   ① 入账：result.response.messages 是这轮 assistant 侧全部消息（含调用意图），
//      原样 push 进历史，模型下一轮才记得自己要过什么
//   ② 调度：按 toolName 从工具表里找到实现，执行它的 execute
//   ③ 回灌：结果拼成 role: "tool" 消息塞回历史，回到循环头再问一次模型
//
// 版本适配说明（ai 5.0.266 实测，见 selftest 的工具循环用例）：
// - 直接把带 execute 的工具喂给 generateText，SDK 会替你执行并把 tool-result
//   合进 response.messages，与手写调度重复入账。所以给模型的是 schema-only 视图，
//   执行权握在自己手里——这正是教程手写版「工具只写 schema 不写 execute」的等价实现。
// - tool-result 消息的 output 字段收结构化形状（LanguageModelV2ToolResultOutput），
//   教程示例里的裸对象在这版类型收紧了：正常结果用 { type: "json" }，失败用 { type: "error-json" }。
import { generateText, tool as defineTool } from "ai";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import { EngineError } from "./errors.js";
import { llmCallPolicy } from "./llm.js";
import { preview, trace } from "./trace.js";
import type { AgentRunEvent, RunEventType } from "./telemetry/events.js";
import { createRunEvent, UNASSIGNED_CORRELATION } from "./telemetry/events.js";

/** 步数上限的库级默认值：调用方（api / cli / workers）统一引用，magic number 不散落 */
export const DEFAULT_MAX_STEPS = 5;

/** 手写循环的入参：model / messages / tools / maxSteps，maxSteps 对应 SDK 版的 stopWhen: isStepCount(n) */
export interface RunToolLoopOptions {
  model: LanguageModel;
  messages: ModelMessage[];
  tools: ToolSet;
  /** 可选 system 提示词：走 generateText 的 system 选项，不塞进 messages（SDK 推荐做法，防注入提示更稳） */
  system?: string;
  /** 步数上限（保险丝），默认 5 */
  maxSteps?: number;
  /**
   * 可选单步回调：每次工具执行并回灌后同步调用。
   * 纯观察性钩子——不传时行为与旧版完全一致（既有调用方零改动）。
   */
  onStep?: (event: ToolLoopStepEvent) => void;
  /**
   * 可选结构化事件回调（Phase 2 统一事件模型的发射接缝，纯观察性）。
   * 循环在模型请求（llm.request.*）与工具执行（tool.call.*）边界发射
   * AgentRunEvent；不传（默认 undefined）时零行为差异——发射语句全是
   * `onEvent?.(...)`，代码路径与旧版逐字节一致（onStep/signal 同款加参纪律）。
   * 注意：循环不认识 Run 概念，事件的 runId/traceId 以空串占位——消费方应经
   * recorder.ingest 落账（补挂真实关联键 + 恰好一次去重），不要直接消费占位键。
   */
  onEvent?: (event: AgentRunEvent) => void;
  /**
   * 可选中止信号（生产缺陷修复：SSE 客户端断开后停止烧 token）。
   * API 层把客户端断开（response close）接到 AbortController 上、signal 传进来：
   * - 透传给每一步 generateText 的 abortSignal（SDK 在模型调用层响应中止，
   *   正在进行的请求会以 AbortError 拒绝）；
   * - 每步工具执行回灌之后、发起下一次模型调用之前检查 aborted——客户端已经
   *   不在了，继续调模型纯粹是烧 token，直接抛「已中止」退出循环。
   * 不传（默认 undefined）时行为与旧版完全一致：abortSignal: undefined 是
   * generateText 的默认值，前置检查也被短路（?.）——既有调用方（CLI / 评测）
   * 零改动、零感知。
   */
  signal?: AbortSignal;
}

/** 中止时抛出的错误消息（导出常量：文案单一事实源，错误类与旧文案比对共用它） */
export const TOOL_LOOP_ABORTED = "工具循环已中止：调用方在完成前 abort 了 signal";

/**
 * 循环因 abort 中止时抛出的领域错误：调用方按 `instanceof ToolLoopAbortedError`
 * 分支识别「因中止而退出」（旧写法是比对 message === TOOL_LOOP_ABORTED，文案一改
 * 分支就静默失效——类型化后文案随便改）。常量保留供文案断言/日志复用。
 */
export class ToolLoopAbortedError extends EngineError {
  constructor(message: string = TOOL_LOOP_ABORTED) {
    super(message);
  }
}

/** 循环结果：最终回复文本 + 维护到底的完整消息历史 + 实际步数 + token 消耗（预算记账） */
export interface ToolLoopResult {
  text: string;
  messages: ModelMessage[];
  steps: number;
  /** 全部轮次的总 token 消耗（编排器预算记账用；部分网关不回传时为 undefined） */
  usage?: { totalTokens: number };
}

/**
 * 单步事件（可选回调 onStep 的载荷）：第几步、模型要调什么工具、本地执行拿到的输出。
 * HTTP API 的 SSE 流式端点把它原样转成 {type:"step"} 事件；审计日志同理。
 */
export interface ToolLoopStepEvent {
  step: number;
  toolCall: { toolName: string; input: unknown };
  output: unknown;
  /**
   * 模型本步伴随工具调用的文本（有些模型会在调工具前先"说"一句推理或说明）。
   * function-calling 模型（如 glm-4-flash）此字段常为 undefined——工具选择本身就是它的
   * "思考"。诚实 UI 原则：有就展示、没有就明说，绝不用模板话冒充模型推理。
   */
  text?: string;
}

/**
 * 给模型看的 schema-only 视图：只留 description 和 inputSchema，剥掉 execute。
 * 等价于教程手写循环里「工具不带 execute」的写法，但工具实现仍然集中放在 tools 表里。
 */
function toSchemaTools(tools: ToolSet): ToolSet {
  const schemaTools: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    schemaTools[name] = defineTool({
      description: t.description,
      inputSchema: t.inputSchema,
    });
  }
  return schemaTools;
}

/** 工具输出统一 JSON 序列化（LanguageModelV2ToolResultOutput 只收结构化形状） */
function jsonOutput(value: unknown) {
  return { type: "json", value: JSON.parse(JSON.stringify(value)) } as const;
}

/** 执行失败的输出走 error-json，模型能看出这是失败而不是业务数据 */
function errorOutput(value: unknown) {
  return { type: "error-json", value: JSON.parse(JSON.stringify(value)) } as const;
}

/**
 * 结构化事件发射的本地装配：循环不认识 Run 概念，关联键以空串占位
 * （消费方经 recorder.ingest 补挂真实 runId/traceId，见 telemetry/events.ts）。
 * attempt = 当前步号（循环内的「尝试」就是第几步，与 run-contract 的 1 起口径一致）。
 */
function emitLoopEvent(
  onEvent: ((event: AgentRunEvent) => void) | undefined,
  type: RunEventType,
  attempt: number,
  details: { stepId?: string; durationMs?: number; attributes?: Record<string, unknown> } = {},
): void {
  onEvent?.(
    createRunEvent(
      type,
      { runId: UNASSIGNED_CORRELATION, traceId: UNASSIGNED_CORRELATION },
      { attempt, ...details },
    ),
  );
}

/**
 * 手写多步工具循环。不借助任何 Agent 框架：想给每步打日志、加审批、缓存中间结果，
 * 直接在本函数的对应行插入即可——这正是手写版存在的意义。
 */
export async function runToolLoop(options: RunToolLoopOptions): Promise<ToolLoopResult> {
  const { model, tools, system, maxSteps = DEFAULT_MAX_STEPS, onStep, onEvent, signal } = options;
  const schemaTools = toSchemaTools(tools);
  const messages: ModelMessage[] = [...options.messages]; // 复制一份，不动调用方的数组

  for (let step = 1; step <= maxSteps; step++) {
    // 调度下一次模型调用之前先看信号：客户端已断开就不再发起（烧 token 没有意义）。
    // 抛错而不是返回半截结果——与「请求进行中被 abort」时 generateText 的拒绝
    // 语义保持一致，调用方用同一条 catch 路径处理两种中止时机。
    if (signal?.aborted) {
      throw new ToolLoopAbortedError(TOOL_LOOP_ABORTED);
    }
    trace(
      "▶",
      `思考 step ${step} → 调用模型（上下文 ${messages.length} 条消息，可用工具 ${Object.keys(tools).length} 个）`,
    );
    // 结构化事件（Phase 2）：模型请求边界，时长与 usage 只在 completed 上（缺数据政策）
    emitLoopEvent(onEvent, "llm.request.started", step, {
      attributes: { messageCount: messages.length, toolCount: Object.keys(tools).length },
    });
    const llmStartedAt = Date.now();
    let result;
    try {
      // llmCallPolicy：传输层重试（maxRetries 指数退避）+ 单步超时，与用户 signal 合并
      result = await generateText({
        model,
        messages,
        tools: schemaTools,
        system,
        ...llmCallPolicy(signal),
      });
    } catch (err) {
      // 中止（客户端断开/取消）不是模型失败——不发 llm.request.failed，失败率不掺水；
      // 终止原因由 Run 边界落成 run.cancelled / run.timed_out（见 run-with-verification）
      if (!signal?.aborted) {
        emitLoopEvent(onEvent, "llm.request.failed", step, {
          durationMs: Date.now() - llmStartedAt,
          attributes: { errorMessage: err instanceof Error ? err.message : String(err) },
        });
      }
      throw err;
    }
    emitLoopEvent(onEvent, "llm.request.completed", step, {
      durationMs: Date.now() - llmStartedAt,
      // usage 缺省（部分网关不回传）就不落键——绝不捏造 0 token（缺数据政策）
      attributes: result.usage
        ? {
            usage: {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              totalTokens: result.usage.totalTokens,
            },
          }
        : undefined,
    });

    if (result.toolCalls.length === 0) {
      trace("◆", `完成 → 模型给出最终回答（${result.text.length} 字，共 ${step} 步）`);
      return {
        text: result.text,
        messages,
        steps: step,
        usage: result.usage ? { totalTokens: result.usage.totalTokens ?? 0 } : undefined,
      }; // 模型开口了，出口
    }

    messages.push(...result.response.messages); // ① 入账：模型的调用意图
    // 步间文本快照：模型伴随工具调用"说"的那句话（有则随 onStep 广播，无则 undefined）
    const stepText = result.text.trim();
    trace(
      "⚙",
      `行动 step ${step} → 要调 ${result.toolCalls.length} 个工具：` +
        result.toolCalls.map((c) => `${c.toolName}(${preview(c.input, 120)})`).join("、"),
    );

    for (const call of result.toolCalls) {
      const tool = tools[call.toolName];
      let output;
      let failed = false;
      // 结构化事件（Phase 2）：工具执行边界。未知工具也是一次「调了但没跑成」的
      // 事实——started + failed 成对发射，工具失败率才有分母
      emitLoopEvent(onEvent, "tool.call.started", step, {
        stepId: call.toolCallId,
        attributes: { toolName: call.toolName },
      });
      const toolStartedAt = Date.now();
      if (tool?.execute) {
        // 入参校验防线（Phase 4 故障注入发现）：SDK 对没通过工具 schema 校验的
        // 调用并不打断 generateText，而是把该调用标成 invalid + error 原地混进
        // toolCalls。循环若无视这个标记，垃圾入参会静默流进 execute——违背
        // 「参数过 schema 才到 execute」的引擎契约（types.ts），模型也永远没机会
        // 知道参数不合法。按失败通道折成 error-json 回灌，模型能修正，循环不死。
        // 判据用 SDK 自带的标记（in-band 数据，不引依赖）；有效调用无此标记，零开销。
        if (Reflect.get(call, "invalid") === true) {
          const sdkError: unknown = Reflect.get(call, "error");
          const reason = sdkError instanceof Error ? sdkError.message : "工具入参未通过 schema 校验";
          failed = true;
          output = errorOutput({ error: `工具 ${call.toolName} 入参不合法：${reason}` });
        } else {
          try {
            // ② 调度：execute 就是普通函数；call.input 已由 SDK 按 schema 解析好
            output = jsonOutput(
              await tool.execute(call.input, {
                toolCallId: call.toolCallId,
                messages,
              }),
            );
          } catch (err) {
            failed = true;
            output = errorOutput({
              error: `工具 ${call.toolName} 执行失败：${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
      } else {
        failed = true;
        output = errorOutput({ error: `未知工具或工具无实现：${call.toolName}` });
      }

      messages.push({
        // ③ 回灌：结果作为 tool 消息
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output,
          },
        ],
      });

      trace(
        failed ? "✗" : "✓",
        `观察 step ${step} → ${call.toolName} ${failed ? "失败" : "返回"}：${preview(output.value)}`,
      );
      // 结构化事件（Phase 2）：与 started 成对的终局（时长实测，不捏造）
      emitLoopEvent(onEvent, failed ? "tool.call.failed" : "tool.call.completed", step, {
        stepId: call.toolCallId,
        durationMs: Date.now() - toolStartedAt,
        attributes: { toolName: call.toolName },
      });

      // 可选观察钩子：回灌落账后再广播，订阅方看到的一定是已提交的状态
      onStep?.({
        step,
        toolCall: { toolName: call.toolName, input: call.input },
        output: output.value,
        text: stepText || undefined, // 空串归一为 undefined：订阅方 "in text" 判断更省心
      });
    }
  }
  throw new Error(`步数用完（${maxSteps}），模型仍在要工具`);
}

/**
 * ToolLoopAgent 风格的类封装——教程里 SDK 版（stopWhen: isStepCount(5)）的对照物。
 * ai 5.0.266 尚未导出 ToolLoopAgent，这里用自己的 runToolLoop 实现同款接口，
 * 展示「循环就是全部逻辑」时如何收编成一个对象：消息历史由类内部维护，调用方只给 prompt 拿 text。
 */
export class ToolLoopAgent {
  constructor(private readonly options: { model: LanguageModel; tools: ToolSet; maxSteps?: number }) {}

  /** 一轮生成：prompt 可以是单条字符串，也可以是现成的消息数组；system 单独走选项 */
  async generate(input: { prompt: string | ModelMessage[]; system?: string }): Promise<ToolLoopResult> {
    const base: ModelMessage[] =
      typeof input.prompt === "string" ? [{ role: "user", content: input.prompt }] : [...input.prompt];
    return runToolLoop({ ...this.options, messages: base, system: input.system });
  }
}
