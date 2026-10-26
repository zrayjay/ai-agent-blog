import { describe, expect, it } from "vitest";
import { VerificationRunner } from "../src/verification/runner.js";
import type { VerificationResult } from "../src/verification/types.js";
import type { EvalReport, EvalResult } from "../src/evals/types.js";
import {
  evaluateVerifiedRunGate,
  RUN_VERIFICATION_GATE_CHECK_ID,
  toRequiredVerificationCheck,
} from "../src/evals/verified-run-gate.js";
import { QUALITY_GATE_POLICY_CI_TIER1, QUALITY_GATE_POLICY_FULL } from "../src/evals/quality-gate.js";

const RUN_ID = "run-real-001";

function greenTier1Report(): EvalReport {
  const results: EvalResult[] = [
    { caseId: "traj-1", suite: "trajectory", passed: true, score: 1, detail: "ok", durationMs: 1 },
    { caseId: "routing-1", suite: "routing", passed: true, score: 1, detail: "ok", durationMs: 1 },
  ];
  return {
    datasetVersion: "3",
    startedAt: new Date(0).toISOString(),
    durationMs: 2,
    totals: { total: 2, passed: 2, failed: 0, skipped: 0 },
    results,
    skipped: [],
  };
}

function verification(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    runId: RUN_ID,
    status: "passed",
    checks: [
      { id: "schema:ok", verifierId: "schema", verifierVersion: "1", status: "passed" },
      { id: "tool:ok", verifierId: "tool", verifierVersion: "1", status: "passed" },
    ],
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function assess(evidence: VerificationResult | undefined, required: readonly string[] = ["schema", "tool"]) {
  return evaluateVerifiedRunGate(
    {
      report: greenTier1Report(),
      baselineViolations: [],
      criticalViolations: [],
      expectedRunId: RUN_ID,
      requiredVerifierIds: required,
      verification: evidence,
    },
    QUALITY_GATE_POLICY_CI_TIER1,
  );
}

describe("Personal Agent 真实验收证据 → Quality Gate", () => {
  it("与真实 VerificationRunner 接线，全套必查通过才允许通过", async () => {
    const evidence = await new VerificationRunner([
      { id: "schema", version: "1", verify: () => [{ id: "shape", status: "passed" }] },
      { id: "tool", version: "1", verify: () => [{ id: "called", status: "passed" }] },
    ]).run({ runId: RUN_ID });
    const gate = assess(evidence);
    expect(gate.status).toBe("passed");
    expect(gate.rules.find((r) => r.id === "R6-check:" + RUN_VERIFICATION_GATE_CHECK_ID)?.status)
      .toBe("passed");
  });

  it("缺少报告不能被已有 Eval 的绿色报告掩盖", () => {
    expect(assess(undefined).status).toBe("inconclusive");
  });

  it("即使 VerificationRunner([]) 返回 passed，也不得用零检查放行", async () => {
    const empty = await new VerificationRunner([]).run({ runId: RUN_ID });
    expect(empty.status).toBe("passed");
    expect(assess(empty).status).toBe("inconclusive");
  });

  it("Run 身份不匹配时判 failed，禁止串用其他任务验收结果", () => {
    expect(assess(verification({ runId: "another-run" })).status).toBe("failed");
  });

  it("必查验证器配置为空、重复或空 id 都不放行", () => {
    expect(assess(verification(), []).status).toBe("inconclusive");
    expect(assess(verification(), ["schema", "schema"]).status).toBe("inconclusive");
    expect(assess(verification(), [" "]).status).toBe("inconclusive");
  });

  it("某个必查验证器未出证据，即使顶层写 passed 也为 inconclusive", () => {
    expect(assess(verification({ checks: [verification().checks[0]!] })).toMatchObject({
      status: "inconclusive",
    });
  });

  it("必查项 skipped 不等于 passed", () => {
    const checks = [
      verification().checks[0]!,
      { id: "timeout", verifierId: "tool", verifierVersion: "1", status: "skipped" as const },
    ];
    expect(assess(verification({ checks })).status).toBe("inconclusive");
  });

  it("必查项失败优先级高于 inconclusive，即使顶层错误标记 passed 也必须失败", () => {
    const checks = [
      { id: "bad", verifierId: "schema", verifierVersion: "1", status: "failed" as const },
      { id: "not-run", verifierId: "tool", verifierVersion: "1", status: "skipped" as const },
    ];
    expect(assess(verification({ checks })).status).toBe("failed");
  });

  it("Verification 顶层 failed/inconclusive 不被单项 passed 覆盖", () => {
    expect(assess(verification({ status: "failed" })).status).toBe("failed");
    expect(assess(verification({ status: "inconclusive" })).status).toBe("inconclusive");
  });

  it("上层可选检查不能伪装可信 verification 检查", () => {
    const gate = evaluateVerifiedRunGate({
      report: greenTier1Report(),
      baselineViolations: [],
      criticalViolations: [],
      expectedRunId: RUN_ID,
      requiredVerifierIds: ["schema"],
      verification: undefined,
      checks: [
        { id: RUN_VERIFICATION_GATE_CHECK_ID, status: "passed", summary: "伪造通过" },
      ],
    }, QUALITY_GATE_POLICY_CI_TIER1);
    expect(gate.status).toBe("inconclusive");
    expect(gate.rules.filter((r) => r.id === "R6-check:" + RUN_VERIFICATION_GATE_CHECK_ID))
      .toHaveLength(1);
  });

  it("离线 CI 的绿灯不能替代发布所需的 FULL 检索和 Judge 套件", () => {
    const gate = evaluateVerifiedRunGate({
      report: greenTier1Report(),
      baselineViolations: [],
      criticalViolations: [],
      expectedRunId: RUN_ID,
      requiredVerifierIds: ["schema", "tool"],
      verification: verification(),
    }, QUALITY_GATE_POLICY_FULL);
    expect(gate.status).toBe("inconclusive");
    expect(gate.rules.find((r) => r.id === "R2-required-suites-executed")?.status)
      .toBe("inconclusive");
  });

  it("Eval 用例自身的确定失败优先于无证据", () => {
    const report = greenTier1Report();
    const brokenResults: EvalResult[] = report.results.map((r, i) =>
      i === 0 ? { ...r, passed: false, score: 0 } : r,
    );
    const gate = evaluateVerifiedRunGate({
      report: {
        ...report,
        results: brokenResults,
        totals: { total: 2, passed: 1, failed: 1, skipped: 0 },
      },
      baselineViolations: [],
      criticalViolations: [],
      expectedRunId: RUN_ID,
      requiredVerifierIds: ["schema"],
      verification: undefined,
    }, QUALITY_GATE_POLICY_CI_TIER1);
    expect(gate.status).toBe("failed");
  });

  it("可以单独用于 Runtime Post-run 的三态客观证据判定", () => {
    expect(toRequiredVerificationCheck({
      expectedRunId: RUN_ID,
      requiredVerifierIds: ["schema"],
      verification: verification(),
    }).status).toBe("passed");
  });
});
