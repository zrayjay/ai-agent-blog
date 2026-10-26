// run-contract.ts —— Run 统一数据契约：一次 Agent 执行（Run）的标识、状态机与结局（Phase 1）。
//
// ── 为什么要有这层（审计 §2.3/§2.4 的缺口）────────────────────────────────
// 引擎此前只有 ToolLoopResult（文本 + 消息 + 步数），没有「Run」的概念：
// 事件无法关联到某次执行、重试没有 attempt 记录、终态可以被悄悄改写。
// 本文件补齐 Run 级的最小数据面：标识（谁在跑、第几次尝试、关联哪条 trace）、
// 状态机（queued/running + 四终态）、结局快照（RunOutcome）。
//
// ── 与 orchestrator 状态机的分层关系（刻意不合并非疏漏）────────────────────
// orchestrator/types.ts 的 TASK_TRANSITIONS 是「子任务编排状态机」（八态：
// pending/planning/executing/reviewing/done/failed/escalated/compensated），
// 管的是 DAG 里一个子任务从拆分到验收的生命周期；本文件的 RunStatus 是
// 「单次执行状态机」（六态），管的是引擎层一次 runToolLoop 级别的运行。
// 两套语义不同层级：一个 Run 可能承载编排器的一个子任务（taskId 关联），
// 也可能是无编排的裸调用。Run 终态机不认识 planning/reviewing，编排状态机
// 也不感知 cancelled/timed_out——各自守护各自的迁移，互不收编。
//
// 状态机不变量（assertRunStatusTransition 强制）：
//   1. 终态不可被改写——succeeded 之后再来 running 是编程错误；
//   2. 同终态幂等重放放行——终态落盘的 at-least-once 写入（重试恢复、
//      断点续跑重入）不该炸掉，from === to 的终态写入视为 no-op；
//   3. 其余迁移以 RUN_TRANSITIONS 表为唯一依据（表外 = 抛错）。

import { EngineError } from "./errors.js";

/**
 * Run 标识：把一次执行挂到调用方关心的所有维度上。
 * - attempt 从 1 起计数（第 1 次尝试 = 1，重试递增）——0 起计数会让
 *   「有没有重试过」变成 attempt === 0 的隐式约定，1 起计数让
 *   attempt > 1 直接可读为「这是重试」；
 * - taskId 存在时表示本 Run 服务于编排器的某个子任务（分层见头注释）；
 * - datasetId/caseId 存在时表示本 Run 来自某条评测用例（eval 回流用）。
 */
export interface RunIdentifiers {
  runId: string;
  /** 父 Run（编排器派生 / 子 Agent 调用时指向发起方） */
  parentRunId?: string;
  /** 关联的编排器子任务 id（无编排的裸调用时缺省） */
  taskId?: string;
  /** 哪个 Agent 在跑（角色名 / Agent 类型标识） */
  agentId: string;
  /** 步级标识（Run 内再细分事件流时使用） */
  stepId?: string;
  /** 尝试序号：从 1 起（首次执行 = 1） */
  attempt: number;
  /** 分布式追踪链路 id（与 Phase 2 的结构化事件模型对接） */
  traceId: string;
  /** 评测数据集 id（Run 由评测发起时填写） */
  datasetId?: string;
  /** 评测用例 id（同上，与 datasetId 成对出现） */
  caseId?: string;
}

/**
 * Run 状态：两个活动态 + 四个终态。
 * 语义注意：succeeded 只表示「流程正常走完」（循环有出口、没有抛错），
 * **不等于验收通过**——验收是 verification/ 模块的职责（执行成功 ≠ 验收通过，
 * 两者必须能分别表达，这正是 Phase 1 引入本契约的动机）。
 */
export type RunStatus =
  | "queued" // 已登记未开始
  | "running" // 执行中
  | "succeeded" // 终态：流程正常结束（≠ 验收通过，见上）
  | "failed" // 终态：执行失败（抛错 / 步数耗尽等）
  | "cancelled" // 终态：调用方主动取消
  | "timed_out"; // 终态：超时（预算看门狗裁决）

/** 终态集合（数据形式导出：消费方按内容遍历，不重复硬编码字面量） */
export const RUN_TERMINAL_STATUSES = ["succeeded", "failed", "cancelled", "timed_out"] as const;

/** 四个终态（RunOutcome.status 的合法取值） */
export type TerminalRunStatus = (typeof RUN_TERMINAL_STATUSES)[number];

/** 纯函数判定：是否终态（守卫「终态不可改写」不变量的第一道闸） */
export function isTerminalRunStatus(status: RunStatus): status is TerminalRunStatus {
  return (RUN_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * 合法迁移表（数据即文档）：queued/running 可前向推进或被取消/超时裁决；
 * 终态行只含自身——「同终态幂等重放」是表内唯一出边（不变量 2）。
 * queued → timed_out：排队阶段被预算看门狗收割；queued → cancelled：开跑前撤销。
 */
export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ["running", "cancelled", "timed_out"],
  running: ["succeeded", "failed", "cancelled", "timed_out"],
  succeeded: ["succeeded"],
  failed: ["failed"],
  cancelled: ["cancelled"],
  timed_out: ["timed_out"],
};

/** 非法 Run 状态迁移时抛出（错误礼仪同仓库：类型给程序、中文文案给人） */
export class RunStatusTransitionError extends EngineError {
  constructor(from: RunStatus, to: RunStatus) {
    super(
      `非法 Run 状态迁移：${from} → ${to}（终态不可被改写，同终态幂等重放除外）。` +
        "请对照 RUN_TRANSITIONS 检查状态写入顺序。",
    );
  }
}

/**
 * 状态迁移守护：不在表内的迁移直接抛错。
 * 典型错误：终态写入后被并发/重试路径用非终态覆盖（不变量 1）——
 * 例如 succeeded → running 是把「已完成的 Run」拉回执行中，数据诚信问题。
 */
export function assertRunStatusTransition(from: RunStatus, to: RunStatus): void {
  const allowed = RUN_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new RunStatusTransitionError(from, to);
  }
}

/**
 * Run 结局快照：一次执行走到终态后的完整记录。
 * - startedAt/finishedAt 为 ISO 8601 字符串（落盘可读、跨进程可比）；
 * - status 只收终态（TerminalRunStatus）——非终态没有「结局」可言；
 * - output/error 至多其一有意义：succeeded 时 output 是循环产出；
 *   其余终态时 error 记录裁决原因（code 供程序分支，message 供人读）；
 * - 再强调一次：succeeded = 流程正常结束，不代表验收通过（见 RunStatus 注释）。
 */
export interface RunOutcome {
  runId: string;
  status: TerminalRunStatus;
  /** 开始时间（ISO 8601） */
  startedAt: string;
  /** 结束时间（ISO 8601） */
  finishedAt: string;
  /** 成功时的产出（循环最终文本 / 结构化结果） */
  output?: unknown;
  /** 非成功终态的裁决记录：code 供程序分支，retryable 供上层重试策略 */
  error?: { code: string; message: string; retryable?: boolean };
}
