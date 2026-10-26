// evals/quality-gate.ts —— 质量门禁（Phase 4，PRD §9/§12）：把一轮评测报告 + 基线/关键用例
// 违规 +（可选的）验证/可靠性/安全摘要检查，裁决成一个可解释的三态结论。
//
// ── 门禁绝不控制 Agent 循环（§2.2.3 铁律）────────────────────────────────
// 本模块是纯函数：吃数据、出结论，不 import agent-loop、不碰任何执行面。
// 「门禁不过」的后果只有一条通道——CLI 的退出码（CI 拿它拦合并）；引擎循环
// 里不存在任何读取门禁结论的代码路径。规则与执行分离（§12.4.1）：策略是
// 显式数据（QualityGatePolicy），评估是唯一函数（evaluateQualityGate）——
// 改门槛=改数据，不需要动代码。
//
// ── 三态而非二态（与 verification / evals skipped 同一工程哲学）──────────
// 必跑套件被跳过（如无 key 机器上检索/评审缺席）是「跑不了」而不是「没通过」：
// 折算成 failed 会误伤环境，折算成 passed 会粉饰——inconclusive 单独成态，
// 「不确定」必须可见（§12.2：跳过的必跑套件绝不自动通过）。skipped 计数
// 在任何规则里都不算 passed：跳过的用例不进通过率分母，跳过的可选检查按
// not_applicable 报告并写明原因，绝不静默放行。
//
// ── 缺席的可选检查 ≠ 通过 ────────────────────────────────────────────────
// input.checks（验证/可靠性/安全摘要）是未来阶段的接线缝：当前评测管线还没有
// 把 runWithVerification 的 verification 结果与安全链路摘要喂进来。缺席时
// 产出 not_applicable 规则（带中文原因），而不是当作 passed——宁可留一枚
// 「未接入」的可见占位，不可让门禁在看不见的维度上假装全绿。
import type { BaselineViolation } from "./baseline.js";
import type { EvalReport, EvalSuiteName, EvalResult } from "./types.js";

/** 门禁总结论三态：passed（全绿）/ failed（有阻断失败）/ inconclusive（有无法判定的必查项） */
export type QualityGateStatus = "passed" | "failed" | "inconclusive";

/** 单条规则的判定状态：not_applicable = 该规则不适用（缺席输入），不参与成败 */
export type GateRuleStatus = "passed" | "failed" | "inconclusive" | "not_applicable";

/** 单条门禁规则的结论：每条都自带中文 reason，解释「为什么是这个状态」——门禁的价值
 *  在可解释性，一行 `failed` 没有人知道该修什么 */
export interface GateRuleResult {
  /** 稳定规则 id（R1..R6 前缀，grep/报表可定位） */
  id: string;
  status: GateRuleStatus;
  /** true = 该规则失败会阻断门禁（当前全部规则都是阻断性的；字段留给未来非阻断观察项） */
  blocking: boolean;
  /** 中文原因：说清判据数字与缺失了什么，而不是只给结论 */
  reason: string;
}

/** 门禁结论：总结论 + 逐规则明细 + 裁决时间（ISO 8601，留档可追溯） */
export interface QualityGateResult {
  status: QualityGateStatus;
  rules: GateRuleResult[];
  evaluatedAt: string;
}

/**
 * 可选检查项（未来阶段的接线缝）：验证（verification）/ 可靠性（故障注入）/
 * 安全（护栏链路）摘要检查。status 语义与 VerificationStatus 对齐并扩一档：
 * skipped = 该检查本轮没跑（如无 key 环境），绝不折算成 passed。
 */
export interface QualityGateCheck {
  id: string;
  status: "passed" | "failed" | "inconclusive" | "skipped";
  /** 一句话摘要（进规则 reason，报告可见） */
  summary: string;
}

/** 门禁输入：一轮评测的全部裁决原料 */
export interface QualityGateInput {
  report: EvalReport;
  /** 基线比对违规（compareBaseline 产物；stale=true 的是提示，不拦门禁） */
  baselineViolations: BaselineViolation[];
  /** 关键用例违规（criticalCaseViolations 产物，一票否决） */
  criticalViolations: BaselineViolation[];
  /** 可选检查摘要（verification/可靠性/安全；缺席 = 尚未接入，按 not_applicable 报告） */
  checks?: QualityGateCheck[];
}

/**
 * 门禁策略：显式数据而非代码分支（§12.4.1 规则与执行分离）。
 * requireNoCriticalViolations / requireNoBaselineRegression 钉死为 true（字面量类型）：
 * 这两条是安全底线，任何预设都不允许关掉——要放松门禁只能减 requiredSuites。
 */
export interface QualityGatePolicy {
  /** 必跑套件：缺席（跳过）→ inconclusive（绝不自动通过），有失败 → failed */
  requiredSuites: readonly EvalSuiteName[];
  /** 必跑套件通过率下限（0..1）；默认取 DEFAULT_MIN_PASS_RATE（全过，与 pnpm eval 退出码同口径） */
  minPassRate: number;
  requireNoCriticalViolations: true;
  requireNoBaselineRegression: true;
  /**
   * 是否容忍必跑套件缺席（缺省 false = fail-closed）：显式 true 时，跳过的必跑套件
   * 把 R2 判成 not_applicable（带原因）而不是 inconclusive——仅供「明知无 key 的
   * 本地快速检查」使用，两个预设都不开启它。
   */
  allowSkippedSuites?: boolean;
}

/** 默认通过率下限：1.0（必跑套件全部用例都得过——与 pnpm eval 的退出码判据同口径） */
export const DEFAULT_MIN_PASS_RATE = 1;

/** 发布门禁（全量）：四个套件都是必跑——本地有 key 的机器 / 发布前裁决用 */
export const QUALITY_GATE_POLICY_FULL: QualityGatePolicy = {
  requiredSuites: ["trajectory", "routing", "retrieval", "judge"],
  minPassRate: DEFAULT_MIN_PASS_RATE,
  requireNoCriticalViolations: true,
  requireNoBaselineRegression: true,
};

/** CI 门禁（Tier 1）：只要求零网络的轨迹/路由——CI 无 key，检索/评审缺席不影响裁决 */
export const QUALITY_GATE_POLICY_CI_TIER1: QualityGatePolicy = {
  requiredSuites: ["trajectory", "routing"],
  minPassRate: DEFAULT_MIN_PASS_RATE,
  requireNoCriticalViolations: true,
  requireNoBaselineRegression: true,
};

/** 取某套件在本轮报告里的已执行用例（skipped 的用例本来就不在 results 里） */
function resultsOfSuite(report: EvalReport, suite: EvalSuiteName): EvalResult[] {
  return report.results.filter((r) => r.suite === suite);
}

/** 必跑套件的缺席清单：报告里既没有已执行用例的套件（被门控跳过 / 数据缺失） */
function missingRequiredSuites(
  report: EvalReport,
  requiredSuites: readonly EvalSuiteName[],
): EvalSuiteName[] {
  return requiredSuites.filter((suite) => resultsOfSuite(report, suite).length === 0);
}

/**
 * 评估质量门禁（纯函数）：按 R1..R6 逐规则裁决，再聚合成三态总结论。
 * 聚合口径：任一规则 failed（阻断）→ failed；否则任一 inconclusive → inconclusive；
 * 否则 passed（passed / not_applicable 不影响结论）。每条规则的 reason 说清判据，
 * 门禁报告的读者应当不需要翻代码就知道差在哪。
 */
export function evaluateQualityGate(input: QualityGateInput, policy: QualityGatePolicy): QualityGateResult {
  const { report, baselineViolations, criticalViolations, checks } = input;
  const rules: GateRuleResult[] = [];

  // ── R1：必跑套件全绿 ─────────────────────────────────────────────────
  // 判据：每个必跑套件的「已执行」用例全部 passed。skipped 用例不在 results 里、
  // 不参与判定（跳过 ≠ 通过）；套件缺席由 R2 单独裁决，这里不重复计。
  const executedBySuite = policy.requiredSuites.map((suite) => ({
    suite,
    rows: resultsOfSuite(report, suite),
  }));
  const presentSuites = executedBySuite.filter((e) => e.rows.length > 0);
  const failingSuites = presentSuites.filter((e) => e.rows.some((r) => !r.passed));
  if (presentSuites.length === 0) {
    rules.push({
      id: "R1-required-suites-all-green",
      status: "not_applicable",
      blocking: true,
      reason: `必跑套件（${policy.requiredSuites.join("、")}）在本轮报告中均无已执行用例，全绿判据无对象可判；缺席本身由 R2 规则裁决。`,
    });
  } else if (failingSuites.length === 0) {
    const counts = presentSuites
      .map((e) => `${e.suite} ${e.rows.filter((r) => r.passed).length}/${e.rows.length}`)
      .join("、");
    rules.push({
      id: "R1-required-suites-all-green",
      status: "passed",
      blocking: true,
      reason: `必跑套件已执行用例全部通过（${counts}）；跳过的用例不进判定，跳过 ≠ 通过。`,
    });
  } else {
    const detail = failingSuites
      .map((e) => `${e.suite} 失败 ${e.rows.filter((r) => !r.passed).length}/${e.rows.length}`)
      .join("、");
    rules.push({
      id: "R1-required-suites-all-green",
      status: "failed",
      blocking: true,
      reason: `必跑套件存在失败用例（${detail}）。请对照评测报告的失败详情定位：判分失败先查用例与数据集，errored 用例先查基础设施。`,
    });
  }

  // ── R2：必跑套件确实执行了（缺席 → inconclusive，绝不自动通过，§12.2）──
  const missing = missingRequiredSuites(report, policy.requiredSuites);
  if (missing.length === 0) {
    rules.push({
      id: "R2-required-suites-executed",
      status: "passed",
      blocking: true,
      reason: `全部必跑套件（${policy.requiredSuites.join("、")}）本轮都有已执行用例，门禁判据覆盖完整。`,
    });
  } else if (policy.allowSkippedSuites === true) {
    // 显式容忍（仅限明知无 key 的本地快检；两个预设都不开启）：缺席降级为不适用并写明原因
    const reasons = missing
      .map((suite) => `${suite}：${report.skipReasons?.[suite] ?? "本轮无已执行用例"}`)
      .join("；");
    rules.push({
      id: "R2-required-suites-executed",
      status: "not_applicable",
      blocking: true,
      reason: `策略显式容忍必跑套件缺席（allowSkippedSuites=true）：${reasons}。该结论不等于通过，发布前请用 FULL 策略在有 key 环境复检。`,
    });
  } else {
    const reasons = missing
      .map((suite) => `${suite}（${report.skipReasons?.[suite] ?? "本轮无已执行用例"}）`)
      .join("；");
    rules.push({
      id: "R2-required-suites-executed",
      status: "inconclusive",
      blocking: true,
      reason:
        `必跑套件被跳过或缺失（${reasons}）。环境缺失不是代码失败，但门禁不能在看不见的维度上装作全绿：` +
        "补齐运行环境（如配置 API 密钥）后重跑，或换用只要求已执行套件的策略。",
    });
  }

  // ── R3：必跑套件通过率 ≥ minPassRate ────────────────────────────────
  // 分母只数已执行用例（skipped 不进分母——它不欠通过率）。0/0 无定义 →
  // not_applicable（与 trajectory 空序列特判、metrics 0/0→undefined 同一口径）。
  const executedRows = presentSuites.flatMap((e) => e.rows);
  const passedCount = executedRows.filter((r) => r.passed).length;
  if (executedRows.length === 0) {
    rules.push({
      id: "R3-required-pass-rate",
      status: "not_applicable",
      blocking: true,
      reason: `必跑套件无已执行用例，通过率 0/0 无定义；该规则不适用（缺席由 R2 裁决）。`,
    });
  } else {
    const rate = passedCount / executedRows.length;
    if (rate >= policy.minPassRate) {
      rules.push({
        id: "R3-required-pass-rate",
        status: "passed",
        blocking: true,
        reason: `必跑套件通过率 ${(rate * 100).toFixed(1)}%（${passedCount}/${executedRows.length}）≥ 门槛 ${(policy.minPassRate * 100).toFixed(1)}%。`,
      });
    } else {
      rules.push({
        id: "R3-required-pass-rate",
        status: "failed",
        blocking: true,
        reason: `必跑套件通过率 ${(rate * 100).toFixed(1)}%（${passedCount}/${executedRows.length}）低于门槛 ${(policy.minPassRate * 100).toFixed(1)}%。`,
      });
    }
  }

  // ── R4：关键用例零失败（一票否决，安全底线不被容差吸收）───────────────
  if (criticalViolations.length === 0) {
    rules.push({
      id: "R4-no-critical-violations",
      status: "passed",
      blocking: true,
      reason: "治理层 riskLevel=critical 的用例（转人工/高危路由/闲聊负例等安全底线）本轮零失败。",
    });
  } else {
    rules.push({
      id: "R4-no-critical-violations",
      status: "failed",
      blocking: true,
      reason: `关键用例失败 ${criticalViolations.length} 条（${criticalViolations.map((v) => `${v.suite}: ${v.message}`).join("；")}）。安全底线用例不允许被容差吸收，请立即定位修复。`,
    });
  }

  // ── R5：无非 stale 的基线回归（stale 提示不拦门禁，只留痕）────────────
  const regressions = baselineViolations.filter((v) => v.stale !== true);
  const staleNotices = baselineViolations.filter((v) => v.stale === true);
  if (regressions.length === 0) {
    rules.push({
      id: "R5-no-baseline-regression",
      status: "passed",
      blocking: true,
      reason:
        staleNotices.length === 0
          ? "基线比对无回归：套件 avg score 与通过率均未跌破上一版。"
          : `基线比对无回归；另有 ${staleNotices.length} 条基线过期提示（数据集/配置口径变化），仅供参考不拦门禁，建议重建基线。`,
    });
  } else {
    rules.push({
      id: "R5-no-baseline-regression",
      status: "failed",
      blocking: true,
      reason: `基线回归 ${regressions.length} 条（${regressions.map((v) => `${v.suite}: ${v.message}`).join("；")}）。数字比上一版跌了才算坏，请对照失败详情定位；确认属预期变更后重建基线。`,
    });
  }

  // ── R6：可选检查（验证/可靠性/安全摘要）逐条裁决 ─────────────────────
  // 缺席（未接线）→ 一条 not_applicable 汇总规则：可见的「未接入」，不是 passed。
  // skipped 的检查同样按 not_applicable 报告——skipped 在任何规则里都不算 passed。
  if (checks === undefined || checks.length === 0) {
    rules.push({
      id: "R6-optional-checks",
      status: "not_applicable",
      blocking: true,
      reason:
        "未提供可选检查（verification/可靠性/安全摘要，QualityGateInput.checks）：" +
        "该维度尚未接入评测管线，门禁不据此判定；接入后此规则会替换为逐检查结论。",
    });
  } else {
    for (const check of checks) {
      const ruleId = `R6-check:${check.id}`;
      switch (check.status) {
        case "passed":
          rules.push({
            id: ruleId,
            status: "passed",
            blocking: true,
            reason: `可选检查「${check.id}」通过：${check.summary}`,
          });
          break;
        case "failed":
          rules.push({
            id: ruleId,
            status: "failed",
            blocking: true,
            reason: `可选检查「${check.id}」失败：${check.summary}。请按检查摘要定位对应链路（验证/可靠性/安全）。`,
          });
          break;
        case "inconclusive":
          rules.push({
            id: ruleId,
            status: "inconclusive",
            blocking: true,
            reason: `可选检查「${check.id}」无法判定（inconclusive）：${check.summary}。不确定必须可见，门禁不据此通过或失败。`,
          });
          break;
        case "skipped":
          rules.push({
            id: ruleId,
            status: "not_applicable",
            blocking: true,
            reason: `可选检查「${check.id}」本轮被跳过：${check.summary}。跳过 ≠ 通过，该检查不参与成败判定。`,
          });
          break;
      }
    }
  }

  // ── 聚合：failed > inconclusive > passed ────────────────────────────
  const hasFailed = rules.some((r) => r.status === "failed");
  const hasInconclusive = rules.some((r) => r.status === "inconclusive");
  const status: QualityGateStatus = hasFailed ? "failed" : hasInconclusive ? "inconclusive" : "passed";
  return { status, rules, evaluatedAt: new Date().toISOString() };
}
