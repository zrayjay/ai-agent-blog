// baseline.ts —— 回归基线（教程 week16 Day 6）：把报告压成套件级数字快照，
// 存 .data/eval-baseline.json，下一轮跑完跟它比对——「感觉变好了」不算数，
// 数字比上一版跌了才算坏。
//
// ── 为什么按套件聚合而不是存整份报告 ──────────────────────────────────────
// 比对的判据只有三个数字：avg score、passed/total、（提示用的）datasetVersion。
// 存整份逐用例报告会让基线对单例噪声过敏（一条用例网络抖动慢了 300ms 也
// 会出现在 diff 里）；压成套件级均值后，基线对单例波动免疫、对人眼可读，
// 且文件小到可以直接 code review。逐用例的真相在 eval-report.json 里，
// 两份文件各管各的时段。
//
// ── 容差为什么是 3% ──────────────────────────────────────────────────────
// Tier 2/3 依赖真实模型，本来就有轻微软毛（embedding 微调、模型网关换版），
// 容差 0 起等于任何抖动都报警，报警疲劳之后没人看门禁。3% 以内视为噪声，
// 超过 3% 才认定真回归——数值与教程 Day 6 的建议口径一致（可按团队风险
// 偏好调整，改 BASELINE_TOLERANCE 一处即可）。
//
// ── 只比对「两边都有」的套件 ─────────────────────────────────────────────
// 基线里有、本轮没跑的套件（如无 key 机器上 retrieval/judge 被跳过）不比对：
// 环境缺失不是代码回归，按缺席放行；本轮新增的套件同理（没有历史可比）。
// CI 里没有 key、也没有基线文件——Tier 2/3 天然缺席，门禁只落在 Tier 1，
// 这正是 CI 侧的预期形态（README「CI 门禁只覆盖 Tier 1」）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getCaseGovernance } from "./governance.js";
import type { EvalReport } from "./types.js";

/** 回归判定的默认容差：套件 avg score 相对基线跌幅超过该值才算回归（3%） */
export const BASELINE_TOLERANCE = 0.03;

/** 容差的环境变量开关名：临时调松/调紧门禁用，不改代码 */
const TOLERANCE_ENV_KEY = "AGENT_EVAL_BASELINE_TOLERANCE";

/**
 * 读当前生效容差：环境变量 AGENT_EVAL_BASELINE_TOLERANCE 优先（可配，
 * Phase 3 §8.1），未设/非法（非正数、非数字）回退默认 0.03 并打告警——
 * 配置错误静默生效会让人误以为门禁按自己想的口径在拦。测试经 env 设置/恢复验证。
 */
export function getBaselineTolerance(): number {
  const raw = process.env[TOLERANCE_ENV_KEY];
  if (raw === undefined || raw.trim() === "") return BASELINE_TOLERANCE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[基线] 环境变量 ${TOLERANCE_ENV_KEY}="${raw}" 不是正数，回退默认容差 ${BASELINE_TOLERANCE}。`,
    );
    return BASELINE_TOLERANCE;
  }
  return parsed;
}

/** 单套件基线数字：与 report.ts 汇总表同一口径（passed/total/avgScore） */
export interface BaselineSuiteStats {
  passed: number;
  total: number;
  avgScore: number;
}

/** 一份回归基线：datasetVersion / configId 记录它压自哪一版数据集与哪套模型配置 */
export interface EvalBaseline {
  datasetVersion: string;
  /** 基线生成时间（ISO 8601，给人看） */
  savedAt: string;
  /** 配置指纹（可选，Phase 3 §8.2）：压基线时的 model|embedding|retries|timeout；
   *  旧版基线文件没有此字段——缺失时不参与指纹比对（向后兼容） */
  configId?: string;
  suites: Record<string, BaselineSuiteStats>;
}

/** 一条违规（或提示）：stale=true 表示「基线已过期」提示而非回归，不拦退出码 */
export interface BaselineViolation {
  suite: string;
  message: string;
  /** true = 仅提示（数据集版本不一致），不参与门禁判定 */
  stale?: boolean;
}

/** 默认落盘位置：agent-app/.data/eval-baseline.json（与 eval-report.json 同款解析，.data 不进 git） */
const DEFAULT_BASELINE_PATH = join(process.cwd(), ".data", "eval-baseline.json");

/** 把报告按套件聚合（skipped 的用例不计入任何套件——它本来就不在 results 里） */
function aggregateBySuite(report: EvalReport): Record<string, BaselineSuiteStats> {
  const buckets = new Map<string, { scores: number[]; passed: number }>();
  for (const result of report.results) {
    const bucket = buckets.get(result.suite) ?? { scores: [], passed: 0 };
    bucket.scores.push(result.score);
    if (result.passed) bucket.passed += 1;
    buckets.set(result.suite, bucket);
  }
  const suites: Record<string, BaselineSuiteStats> = {};
  for (const [suite, bucket] of buckets) {
    suites[suite] = {
      passed: bucket.passed,
      total: bucket.scores.length,
      avgScore: bucket.scores.reduce((sum, score) => sum + score, 0) / bucket.scores.length,
    };
  }
  return suites;
}

/** 从一轮报告构建基线（CLI 的 --update-baseline 调它，savedAt 取当下；配置指纹随报告一并压入） */
export function buildBaseline(report: EvalReport): EvalBaseline {
  const baseline: EvalBaseline = {
    datasetVersion: report.datasetVersion,
    savedAt: new Date().toISOString(),
    suites: aggregateBySuite(report),
  };
  if (report.configId !== undefined) baseline.configId = report.configId;
  return baseline;
}

/**
 * 基线落盘 JSON（pretty，可直接 code review）。目录不存在自动建。
 * @returns 实际写入的绝对路径（CLI 回显给用户）
 */
export function saveBaseline(baseline: EvalBaseline, filePath: string = DEFAULT_BASELINE_PATH): string {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(baseline, null, 2), "utf8");
  return filePath;
}

/**
 * 读取基线；文件不存在返回 null（首次运行还没有基线）。
 * 文件存在但损坏/形状不对：抛带修复指引的中文错误——静默把坏文件当
 * 「没有基线」会悄悄关掉整道门禁，宁可当场报错让用户删掉重建。
 */
export function loadBaseline(filePath: string = DEFAULT_BASELINE_PATH): EvalBaseline | null {
  if (!existsSync(filePath)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(
      `基线文件不是合法 JSON（${filePath}）：请删除该文件后执行 pnpm eval --update-baseline 重新生成。`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(
      `基线文件内容形状不对（${filePath}）：请删除该文件后执行 pnpm eval --update-baseline 重新生成。`,
    );
  }

  // 逐字段校验后重建类型化的基线对象（不做类型断言，坏字段当场报错）
  const datasetVersion: unknown = Reflect.get(parsed, "datasetVersion");
  const savedAt: unknown = Reflect.get(parsed, "savedAt");
  const suites: unknown = Reflect.get(parsed, "suites");
  const configId: unknown = Reflect.get(parsed, "configId");
  if (
    typeof datasetVersion !== "string" ||
    typeof savedAt !== "string" ||
    typeof suites !== "object" ||
    suites === null
  ) {
    throw new Error(
      `基线文件内容形状不对（${filePath}）：请删除该文件后执行 pnpm eval --update-baseline 重新生成。`,
    );
  }
  // configId 可选（旧版基线没有）：出现时必须是字符串，坏形状当场报错而非静默忽略
  if (configId !== undefined && typeof configId !== "string") {
    throw new Error(
      `基线文件中 configId 字段形状不对（${filePath}）：请删除该文件后执行 pnpm eval --update-baseline 重新生成。`,
    );
  }

  const suiteStats: Record<string, BaselineSuiteStats> = {};
  for (const [suite, value] of Object.entries(suites)) {
    if (typeof value !== "object" || value === null) {
      throw new Error(
        `基线文件中套件 ${suite} 的数字缺失（${filePath}）：请删除该文件后执行 pnpm eval --update-baseline 重新生成。`,
      );
    }
    const passed: unknown = Reflect.get(value, "passed");
    const total: unknown = Reflect.get(value, "total");
    const avgScore: unknown = Reflect.get(value, "avgScore");
    if (typeof passed !== "number" || typeof total !== "number" || typeof avgScore !== "number") {
      throw new Error(
        `基线文件中套件 ${suite} 的数字缺失（${filePath}）：请删除该文件后执行 pnpm eval --update-baseline 重新生成。`,
      );
    }
    suiteStats[suite] = { passed, total, avgScore };
  }

  const rebuilt: EvalBaseline = { datasetVersion, savedAt, suites: suiteStats };
  if (configId !== undefined) rebuilt.configId = configId;
  return rebuilt;
}

/**
 * 比对当前报告与基线，返回违规列表（空数组 = 无回归）。
 * 判据（只对两边都出现的套件）：
 * 1. avg score 跌幅 > 当前生效容差（getBaselineTolerance，默认 3%）→ 回归；
 * 2. passed/total 通过率下降 → 回归（少过一条用例就是实打实的回退，
 *    不设容差——avg score 容差保护的是「分数轻微抖动」，不是「用例掉了」）。
 * 提示（stale=true，不拦退出码）：
 * - 数据集版本不一致：口径已对不上当前用例集；
 * - 配置指纹不一致（两边都有 configId 才比对）：换了模型/嵌入/重试/超时，
 *   分数不再同源可比——建议重新压基线。
 */
export function compareBaseline(report: EvalReport, baseline: EvalBaseline): BaselineViolation[] {
  const violations: BaselineViolation[] = [];
  const current = aggregateBySuite(report);
  const tolerance = getBaselineTolerance();
  const tolerancePercent = Math.round(tolerance * 100);

  for (const [suite, base] of Object.entries(baseline.suites)) {
    const now = current[suite];
    if (now === undefined) continue; // 基线有、本轮缺席（如无 key 被跳过）：环境缺失 ≠ 回归

    if (base.avgScore - now.avgScore > tolerance) {
      violations.push({
        suite,
        message: `avg score 回归：基线 ${base.avgScore.toFixed(3)} → 当前 ${now.avgScore.toFixed(3)}，跌幅超过 ${tolerancePercent}%。请检查最近对引擎/提示词/数据集的改动，确认后可执行 pnpm eval --update-baseline 重置基线。`,
      });
    }

    const baseRatio = base.total > 0 ? base.passed / base.total : 0;
    const nowRatio = now.total > 0 ? now.passed / now.total : 0;
    if (nowRatio < baseRatio) {
      violations.push({
        suite,
        message: `通过率回归：基线 ${base.passed}/${base.total}（${baseRatio.toFixed(3)}）→ 当前 ${now.passed}/${now.total}（${nowRatio.toFixed(3)}）。有用例从过变不过，请对照失败详情定位。`,
      });
    }
  }

  if (baseline.datasetVersion !== report.datasetVersion) {
    violations.push({
      suite: "dataset",
      stale: true,
      message: `基线数据集版本为 v${baseline.datasetVersion}，当前数据集已是 v${report.datasetVersion}，基线已过期：比对结论仅供参考，建议执行 pnpm eval --update-baseline 重新生成。`,
    });
  }

  // 配置指纹比对（Phase 3 §8.2）：两边都有才比——旧基线/缺指纹的报告不误报
  if (
    baseline.configId !== undefined &&
    report.configId !== undefined &&
    baseline.configId !== report.configId
  ) {
    violations.push({
      suite: "config",
      stale: true,
      message:
        `基线配置指纹为 ${baseline.configId}，当前为 ${report.configId}，基线已过期：` +
        "模型/嵌入/重试/超时变了，分数不再同源可比，建议执行 pnpm eval --update-baseline 重新生成。",
    });
  }

  return violations;
}

/**
 * 关键用例阻断（Phase 3 §8.2）：治理层 riskLevel=critical 的用例失败（passed=false，
 * 不论是否 errored）→ 逐条产出阻断性违规。与基线容差门禁互补——容差吸收「分数软毛」，
 * 关键用例是「一票否决」：转人工/投诉/高危路由、闲聊负例这类安全底线失败了，
 * 就算整体通过率没变也不许过门禁。
 */
export function criticalCaseViolations(report: EvalReport): BaselineViolation[] {
  const violations: BaselineViolation[] = [];
  for (const result of report.results) {
    if (result.passed) continue;
    const governance = getCaseGovernance(result.caseId);
    if (governance.riskLevel !== "critical") continue;
    violations.push({
      suite: result.suite,
      message:
        `关键用例失败：${result.caseId}（风险等级 critical，维度 ${governance.dimensions.join("/")}）。` +
        "安全底线用例不允许被容差吸收，请立即定位修复；确认属预期变更后需同步调整 governance 登记并重新评审。",
    });
  }
  return violations;
}
