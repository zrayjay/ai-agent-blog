// telemetry/events.ts —— 统一事件模型 AgentRunEvent：结构化观测的最小数据面（Phase 2，PRD §6.2）。
//
// ── 为什么要有这一层（审计 §2.3 的缺口）──────────────────────────────────
// trace.ts 的 icon 行是「给人扫读的」，字段无法关联到某次 Run：没有 runId/traceId，
// 没有时长、attempt、结构化属性——排障靠肉眼扫 stderr，指标聚合无从谈起。
// 本文件定义唯一的事件形状：每条观测都是一条 AgentRunEvent，自带关联键
// （runId/traceId/parentRunId）、定位键（stepId/attempt）与自由属性（attributes）。
// trace 的 icon 行继续原样存在（text 模式逐字节兼容），结构化事件是**新增的流**，
// 两条管道各走各的出口（见 recorder.ts 的内建 sink）。
//
// ── 缺数据政策（全模块铁律）：缺省字段 = undefined = JSON 里键不存在 ──────
// 可选字段（durationMs/status/attempt/attributes/…）没有数据时**绝不捏造**：
// 不写 0、不写空串、不写 null。理由：
//   1. 0 是一个真实测量值（0 毫秒、0 token 都是可能发生的），拿 0 冒充
//      「没测到」会让聚合口径失真——metrics.ts 据此把 0/0 区分成 undefined；
//   2. 键缺失让下游（JSONL 采集 / 指标聚合）能用 `"durationMs" in event`
//      可靠区分「没测」与「测得 0」，null 做不到（typeof null === "object"）。
// 构造器 createRunEvent 只填必填键，可选键一律不落（JSON.stringify 自动剔除
// undefined 值的键——这是 JS 的原生行为，正好成为缺数据政策的执行机制）。
//
// ── 与 run-contract.ts 的关系（分层不合并非疏漏）─────────────────────────
// run-contract.ts 管 Run 的**状态机与结局**（六态 + 迁移守护 + RunOutcome 快照）；
// 本文件管 Run 过程中的**事件流**（一次 Run 会产生一串事件，终态事件只是其中
// 最后一条）。事件流的 type 目录里有 run.* 终态族，与 RunStatus 的终态四值
// 语义对齐（completed↔succeeded、failed、cancelled、timed_out），但事件模型
// 不引入状态机——事件是Append-only 的观测记录，不是可迁移的状态。

import { randomUUID } from "node:crypto";

/**
 * 事件类型全目录（数据形式导出：消费方按内容遍历，测试逐条校验唯一性）。
 * 命名约定：`域.对象.结果` 三段式——run / llm / tool / retry / verification /
 * subrun / guardrail 七个域，与引擎的模块边界一一对应，看前缀就知道事件从哪来。
 *
 * 发射点接线图（Phase 2 实况，详见各发射点注释）：
 *   run.started/completed/failed/cancelled/timed_out → verification/run-with-verification.ts（Run 边界持有者）
 *   llm.request.started/completed/failed             → agent-loop.ts（generateText 调用前后）
 *   tool.call.started/completed/failed               → agent-loop.ts（每次工具 execute 前后）
 *   verification.started/completed/failed            → run-with-verification.ts（VerificationRunner 前后）
 *   guardrail.triggered                              → guardrails/gate.ts（拒绝时，可选发射器）
 *   retry.scheduled/exhausted、subrun.*               → 见下方「延迟发射」注释块
 */
export const RUN_EVENT_TYPES = [
  // Run 生命周期（一次 Run 恰好一条 started + 至多一条终态事件）
  "run.started",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.timed_out",
  // 模型请求（generateText 包一层：时长 + usage token）
  "llm.request.started",
  "llm.request.completed",
  "llm.request.failed",
  // 工具执行（本地调度边界，execute 前后各一条）
  "tool.call.started",
  "tool.call.completed",
  "tool.call.failed",
  // 重试（传输层由 AI SDK 内部处理，引擎不可见——见延迟发射说明）
  "retry.scheduled",
  "retry.exhausted",
  // 验收（VerificationRunner 前后）
  "verification.started",
  "verification.completed",
  "verification.failed",
  // 子 Run（编排器派生的嵌套执行——编排器接线属后续阶段，见延迟发射说明）
  "subrun.started",
  "subrun.completed",
  // 护栏（闸门拒绝即安全事件，与 audit.log 并行的结构化通道）
  "guardrail.triggered",
] as const;

/** 事件类型联合类型：从目录常量派生（单一事实源，新增事件只改数组） */
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

/**
 * 空关联键占位（形状语义归本文件管）：不认识 Run 概念的发射点
 * （agent-loop 的循环内部 / guardrails 的闸门）无法自报 runId/traceId，
 * 以空串发射，由 recorder.ingest 落账时补挂真实关联键。消费方不该直接
 * 消费空串键的事件——先经记录器，关联性按构造成立。
 */
export const UNASSIGNED_CORRELATION = "";

/**
 * 统一事件模型：引擎观测流的唯一形状（PRD §6.2 的字段清单）。
 * - eventId / runId / traceId 为必填 string：事件没有关联键就没有意义；
 *   「尚无归属」的发射点（agent-loop / gate 不认识 Run 概念）用空串占位，
 *   由 recorder.ingest 落账时补挂真实的 runId/traceId（见 recorder.ts）；
 * - timestamp 为 ISO 8601 字符串（与 RunOutcome.startedAt 同口径，落盘可读）；
 * - 可选字段遵守缺数据政策：undefined = 不落键 = 没测到，绝不捏造零值。
 */
export interface AgentRunEvent {
  /** 事件唯一 id（randomUUID；recorder.ingest 据此做恰好一次去重） */
  eventId: string;
  /** 所属 Run（空串 = 发射点无 Run 归属，ingest 时补挂） */
  runId: string;
  /** 分布式追踪链路 id（与 runId 同源补挂；一次 Run 内所有事件共享） */
  traceId: string;
  /** 父 Run（编排器派生 / 子 Agent 调用时指向发起方；裸调用缺省） */
  parentRunId?: string;
  /** 步级标识（工具事件用 toolCallId，一次 Run 内定位到具体某次调用） */
  stepId?: string;
  /** 事件类型（目录见 RUN_EVENT_TYPES） */
  type: RunEventType;
  /** 事件时间（ISO 8601） */
  timestamp: string;
  /** 该段操作的实测时长（毫秒）；没测到就不落键（缺数据政策） */
  durationMs?: number;
  /**
   * 领域状态（按事件类型约定）：
   * verification.completed → VerificationStatus（passed/failed/inconclusive）；
   * 其余类型当前不用——不用就不落键，不发明"ok"这种废话值。
   */
  status?: string;
  /** 尝试序号：从 1 起（首次执行 = 1，与 run-contract 的 attempt 口径一致） */
  attempt?: number;
  /** 自由属性（事件类型的结构化载荷；字符串值经 redact.ts 脱敏后出 sink） */
  attributes?: Record<string, unknown>;
}

/** emit/ingest 的可选细节：调用方只给有的字段，构造器负责补齐身份与时间 */
export interface RunEventDetails {
  stepId?: string;
  durationMs?: number;
  status?: string;
  attempt?: number;
  attributes?: Record<string, unknown>;
}

/**
 * 事件构造器：填必填键（eventId = randomUUID、timestamp = ISO 8601），
 * 可选细节按缺数据政策只落有值的键（undefined 不落键）。
 * 纯装配：不做任何脱敏（脱敏是 sink 出口的事，见 redact.ts）。
 */
export function createRunEvent(
  type: RunEventType,
  correlation: { runId: string; traceId: string; parentRunId?: string },
  details: RunEventDetails = {},
): AgentRunEvent {
  const event: AgentRunEvent = {
    eventId: randomUUID(),
    runId: correlation.runId,
    traceId: correlation.traceId,
    type,
    timestamp: new Date().toISOString(),
  };
  if (correlation.parentRunId !== undefined) event.parentRunId = correlation.parentRunId;
  if (details.stepId !== undefined) event.stepId = details.stepId;
  if (details.durationMs !== undefined) event.durationMs = details.durationMs;
  if (details.status !== undefined) event.status = details.status;
  if (details.attempt !== undefined) event.attempt = details.attempt;
  if (details.attributes !== undefined) event.attributes = details.attributes;
  return event;
}

/**
 * 延迟发射（刻意不发假事件，占位说明集中在此）：
 *
 * - retry.scheduled / retry.exhausted：传输层重试（429/5xx 指数退避）发生在
 *   AI SDK 的 maxRetries 内部（见 llm.ts llmCallPolicy），引擎在 generateText
 *   返回/抛错之间看不到每一次尝试——SDK 没有暴露每次重试的回调。硬要在循环层
 *   「数失败次数推断重试」是伪造数据。等 SDK 提供传输层遥测钩子或我们自建
 *   fetch 包装时再真实发射；目录先占位，metrics 的 retryRate 对无数据返回
 *   undefined（不会把「看不到」误算成「没重试」）。
 * - subrun.started / subrun.completed：编排器（orchestrator/）派生子 Run 的
 *   接线属后续阶段——编排器今天不消费 recorder，先接是空转。parentRunId 字段
 *   已就位，接线时只需在派发点 emit 即可。
 */
export const RUN_EVENT_EMISSION_DEFERRALS: ReadonlyArray<{ types: readonly RunEventType[]; reason: string }> =
  [
    {
      types: ["retry.scheduled", "retry.exhausted"],
      reason: "SDK 传输层重试对引擎不可见（无逐次回调），引擎层数不到就不发；接遥测钩子后再发射",
    },
    {
      types: ["subrun.started", "subrun.completed"],
      reason: "编排器派生子 Run 的接线属后续阶段；parentRunId 字段已就位，接线即发射",
    },
  ];
