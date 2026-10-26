// evals/experiments.ts —— 实验台账与结果比较（Phase 5，PRD §11/§13 第一版口径）
//
// ── v1 范围决定（先说不做什么）────────────────────────────────────────────
// PRD §11/§13 第一版原文口径：**不建完整实验平台**，实现「可重复运行、配置留档
// 和结果比较」即可。因此：
// - 模型 / Prompt / 工具等实验变量在 v1 = 人工切换配置后各跑一轮——台账逐轮
//   留档 configId（每轮重算 buildConfigId()，记录「实际跑了什么配置」），
//   变量间比较用 compareReports（报告级）或 compareBaseline（套件级基线口径，
//   见 baseline.ts——基线组比较 = 本文件 compareReports + compareBaseline，
//   各管各的时段，此处不重复实现基线判定）；
// - overrides（门禁参数 / 模型参数）的自动应用与「自动优化候选版本」管线
//   属后续阶段，v1 刻意不做（没有人工闸的自动优化是事故流水线，§13.3 同源）。
//
// ── 为什么重复运行（repeat）与统计区间 ───────────────────────────────────
// 随机性任务（真实模型评审、检索召回）不凭单次运行下结论：单轮 passRate 的
// 抖动可能是噪声而不是回归。n≥2 次重复后给出均值 + 标准差 + 95% 置信区间
// （正态近似：mean ± 1.96·s/√n，s 为样本标准差 n-1 口径）；n<2 无区间——
// 单点没有离散度可言，硬造区间是伪精度（文档口径：随机性任务不凭单次运行
// 下结论；n<2 无区间）。
//
// ── maxRuns 预算闸（§11.3：超限明确停止）─────────────────────────────────
// repeat 超过预算上限时不静默截断也不报错炸掉，而是「正好跑 maxRuns 轮 +
// stopReason=budget-exhausted:maxRuns」——台账里的 stopReason 让读者一眼知道
// 这份实验是「计划内跑完」还是「被预算掐断的」（被掐断的结论按截断样本解读）。
//
// ── 台账为什么是 JSONL 且写失败不炸评测 ──────────────────────────────────
// append-only JSONL 与 guardrails/audit.ts 同款形态：逐行 JSON、只追加不改写，
// 单行损坏不连坐其余行（容错解析：坏行跳过 + warn，绝不 crash）。落盘路径
// 跟 cwd（.data/ 已 gitignore，§14 留档约定）；台账写失败只 contain + warn，
// 内存里的 ExperimentRecord 照常返回——留档是增强，不是评测的本体。
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildConfigId } from "../config.js";
import { EVAL_DATASET_VERSION } from "./dataset.js";
import { runEvals } from "./runner.js";
import type { EvalRunOptions } from "./runner.js";
import type { EvalReport, EvalResult, EvalSuiteName, EvalTotals } from "./types.js";
import { EVAL_EVALUATOR_VERSION } from "./types.js";

/** 预算上限（显式常量而非魔法数）：repeat 超过它 → 正好跑 maxRuns 轮并标 budget-exhausted */
export const EXPERIMENT_MAX_RUNS_BUDGET = 5;

/** 默认台账路径：agent-app/.data/experiments.jsonl（与 eval-report.json 同款 cwd 解析，.data 不进 git） */
export const DEFAULT_EXPERIMENT_LEDGER_PATH = join(process.cwd(), ".data", "experiments.jsonl");

/** 实验内单轮运行摘要：记录「这一轮实际跑了什么配置、结果数字、何时开始」 */
export interface ExperimentRun {
  /** 轮次序号（1 起） */
  runIndex: number;
  /** 本轮实际生效的配置指纹（逐轮重算 buildConfigId()——留档「实际跑了什么」） */
  configId: string;
  totals: EvalTotals;
  /** 本轮全部已执行用例的平均分（与报告套件 avg 同口径；0 例为 0，仅防除零） */
  avgScore: number;
  durationMs: number;
  startedAt: string;
}

/** 跨轮统计（口径见头注释「为什么重复运行」段落） */
export interface ExperimentStats {
  /** 各轮 passRate（passed/total）的算术平均 */
  passRateMean: number;
  /** 样本标准差（n-1 口径）；n<2 时缺省——单点无离散度 */
  passRateStddev?: number;
  /** 95% 置信区间（正态近似 mean ± 1.96·s/√n）；n<2 时缺省（n<2 无区间） */
  passRateCi95?: [number, number];
  /** 失败归因：caseId → 跨轮失败次数（失败含 errored，与报告 failed 口径一致） */
  failureClassification: Record<string, number>;
  /** 单用例耗时的 P50 / P95（毫秒，nearest-rank，跨轮的全部用例耗时一起排序） */
  latencyP50Ms: number;
  latencyP95Ms: number;
  /** token 总量：当前 EvalReport 未携带 token 计数，字段留待报告扩展后接入（v1 恒缺省） */
  totalTokens?: number;
}

/** 一份实验的完整留档记录（台账一行 = 一个 ExperimentRecord） */
export interface ExperimentRecord {
  experimentId: string;
  /** 人读标签（可选）：如 "judge-prompt-v2"，台账扫读用 */
  label?: string;
  startedAt: string;
  finishedAt: string;
  /** completed = 计划内跑完；budget-exhausted:maxRuns = 被 maxRuns 预算掐断（§11.3 明确停止） */
  stopReason: "completed" | "budget-exhausted:maxRuns";
  /** 末轮配置指纹（逐轮指纹在 runs[].configId） */
  configId: string;
  datasetVersion: string;
  evaluatorVersion: string;
  runs: ExperimentRun[];
  stats: ExperimentStats;
}

/** runExperimentRepeats 的选项（全部可选；filePath 可注入供单测写临时目录） */
export interface ExperimentOptions {
  /** 计划重复轮数（默认 1）；超过 maxRuns 时被预算闸截到 maxRuns */
  repeat?: number;
  /** 轮数预算上限（默认 EXPERIMENT_MAX_RUNS_BUDGET = 5） */
  maxRuns?: number;
  /** 人读标签，原样进台账 */
  label?: string;
  /** 实验 id（缺省 randomUUID）；重跑续写同一实验时显式传入 */
  experimentId?: string;
  /** 透传给每轮 runEvals 的运行选项（离线测试传 { embeddingAvailable:false, judgeAvailable:false }） */
  runOptions?: EvalRunOptions;
  /** 台账落盘路径（缺省 .data/experiments.jsonl；单测注入临时路径） */
  ledgerPath?: string;
}

/**
 * 实验台账：append-only JSONL 的读写门面（.data/experiments.jsonl）。
 * - appendExperiment：追加一行；目录不存在自动建；
 * - listExperiments：容错解析——坏行（非 JSON / 缺 experimentId）跳过 + warn，绝不 crash；
 * - loadExperiment：按 id 查单条，查不到返回 undefined（不存在 ≠ 错误）。
 */
export class ExperimentLedger {
  constructor(private readonly filePath: string = DEFAULT_EXPERIMENT_LEDGER_PATH) {}

  /**
   * 追加一条实验记录。写失败只 warn 不抛——台账是留档增强，写挂了不该
   * 把已经跑完的实验结论炸掉（调用方手里的内存记录照常可用）。
   */
  appendExperiment(record: ExperimentRecord): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
    } catch (err) {
      console.warn(
        `[实验台账] 留档写入失败（${err instanceof Error ? err.message : String(err)}）：` +
          "实验结果仍在内存中返回，仅 .data 台账缺这一条记录。",
      );
    }
  }

  /** 容错读全部记录：坏行跳过 + warn（append-only 文件里单行损坏不连坐其余行） */
  listExperiments(): ExperimentRecord[] {
    if (!existsSync(this.filePath)) return [];
    const records: ExperimentRecord[] = [];
    const lines = readFileSync(this.filePath, "utf8").split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (line.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        console.warn(`[实验台账] 第 ${index + 1} 行不是合法 JSON，已跳过（其余行照常读取）。`);
        continue;
      }
      if (typeof parsed !== "object" || parsed === null) {
        console.warn(`[实验台账] 第 ${index + 1} 行不是对象，已跳过。`);
        continue;
      }
      const experimentId: unknown = Reflect.get(parsed, "experimentId");
      if (typeof experimentId !== "string") {
        console.warn(`[实验台账] 第 ${index + 1} 行缺 experimentId 字段，已跳过。`);
        continue;
      }
      records.push(parsed as ExperimentRecord);
    }
    return records;
  }

  /** 按 id 查单条实验；查不到返回 undefined */
  loadExperiment(experimentId: string): ExperimentRecord | undefined {
    return this.listExperiments().find((record) => record.experimentId === experimentId);
  }
}

/** nearest-rank 百分位：升序排序后取第 ⌈P/100×N⌉ 名（1 起）；空数组为 0（无样本） */
function nearestRankPercentile(sortedDurations: number[], percentile: number): number {
  if (sortedDurations.length === 0) return 0;
  const rank = Math.ceil((percentile / 100) * sortedDurations.length);
  return sortedDurations[rank - 1];
}

/** 样本标准差（n-1 口径）；n<2 返回 undefined——单点无离散度 */
function sampleStddev(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const squaredDiffSum = values.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  return Math.sqrt(squaredDiffSum / (values.length - 1));
}

/**
 * 把「每轮的已执行用例结果」聚合为跨轮统计（runExperimentRepeats 的纯计算段，
 * 独立成函数便于对合成失败用例做离线断言）。
 * - passRateMean / stddev / Ci95：口径见头注释（n<2 无区间无标准差）；
 * - failureClassification：caseId → 失败轮数（failed 含 errored，与报告口径一致）；
 * - latencyP50/P95：跨轮全部用例耗时 nearest-rank；
 * - totalTokens：当前报告不带 token 计数，恒缺省（v1 口径，见 ExperimentStats 注释）。
 */
export function computeExperimentStats(perRunResults: EvalResult[][]): ExperimentStats {
  const perRunPassRates = perRunResults.map((results) => {
    if (results.length === 0) return 0; // 防除零：0 例的轮按 0 计（实践中 Tier 1 恒有 18 例）
    return results.filter((r) => r.passed).length / results.length;
  });

  const passRateMean = perRunPassRates.reduce((sum, rate) => sum + rate, 0) / perRunPassRates.length;
  const stats: ExperimentStats = {
    passRateMean,
    failureClassification: {},
    latencyP50Ms: 0,
    latencyP95Ms: 0,
  };

  const stddev = sampleStddev(perRunPassRates);
  if (stddev !== undefined) {
    stats.passRateStddev = stddev;
    // 正态近似 95% CI：mean ± 1.96·s/√n；区间夹逼到 [0,1]（passRate 的值域）
    const halfWidth = 1.96 * (stddev / Math.sqrt(perRunPassRates.length));
    stats.passRateCi95 = [Math.max(0, passRateMean - halfWidth), Math.min(1, passRateMean + halfWidth)];
  }

  for (const results of perRunResults) {
    for (const result of results) {
      if (result.passed) continue;
      stats.failureClassification[result.caseId] = (stats.failureClassification[result.caseId] ?? 0) + 1;
    }
  }

  const sortedDurations = perRunResults
    .flat()
    .map((r) => r.durationMs)
    .sort((a, b) => a - b);
  stats.latencyP50Ms = nearestRankPercentile(sortedDurations, 50);
  stats.latencyP95Ms = nearestRankPercentile(sortedDurations, 95);

  return stats;
}

/**
 * 驱动 runEvals 重复 repeat 轮并聚合成 ExperimentRecord：
 * - 每轮重算 buildConfigId()——台账留档「实际生效的配置」，而不是调用方声明的配置；
 * - repeat > maxRuns → 正好跑 maxRuns 轮 + stopReason="budget-exhausted:maxRuns"（§11.3）；
 * - 记录追加进台账（写失败 contain + warn，不炸本轮实验）；
 * - 返回内存中的完整记录（台账写挂时它仍在）。
 */
export async function runExperimentRepeats(options: ExperimentOptions = {}): Promise<ExperimentRecord> {
  const repeat = options.repeat ?? 1;
  const maxRuns = options.maxRuns ?? EXPERIMENT_MAX_RUNS_BUDGET;
  const plannedRuns = Math.min(repeat, maxRuns);
  const stopReason: ExperimentRecord["stopReason"] =
    repeat > maxRuns ? "budget-exhausted:maxRuns" : "completed";

  const startedAt = new Date().toISOString();
  const runs: ExperimentRun[] = [];
  const perRunResults: EvalResult[][] = [];
  let lastReport: EvalReport | undefined;

  for (let runIndex = 1; runIndex <= plannedRuns; runIndex++) {
    const runStartedAt = new Date().toISOString();
    const t0 = Date.now();
    const report = await runEvals(options.runOptions);
    lastReport = report;
    perRunResults.push(report.results);
    runs.push({
      runIndex,
      configId: buildConfigId(),
      totals: report.totals,
      avgScore:
        report.results.length === 0
          ? 0
          : report.results.reduce((sum, r) => sum + r.score, 0) / report.results.length,
      durationMs: Date.now() - t0,
      startedAt: runStartedAt,
    });
  }

  // 数据集版本 / 评测器版本从末轮报告取（报告「实际跑了什么」的真相）；
  // 零轮边界（repeat≤0）用 dataset.ts / types.ts 的常量兜底，口径与 runner 同源。
  const record: ExperimentRecord = {
    experimentId: options.experimentId ?? randomUUID(),
    startedAt,
    finishedAt: new Date().toISOString(),
    stopReason,
    configId: runs[runs.length - 1]?.configId ?? buildConfigId(),
    datasetVersion: lastReport?.datasetVersion ?? EVAL_DATASET_VERSION,
    evaluatorVersion: lastReport?.evaluatorVersion ?? EVAL_EVALUATOR_VERSION,
    runs,
    stats: computeExperimentStats(perRunResults),
  };
  if (options.label !== undefined) record.label = options.label;

  new ExperimentLedger(options.ledgerPath).appendExperiment(record);
  return record;
}

// ── 报告比较（compareReports）────────────────────────────────────────────

/** 套件级比较行：A=基准（如改动前基线轮），B=对照（如改动后实验轮），delta = B - A */
export interface ReportSuiteComparison {
  suite: EvalSuiteName;
  passedA: number;
  passedB: number;
  totalA: number;
  totalB: number;
  avgScoreA: number;
  avgScoreB: number;
  /** avgScoreB - avgScoreA：正 = 变好，负 = 变差 */
  delta: number;
}

/** 两份报告的比较结果：套件级行 + 用例级翻转（b vs a） */
export interface ReportComparison {
  suites: ReportSuiteComparison[];
  /** A 里通过、B 里失败的用例（真回归候选） */
  newlyFailing: string[];
  /** A 里失败、B 里通过的用例（真改进证据） */
  newlyPassing: string[];
}

/** 套件展示顺序（与 report.ts 的 SUITE_ORDER 同序：Tier 编号即顺序） */
const COMPARISON_SUITE_ORDER: EvalSuiteName[] = ["trajectory", "routing", "retrieval", "judge"];

/**
 * 比较两份评测报告（a=基准，b=对照）：
 * - 套件级行覆盖两边出现过的套件并集（按 Tier 顺序），delta = B 的 avgScore - A 的；
 * - 用例级翻转只比对**两边都有**的 caseId：单侧出现/缺席（数据集变更）不参与
 *   pass/fail 翻转判定——那是 compareBaseline 的 stale 提示管的口径（数据集版本
 *   变了结论不可比），此处不重复。随机性任务的 A/B 请先看 runExperimentRepeats
 *   的多轮统计，单轮对比只当初步信号。
 */
export function compareReports(a: EvalReport, b: EvalReport): ReportComparison {
  const suiteRows: ReportSuiteComparison[] = [];
  for (const suite of COMPARISON_SUITE_ORDER) {
    const rowsA = a.results.filter((r) => r.suite === suite);
    const rowsB = b.results.filter((r) => r.suite === suite);
    if (rowsA.length === 0 && rowsB.length === 0) continue; // 两边都没跑的套件不进比较
    const avgA = rowsA.length === 0 ? 0 : rowsA.reduce((sum, r) => sum + r.score, 0) / rowsA.length;
    const avgB = rowsB.length === 0 ? 0 : rowsB.reduce((sum, r) => sum + r.score, 0) / rowsB.length;
    suiteRows.push({
      suite,
      passedA: rowsA.filter((r) => r.passed).length,
      passedB: rowsB.filter((r) => r.passed).length,
      totalA: rowsA.length,
      totalB: rowsB.length,
      avgScoreA: avgA,
      avgScoreB: avgB,
      delta: avgB - avgA,
    });
  }

  const resultsA = new Map(a.results.map((r) => [r.caseId, r]));
  const resultsB = new Map(b.results.map((r) => [r.caseId, r]));
  const newlyFailing: string[] = [];
  const newlyPassing: string[] = [];
  for (const [caseId, resultA] of resultsA) {
    const resultB = resultsB.get(caseId);
    if (resultB === undefined) continue; // 单侧缺席不判翻转（口径见函数头注释）
    if (resultA.passed && !resultB.passed) newlyFailing.push(caseId);
    if (!resultA.passed && resultB.passed) newlyPassing.push(caseId);
  }

  return { suites: suiteRows, newlyFailing, newlyPassing };
}
