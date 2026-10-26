// verified-run-gate.ts - Personal Agent 的评估证据桥接器。
// 不执行 Agent、不发起发布；上层必须从有权限的可信存储读取真实验收报告。
import type { VerificationResult } from "../verification/types.js";
import { evaluateQualityGate, QUALITY_GATE_POLICY_FULL } from "./quality-gate.js";
import type { QualityGateCheck, QualityGateInput, QualityGatePolicy, QualityGateResult } from "./quality-gate.js";

export interface RequiredVerificationEvidence {
  /** 由可信 Run 存储提供，不能来自 Agent 的文字声明。 */
  expectedRunId: string;
  /** 必需验证器 ID。空数组不能被视为有效验收。 */
  requiredVerifierIds: readonly string[];
  verification?: VerificationResult;
}

export interface VerifiedRunGateInput extends QualityGateInput, RequiredVerificationEvidence {}

/** 禁止调用方提供伪造的同名可选检查覆盖本桥接器。 */
export const RUN_VERIFICATION_GATE_CHECK_ID = "verification:required-run-evidence";

function verdict(status: QualityGateCheck["status"], summary: string): QualityGateCheck {
  return { id: RUN_VERIFICATION_GATE_CHECK_ID, status, summary };
}

/**
 * 根据真实 VerificationResult 构造必须执行的验收检查。
 * failed > inconclusive > passed；缺少证据和空验证器不能判 passed。
 */
export function toRequiredVerificationCheck(input: RequiredVerificationEvidence): QualityGateCheck {
  const { expectedRunId, requiredVerifierIds, verification } = input;
  if (expectedRunId.trim() === "") {
    return verdict("inconclusive", "缺少可信 Run ID，无法判定证据归属。");
  }
  if (requiredVerifierIds.length === 0 ||
      requiredVerifierIds.some((id) => id.trim() === "") ||
      new Set(requiredVerifierIds).size !== requiredVerifierIds.length) {
    return verdict("inconclusive", "必查验证器必须是非空、无重复的 ID 列表。");
  }
  if (verification === undefined) {
    return verdict("inconclusive", "缺少 VerificationResult；没有真实证据不能放行。");
  }
  if (verification.runId !== expectedRunId) {
    return verdict("failed", "验收报告 runId 与目标运行不符，禁止混用报告。");
  }
  if (verification.checks.length === 0) {
    return verdict("inconclusive", "空检查项不能代表完成验收。");
  }

  const required = requiredVerifierIds.map((id) => ({
    id,
    checks: verification.checks.filter((check) => check.verifierId === id),
  }));
  const failed = required.filter((item) => item.checks.some((check) => check.status === "failed"));
  if (failed.length > 0 || verification.status === "failed") {
    return verdict(
      "failed",
      "验证失败；必查项失败：" + (failed.map((item) => item.id).join("、") || "请查看原始报告"),
    );
  }

  const missing = required.filter((item) => item.checks.length === 0);
  const skipped = required.filter((item) => item.checks.some((check) => check.status === "skipped"));
  if (missing.length > 0 || skipped.length > 0 || verification.status === "inconclusive") {
    return verdict(
      "inconclusive",
      "证据不足：缺失 [" + missing.map((item) => item.id).join("、") +
        "]，跳过 [" + skipped.map((item) => item.id).join("、") +
        "]，原结论 " + verification.status,
    );
  }
  return verdict(
    "passed",
    "Run " + expectedRunId + " 的 " + required.length + " 个必查验证器均通过客观证据检查。",
  );
}

/**
 * 与现有 Quality Gate R1–R6 兼容：必查验证结论从 R6 进入三态聚合。
 * 默认 FULL 策略；不能把 CI_TIER1 当成生产 Agent 发布门禁。
 */
export function evaluateVerifiedRunGate(
  input: VerifiedRunGateInput,
  policy: QualityGatePolicy = QUALITY_GATE_POLICY_FULL,
): QualityGateResult {
  const { expectedRunId, requiredVerifierIds, verification, ...qualityInput } = input;
  const requiredCheck = toRequiredVerificationCheck({ expectedRunId, requiredVerifierIds, verification });
  const checks = (qualityInput.checks ?? []).filter(
    (check) => check.id !== RUN_VERIFICATION_GATE_CHECK_ID,
  );
  return evaluateQualityGate(
    { ...qualityInput, checks: [...checks, requiredCheck] },
    policy,
  );
}
