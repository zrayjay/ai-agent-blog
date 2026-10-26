// quality-gate.spec.ts —— 质量门禁（Phase 4 §12）单测 + §15.3 集成案例 8/9。
// 门禁是纯函数：合成报告直接喂 evaluateQualityGate，逐规则断言状态与中文原因；
// 案例 8/9 走真实 runEvals / compareBaseline 管线（全程离线：显式关掉 key 门控套件）。
// 断言口径：skipped 在任何规则里都不算 passed；缺席的可选检查按 not_applicable 报告。
import { describe, expect, it } from "vitest";
import {
  buildBaseline,
  compareBaseline,
  criticalCaseViolations,
  DEFAULT_MIN_PASS_RATE,
  evaluateQualityGate,
  QUALITY_GATE_POLICY_CI_TIER1,
  QUALITY_GATE_POLICY_FULL,
  runEvals,
} from "../src/evals/index.js";
import type { BaselineViolation } from "../src/evals/baseline.js";
import type { QualityGateCheck } from "../src/evals/quality-gate.js";
import type { EvalReport, EvalResult, EvalSuiteName } from "../src/evals/types.js";

/** 合成单用例结果（score 与 passed 同步，detail 给失败时一个可读占位） */
function result(caseId: string, suite: EvalSuiteName, passed: boolean): EvalResult {
  return {
    caseId,
    suite,
    passed,
    score: passed ? 1 : 0,
    detail: passed ? "通过" : "期望与实际不符",
    durationMs: 1,
  };
}

/** 合成报告：按套件给已执行用例；skipped 只进计数（runner 里 skipped 用例不在 results 里） */
function syntheticReport(
  suites: Partial<Record<EvalSuiteName, EvalResult[]>>,
  extra: Partial<EvalReport> = {},
): EvalReport {
  const results = Object.values(suites).flat();
  const base: EvalReport = {
    datasetVersion: "3",
    startedAt: new Date().toISOString(),
    durationMs: 1,
    totals: {
      total: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      skipped: 0,
    },
    results,
    skipped: [],
  };
  return { ...base, ...extra };
}

/** 全绿 Tier 1 报告（轨迹 2 例 + 路由 1 例，与 CI 策略的必跑集合对齐） */
function greenTier1Report(): EvalReport {
  return syntheticReport({
    trajectory: [result("traj-a", "trajectory", true), result("traj-b", "trajectory", true)],
    routing: [result("route-a", "routing", true)],
  });
}

function rule(gate: ReturnType<typeof evaluateQualityGate>, id: string) {
  const found = gate.rules.find((r) => r.id === id);
  if (found === undefined) throw new Error(`门禁规则缺失：${id}`);
  return found;
}

describe("QualityGatePolicy 预设（规则与执行分离：策略是显式数据）", () => {
  it("FULL 预设要求全部四个套件；CI_TIER1 只要求零网络的轨迹/路由", () => {
    expect(QUALITY_GATE_POLICY_FULL.requiredSuites).toEqual(["trajectory", "routing", "retrieval", "judge"]);
    expect(QUALITY_GATE_POLICY_CI_TIER1.requiredSuites).toEqual(["trajectory", "routing"]);
    // 安全底线两条在任何预设里都钉死为 true（字面量类型，编译期就关不掉）
    expect(QUALITY_GATE_POLICY_FULL.requireNoCriticalViolations).toBe(true);
    expect(QUALITY_GATE_POLICY_FULL.requireNoBaselineRegression).toBe(true);
    expect(QUALITY_GATE_POLICY_CI_TIER1.requireNoCriticalViolations).toBe(true);
    expect(QUALITY_GATE_POLICY_CI_TIER1.requireNoBaselineRegression).toBe(true);
    expect(DEFAULT_MIN_PASS_RATE).toBe(1);
    expect(QUALITY_GATE_POLICY_CI_TIER1.minPassRate).toBe(DEFAULT_MIN_PASS_RATE);
  });
});

describe("evaluateQualityGate · 规则裁决（R1..R6）", () => {
  it("R1/R3 全绿：必跑套件全部通过 → passed，且 reason 带数字判据", () => {
    const gate = evaluateQualityGate(
      { report: greenTier1Report(), baselineViolations: [], criticalViolations: [] },
      QUALITY_GATE_POLICY_CI_TIER1,
    );
    expect(gate.status).toBe("passed");
    expect(rule(gate, "R1-required-suites-all-green").status).toBe("passed");
    expect(rule(gate, "R2-required-suites-executed").status).toBe("passed");
    expect(rule(gate, "R3-required-pass-rate").status).toBe("passed");
    expect(rule(gate, "R1-required-suites-all-green").reason).toContain("trajectory 2/2");
    expect(rule(gate, "R1-required-suites-all-green").reason).toContain("routing 1/1");
    // 缺席的可选检查：not_applicable + 中文原因（不是 passed——不假装接入过）
    expect(rule(gate, "R6-optional-checks").status).toBe("not_applicable");
    expect(rule(gate, "R6-optional-checks").reason).toContain("未提供可选检查");
  });

  it("R1 失败：必跑套件有失败用例 → failed（skipped 用例不在判定里）", () => {
    const report = syntheticReport({
      trajectory: [result("traj-a", "trajectory", true), result("traj-b", "trajectory", false)],
      routing: [result("route-a", "routing", true)],
    });
    const gate = evaluateQualityGate(
      { report, baselineViolations: [], criticalViolations: [] },
      QUALITY_GATE_POLICY_CI_TIER1,
    );
    expect(gate.status).toBe("failed");
    expect(rule(gate, "R1-required-suites-all-green").status).toBe("failed");
    expect(rule(gate, "R1-required-suites-all-green").reason).toContain("trajectory 失败 1/2");
    expect(rule(gate, "R3-required-pass-rate").status).toBe("failed");
    expect(rule(gate, "R3-required-pass-rate").reason).toContain("66.7%");
  });

  it("R2 inconclusive：必跑套件被跳过 → 绝不自动通过，结论 inconclusive（§12.2）", () => {
    // CI 报告形状：检索/评审无 key 被跳过（skipReasons 记录原因）
    const report = syntheticReport(
      {
        trajectory: [result("traj-a", "trajectory", true)],
        routing: [result("route-a", "routing", true)],
      },
      {
        skipped: ["rtv-01", "judge-01"],
        skipReasons: { retrieval: "未检测到 API 密钥", judge: "未检测到 API 密钥" },
      },
    );
    const gate = evaluateQualityGate(
      { report, baselineViolations: [], criticalViolations: [] },
      QUALITY_GATE_POLICY_FULL,
    );
    expect(gate.status).toBe("inconclusive");
    const r2 = rule(gate, "R2-required-suites-executed");
    expect(r2.status).toBe("inconclusive");
    expect(r2.reason).toContain("retrieval");
    expect(r2.reason).toContain("judge");
    expect(r2.reason).toContain("未检测到 API 密钥");
  });

  it("R2 + allowSkippedSuites：显式容忍缺席 → not_applicable 且原因声明『不等于通过』", () => {
    const gate = evaluateQualityGate(
      { report: greenTier1Report(), baselineViolations: [], criticalViolations: [] },
      { ...QUALITY_GATE_POLICY_FULL, allowSkippedSuites: true },
    );
    expect(gate.status).toBe("passed");
    expect(rule(gate, "R2-required-suites-executed").status).toBe("not_applicable");
    expect(rule(gate, "R2-required-suites-executed").reason).toContain("不等于通过");
  });

  it("R1 与 R3 口径分离：minPassRate<1 时通过率达标（R3 passed）但存在失败（R1 failed）", () => {
    const rows = Array.from({ length: 10 }, (_, i) => result(`traj-${i}`, "trajectory", i !== 0));
    const report = syntheticReport({
      trajectory: rows,
      routing: [result("route-a", "routing", true)],
    });
    const gate = evaluateQualityGate(
      { report, baselineViolations: [], criticalViolations: [] },
      { ...QUALITY_GATE_POLICY_CI_TIER1, minPassRate: 0.9 },
    );
    expect(rule(gate, "R3-required-pass-rate").status).toBe("passed");
    expect(rule(gate, "R3-required-pass-rate").reason).toContain("90.0%");
    expect(rule(gate, "R1-required-suites-all-green").status).toBe("failed");
    expect(gate.status).toBe("failed"); // 全绿判据独立于通过率门槛
  });

  it("R4 一票否决：critical 用例失败 → failed（真实治理登记 route-01）", () => {
    const report = syntheticReport({
      trajectory: [result("traj-a", "trajectory", true)],
      routing: [result("route-01", "routing", false)],
    });
    const gate = evaluateQualityGate(
      { report, baselineViolations: [], criticalViolations: criticalCaseViolations(report) },
      QUALITY_GATE_POLICY_CI_TIER1,
    );
    expect(gate.status).toBe("failed");
    const r4 = rule(gate, "R4-no-critical-violations");
    expect(r4.status).toBe("failed");
    expect(r4.reason).toContain("route-01");
  });

  it("R5：非 stale 基线违规 → failed；stale 提示不拦门禁但留痕", () => {
    const regressions: BaselineViolation[] = [
      { suite: "trajectory", message: "avg score 回归：基线 1.000 → 当前 0.900" },
    ];
    const staleOnly: BaselineViolation[] = [
      { suite: "dataset", stale: true, message: "基线数据集版本为 v2，当前数据集已是 v3" },
    ];
    const failedGate = evaluateQualityGate(
      { report: greenTier1Report(), baselineViolations: regressions, criticalViolations: [] },
      QUALITY_GATE_POLICY_CI_TIER1,
    );
    expect(failedGate.status).toBe("failed");
    expect(rule(failedGate, "R5-no-baseline-regression").status).toBe("failed");

    const staleGate = evaluateQualityGate(
      { report: greenTier1Report(), baselineViolations: staleOnly, criticalViolations: [] },
      QUALITY_GATE_POLICY_CI_TIER1,
    );
    expect(staleGate.status).toBe("passed");
    expect(rule(staleGate, "R5-no-baseline-regression").status).toBe("passed");
    expect(rule(staleGate, "R5-no-baseline-regression").reason).toContain("过期提示");
  });

  it("R6 逐检查裁决：failed → failed；inconclusive → inconclusive；skipped → not_applicable（绝不折算 passed）", () => {
    const checks: QualityGateCheck[] = [
      { id: "verification", status: "passed", summary: "验收 3/3 通过" },
      { id: "reliability", status: "failed", summary: "故障注入 2 项失败" },
    ];
    const failedGate = evaluateQualityGate(
      { report: greenTier1Report(), baselineViolations: [], criticalViolations: [], checks },
      QUALITY_GATE_POLICY_CI_TIER1,
    );
    expect(failedGate.status).toBe("failed");
    expect(rule(failedGate, "R6-check:reliability").status).toBe("failed");
    expect(rule(failedGate, "R6-check:verification").status).toBe("passed");

    const skippedChecks: QualityGateCheck[] = [
      { id: "security-chain", status: "skipped", summary: "本轮未执行" },
    ];
    const skippedGate = evaluateQualityGate(
      { report: greenTier1Report(), baselineViolations: [], criticalViolations: [], checks: skippedChecks },
      QUALITY_GATE_POLICY_CI_TIER1,
    );
    expect(rule(skippedGate, "R6-check:security-chain").status).toBe("not_applicable");
    expect(rule(skippedGate, "R6-check:security-chain").reason).toContain("跳过 ≠ 通过");

    const inconclusiveGate = evaluateQualityGate(
      {
        report: greenTier1Report(),
        baselineViolations: [],
        criticalViolations: [],
        checks: [{ id: "reliability", status: "inconclusive", summary: "环境无法注入故障" }],
      },
      QUALITY_GATE_POLICY_CI_TIER1,
    );
    expect(inconclusiveGate.status).toBe("inconclusive");
  });

  it("聚合优先级：failed > inconclusive > passed", () => {
    const report = syntheticReport(
      {
        trajectory: [result("traj-a", "trajectory", false)], // R1/R3 failed
        routing: [result("route-a", "routing", true)],
      },
      { skipped: ["rtv-01"], skipReasons: { retrieval: "无 key" } },
    );
    const gate = evaluateQualityGate(
      { report, baselineViolations: [], criticalViolations: [] },
      QUALITY_GATE_POLICY_FULL,
    );
    expect(gate.status).toBe("failed"); // failed 压过 R2 的 inconclusive
    expect(gate.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── §15.3 集成案例 8：必跑套件被跳过 → FULL 门禁 inconclusive / CI 门禁不受影响 ──

describe("§15.3 案例 8 · 必跑套件缺席（runner options embeddingAvailable:false）", () => {
  it("检索/评审显式跳过：FULL 策略 inconclusive（含跳过原因），CI 策略 passed——Tier 1 跳过不连坐", async () => {
    // 显式关掉两个 key 门控套件：跳过记录进 skipped/skipReasons（跳过 ≠ 失败）
    const report = await runEvals({ embeddingAvailable: false, judgeAvailable: false });
    expect(report.skipped.length).toBeGreaterThan(0);
    expect(report.skipReasons?.retrieval).toBeTruthy();

    const fullGate = evaluateQualityGate(
      { report, baselineViolations: [], criticalViolations: [] },
      QUALITY_GATE_POLICY_FULL,
    );
    expect(fullGate.status).toBe("inconclusive");
    expect(rule(fullGate, "R2-required-suites-executed").reason).toContain("retrieval");

    // 门禁裁决的关键口径：ci 策略只要求 Tier 1，检索缺席不会把门禁打成 inconclusive
    const ciGate = evaluateQualityGate(
      { report, baselineViolations: [], criticalViolations: [] },
      QUALITY_GATE_POLICY_CI_TIER1,
    );
    expect(ciGate.status).toBe("passed");
  });
});

// ── §15.3 集成案例 9：基线回归 → compareBaseline 产出可解释、可打印的违规 ──

describe("§15.3 案例 9 · 基线回归产出可解释违规（print-shaped）", () => {
  it("avg score 跌破容差与通过率回退各自成条，消息含基线→当前数字，可直接拼 [REGRESSION] 行", async () => {
    // 第一轮：全绿报告压基线
    const goodReport = await runEvals({ embeddingAvailable: false, judgeAvailable: false });
    const baseline = buildBaseline(goodReport);

    // 第二轮：把轨迹套件一条用例改成失败（回归源：_passed 翻转 + score 归零）
    const degraded: EvalReport = {
      ...goodReport,
      results: goodReport.results.map((r) =>
        r.suite === "trajectory" && r.passed && r.caseId === "traj-01"
          ? { ...r, passed: false, score: 0, detail: "期望 [create_ticket] 实际 []" }
          : r,
      ),
    };
    degraded.totals = {
      ...degraded.totals,
      passed: degraded.totals.passed - 1,
      failed: degraded.totals.failed + 1,
    };

    const violations = compareBaseline(degraded, baseline);
    expect(violations.length).toBeGreaterThan(0);
    // 两条判据各自成条：avg score 跌幅（带基线→当前数字）与通过率回退
    const avgRegression = violations.find((v) => v.stale !== true && v.message.includes("avg score"));
    const rateRegression = violations.find((v) => v.stale !== true && v.message.includes("通过率"));
    expect(avgRegression?.suite).toBe("trajectory");
    expect(avgRegression?.message).toContain("基线 1.000 → 当前 0.900");
    expect(rateRegression?.suite).toBe("trajectory");
    expect(rateRegression?.message).toContain("有用例从过变不过");
    // print-shaped：CLI 与门禁报告消费的就是「[REGRESSION] suite: message」这一行
    expect(`[REGRESSION] ${rateRegression?.suite}: ${rateRegression?.message}`).toContain(
      "[REGRESSION] trajectory:",
    );
  });
});
