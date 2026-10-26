// telemetry/metrics.ts —— Run 观测指标：纯事件流 → 看板聚合（Phase 2，PRD §6.4）。
//
// ── 纯聚合纪律 ───────────────────────────────────────────────────────────
// computeRunMetrics 是纯函数：输入 readonly 事件数组，输出摘要对象，无 IO、
// 无时钟、无随机。所有比率都遵守缺数据政策：**分母为 0 → undefined，不是 0**。
// 「0% 成功率」和「一个 Run 都没有」是两个世界的事实，混用会把空看板误报成
// 全线故障（反之亦然）。undefined 在采集侧表现为键缺失（JSON.stringify 剔除），
// 看板可据「键存在与否」区分「没数据」与「数据为零」。
//
// ── 分母规则（显式成文，不藏在实现里）────────────────────────────────────
// 每个比率都用什么分母、排除谁、为什么——逐条写在对应字段注释里。总原则：
//   1. 质量类比率（成功率/失败率/超时率）分母里不含 cancelled——取消是调用方的
//      运营决策（客户端关页面 / 上游预算收缩），不是系统质量信号；把它算进
//      成功率分母会让运营动作直接污染质量看板（一次批量取消 = 成功率跳水）。
//   2. cancelRate 刻意用相反口径——它**就是**要度量取消本身，取消必须进分母，
//      否则「全员取消」的场景算出 0%，荒谬。
//   3. in-flight（只有 run.started 没有终态事件的 Run）不进任何分母——没到
//      终局的 Run 既不算成功也不算失败，进分母就是给尚未发生的事记账。

import type { AgentRunEvent, RunEventType } from "./events.js";

/** Run 观测指标摘要（PRD §6.4 的最小字段集；undefined = 无数据，绝不捏造 0） */
export interface RunMetrics {
  /** 终态 Run 总数（只有 run.started 没有 run.* 终态事件的 in-flight 不计） */
  runsTotal: number;
  /**
   * 成功率 = succeeded / (succeeded + failed + timed_out)。
   * cancelled 与 in-flight 不进分母（理由见头注释分母规则 1/3）。
   * 分母 0 → undefined。
   */
  runSuccessRate?: number;
  /**
   * 验收通过率 = 最终 verification.completed status=passed 的 Run 数 /
   * 到达验收的 Run 数（有 verification.started 即「到达」；started 后没有
   * completed（进程中断）也算分母不计分子——诚实口径）。
   * 没有任何 Run 到达验收 → undefined。
   */
  acceptancePassRate?: number;
  /**
   * Run 时长分位数（毫秒）：run.* 终态事件（completed/failed/timed_out）带
   * durationMs 的样本。cancelled 不进样本（被掐死的时长不是完整执行的时长，
   * 混进来会把 P50 拉向「多快被取消」而不是「多快跑完」——口径见分母规则 1）。
   * 无样本 → 整个对象与 p50/p95 均为 undefined。nearest-rank 算法见 percentile。
   */
  latencyMs?: { p50?: number; p95?: number };
  /** 模型请求失败率 = llm.request.failed / (completed + failed)；0/0 → undefined */
  llmFailureRate?: number;
  /** 工具执行失败率 = tool.call.failed / (completed + failed)；0/0 → undefined */
  toolFailureRate?: number;
  /**
   * 重试率 = 出现过 retry.scheduled 的终态 Run 数 / runsTotal。
   * retry.* 事件缺席 → undefined（不是 0）：发射点尚未接线（见 events.ts
   * 延迟发射说明），「没观测到」≠「没重试」，数不出来就别冒充数出来了。
   */
  retryRate?: number;
  /** 超时率 = timed_out / (succeeded + failed + timed_out)；分母 0 → undefined */
  timeoutRate?: number;
  /**
   * 取消率 = cancelled / 全部终态（含 cancelled 自身）。与 runSuccessRate 的
   * 分母刻意不同（见头注释分母规则 2）：本指标度量的是取消现象本身。
   * runsTotal 0 → undefined。
   */
  cancelRate?: number;
  /**
   * 总 token 消耗：llm.request.completed 属性里 usage.totalTokens 的和。
   * 没有任何 usage 数据 → undefined（部分事件带 usage 时只累加带的部分，
   * 缺 usage 的事件贡献 0 但不改变「有数据」的事实）。
   */
  totalTokens?: number;
  /**
   * 估算成本（美元）：llm.request.completed 属性里的 costUsd 之和。
   * 只有调用方显式标注了成本才存在——引擎不拿 token 数自己乘单价猜成本
   * （单价随模型/渠道变动，猜出来的数比没有更危险）。无数据 → undefined。
   */
  estimatedCostUsd?: number;
}

const TERMINAL_RUN_EVENTS: readonly RunEventType[] = [
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.timed_out",
];

/** nearest-rank 分位数：升序取第 ceil(p/100·n) 个（1 起），小样本下稳定可复现 */
function percentile(sortedAscending: readonly number[], p: number): number | undefined {
  if (sortedAscending.length === 0) return undefined;
  const rank = Math.ceil((p / 100) * sortedAscending.length);
  return sortedAscending[Math.min(Math.max(rank - 1, 0), sortedAscending.length - 1)] as number;
}

/** 按类型过滤的便捷器 */
function ofType(events: readonly AgentRunEvent[], type: RunEventType): AgentRunEvent[] {
  return events.filter((e) => e.type === type);
}

/** 从属性里安全取数字（缺数据政策：类型不对 = 没这个数据，不当 0 处理） */
function numberAttribute(event: AgentRunEvent, path: readonly string[]): number | undefined {
  let cursor: unknown = event.attributes;
  for (const key of path) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "number" && Number.isFinite(cursor) ? cursor : undefined;
}

/**
 * 从事件流聚合 Run 看板指标。同一 Run 的多条终态事件（异常数据）取最后一条，
 * 不让脏数据把一个 Run 同时算进两个桶。
 */
export function computeRunMetrics(events: readonly AgentRunEvent[]): RunMetrics {
  // Run 终局归类：runId → 最后一条终态事件（同 Run 多终态按时间序取末条）
  const terminalByRun = new Map<string, AgentRunEvent>();
  for (const event of events) {
    if (TERMINAL_RUN_EVENTS.includes(event.type)) terminalByRun.set(event.runId, event);
  }
  const terminals = [...terminalByRun.values()];

  const succeeded = terminals.filter((e) => e.type === "run.completed").length;
  const failed = terminals.filter((e) => e.type === "run.failed").length;
  const timedOut = terminals.filter((e) => e.type === "run.timed_out").length;
  const cancelled = terminals.filter((e) => e.type === "run.cancelled").length;
  const runsTotal = terminals.length;

  // 质量分母：cancelled 排除（分母规则 1）；0 → undefined（不冒充 0%）
  const qualityDenominator = succeeded + failed + timedOut;

  // 验收：分母 = 到达验收的 Run（有 verification.started）
  const reachedVerification = new Set(ofType(events, "verification.started").map((e) => e.runId));
  // Run 最终验收结论：runId → 最后一条 verification.completed 的 status
  const finalVerificationStatus = new Map<string, string>();
  for (const event of ofType(events, "verification.completed")) {
    if (event.status !== undefined) finalVerificationStatus.set(event.runId, event.status);
  }
  let verificationPassed = 0;
  for (const runId of reachedVerification) {
    if (finalVerificationStatus.get(runId) === "passed") verificationPassed += 1;
  }

  // 时长样本：终态 Run 带 durationMs 的，cancelled 排除（口径见字段注释）
  const durations = terminals
    .filter((e) => e.type !== "run.cancelled" && typeof e.durationMs === "number")
    .map((e) => e.durationMs as number)
    .sort((a, b) => a - b);

  // 领域失败率：failed / (completed + failed)；0/0 → undefined
  const failureRate = (completedType: RunEventType, failedType: RunEventType): number | undefined => {
    const completed = ofType(events, completedType).length;
    const failures = ofType(events, failedType).length;
    const denominator = completed + failures;
    return denominator === 0 ? undefined : failures / denominator;
  };

  // 重试：出现过 retry.scheduled 的终态 Run 数（去重按 runId）
  const runsWithRetry = new Set(ofType(events, "retry.scheduled").map((e) => e.runId)).size;

  // token / 成本：只累加真实存在的数字，全缺 → undefined
  let totalTokens: number | undefined;
  let estimatedCostUsd: number | undefined;
  for (const event of ofType(events, "llm.request.completed")) {
    const tokens = numberAttribute(event, ["usage", "totalTokens"]);
    if (tokens !== undefined) totalTokens = (totalTokens ?? 0) + tokens;
    const cost = numberAttribute(event, ["costUsd"]);
    if (cost !== undefined) estimatedCostUsd = (estimatedCostUsd ?? 0) + cost;
  }

  return {
    runsTotal,
    runSuccessRate: qualityDenominator === 0 ? undefined : succeeded / qualityDenominator,
    acceptancePassRate:
      reachedVerification.size === 0 ? undefined : verificationPassed / reachedVerification.size,
    latencyMs:
      durations.length === 0 ? undefined : { p50: percentile(durations, 50), p95: percentile(durations, 95) },
    llmFailureRate: failureRate("llm.request.completed", "llm.request.failed"),
    toolFailureRate: failureRate("tool.call.completed", "tool.call.failed"),
    retryRate: runsTotal === 0 || runsWithRetry === 0 ? undefined : runsWithRetry / runsTotal,
    timeoutRate: qualityDenominator === 0 ? undefined : timedOut / qualityDenominator,
    cancelRate: runsTotal === 0 ? undefined : cancelled / runsTotal,
    totalTokens,
    estimatedCostUsd,
  };
}
