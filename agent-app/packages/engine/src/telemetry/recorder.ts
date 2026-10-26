// telemetry/recorder.ts —— Run 事件记录器：内存总账 + 脱敏分发（Phase 2）。
//
// ── 职责边界：内存总账是唯一事实源，sink 是尽力而为的出口 ─────────────────
// recorder.emit 先入内存列表，再向各 sink 推**脱敏后的拷贝**。顺序不能反：
//   1. sink 是进程外的 I/O（stderr / 落盘 / 远程采集），随时可能失败——
//      失败被兜住（warn 一声继续），**绝不让事件从总账里丢掉**；
//      观测管道挂了不能拖垮业务 Run，也不能吞掉观测事实（审计 §2.3 缺口 3：
//      「管道失败不吞」——失败有 warn 痕迹，事件在 all() 里永远查得到）。
//   2. 脱敏发生在 sink 边界（政策集中地，见 redact.ts 头注释），内存总账保留
//      原文——指标聚合要读真实 usage 数字，脱敏副本只给「离开进程」的那条路。
//
// ── 关联性按构造成立 ─────────────────────────────────────────────────────
// emit() 用构造时绑定的 runId/traceId 装配事件——记录器自身的发射天然同源；
// ingest() 接收外部发射点（agent-loop / gate 不认识 Run 概念）产生的事件，
// 空串占位的关联键在落账时补挂本记录器的 runId/traceId，并按 eventId 恰好一次
// 去重（同一事件被转发两次——比如调用方 onEvent 又手动 ingest——不会记重）。
// 于是 all() 里的每一条事件共享同一对 (runId, traceId)，无需调用方自律。

import { randomUUID } from "node:crypto";
import { getEngineLogger } from "../logger.js";
import { isTraceEnabled } from "../trace.js";
import type { AgentRunEvent, RunEventDetails, RunEventType } from "./events.js";
import { createRunEvent, UNASSIGNED_CORRELATION } from "./events.js";
import { redactEvent } from "./redact.js";

/**
 * 事件 sink：事件离开进程的出口（写 stderr / 落盘 / 推采集器）。
 * sink 收到的**永远是脱敏后的副本**（redactEvent 产物），不是总账原文。
 * sink 抛错由 recorder 兜住——观测出口的故障不传染业务。
 */
export type RunEventSink = (event: AgentRunEvent) => void;

/**
 * 内建 sink：stderr JSON 行（新结构化事件流，PRD §6.3.9）。
 * 复用 legacy 的 AGENT_TRACE 开关（isTraceEnabled）：没开轨迹时零输出——
 * 默认行为与引入本模块之前逐字节一致（AGENT_TRACE=1 / --trace 入口不变），
 * 开了轨迹之后 stderr 上 icon 行（trace.ts）与 JSON 事件行并存，互不干扰。
 * 每次写时读开关（trace() 同款）：进程内 enableTrace() 动态开启也能生效。
 */
export function createStderrJsonSink(): RunEventSink {
  return (event) => {
    if (!isTraceEnabled()) return;
    process.stderr.write(JSON.stringify(event) + "\n");
  };
}

/** createRunEventRecorder 的入参：Run 归属 + 可选 sink 清单 */
export interface RunEventRecorderOptions {
  /** Run 标识（本记录器发射的所有事件共享） */
  runId: string;
  /** 追踪链路 id（缺省生成 UUID；要与上游 trace 系统对齐时由调用方显式给） */
  traceId?: string;
  /** 父 Run（编排器派生时指向发起方；裸调用缺省） */
  parentRunId?: string;
  /** sink 清单（缺省 = 仅内建 stderr JSON 行 sink；测试传 [] 静音） */
  sinks?: readonly RunEventSink[];
}

/** 记录器句柄：emit 发射 / ingest 收编 / all 取总账（只读视图） */
export interface RunEventRecorder {
  /** 发射一条本 Run 的事件（身份/时间戳由记录器装配，调用方只给类型与细节） */
  emit(type: RunEventType, details?: RunEventDetails): void;
  /**
   * 收编一条外部发射点产生的事件：恰好一次去重（eventId）+ 空关联键补挂。
   * 收编进总账的事件与 emit 的事件同等地位（共享 runId/traceId、进 sink）。
   */
  ingest(event: AgentRunEvent): void;
  /** 内存总账（引用直出，调用方只读；metrics 聚合的原料） */
  all(): readonly AgentRunEvent[];
}

/**
 * 创建一次 Run 的事件记录器。
 * 入账顺序铁律：先内存总账，后 sink 分发（理由见头注释）——
 * sink 抛错在 try/catch 里降级为 warn（不空吞：有痕迹、有计数），总账分毫无损。
 */
export function createRunEventRecorder(options: RunEventRecorderOptions): RunEventRecorder {
  const { runId, parentRunId } = options;
  const traceId = options.traceId ?? randomUUID();
  const sinks = options.sinks ?? [createStderrJsonSink()];
  const ledger: AgentRunEvent[] = [];
  const seenEventIds = new Set<string>();
  const logger = getEngineLogger();

  /** 总账 + sink 分发的共同通道（ingest 补挂关联键后走这里） */
  const record = (event: AgentRunEvent): void => {
    seenEventIds.add(event.eventId);
    ledger.push(event);
    for (const sink of sinks) {
      try {
        sink(redactEvent(event)); // sink 只见脱敏副本；原文留在总账
      } catch (err) {
        // 有痕迹的降级：warn 说明哪个出口挂了（观测管道故障不能静默，更不能上抛）
        logger.warn(
          `[telemetry] 事件 sink 写出失败（事件保留在内存总账）：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  return {
    emit(type, details = {}) {
      record(createRunEvent(type, { runId, traceId, parentRunId }, details));
    },
    ingest(event) {
      if (seenEventIds.has(event.eventId)) return; // 恰好一次：重复转发是 no-op
      const correlated: AgentRunEvent =
        event.runId === UNASSIGNED_CORRELATION || event.traceId === UNASSIGNED_CORRELATION
          ? { ...event, runId, traceId } // 补挂：发射点无 Run 归属，本记录器是关联权威
          : event;
      record(correlated);
    },
    all() {
      return ledger;
    },
  };
}
