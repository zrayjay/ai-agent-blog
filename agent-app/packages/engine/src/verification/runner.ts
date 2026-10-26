// verification/runner.ts —— 验证运行器：逐验证器取证 → 落账 → 聚合成三态结论（Phase 1）。
//
// ── 聚合规则（never default-pass）────────────────────────────────────────
//   1. 任一必查（required）检查 failed        → 总结论 failed（一票否决）；
//   2. 必查检查 skipped（证据缺失）           → 总结论 inconclusive；
//   3. 验证器 verify 抛错                     → 记一条 skipped 检查（带错误消息，
//      绝不吞掉），若该验证器必查 → 总结论 inconclusive；
//   4. 必查验证器一条检查都没产出（空清单）   → 同样视为证据缺失，记 skipped
//      → 必查时总结论 inconclusive——空清单不能静默折算成 passed；
//   5. 全部必查 passed                        → 总结论 passed；
//   6. 可选检查的失败/跳过只落账，永不翻转总结论。
// 优先级：failed > inconclusive > passed——存在确定性失败时，「另有检查不确定」
// 不改变已知的坏消息（坏消息优先上报，不确定的部分仍在 checks 里可查）。
//
// ── 为什么聚合归 Runner 而不是验证器 ──────────────────────────────────────
// 验证器保持纯判定（输入证据 → 输出检查清单），聚合与溯源（verifierId/
// verifierVersion 补填）集中在这一处：规则改一处生效，验证器不用每个都懂政策。

import type {
  CheckResult,
  VerificationContext,
  VerificationResult,
  VerificationStatus,
  Verifier,
  VerifierCheck,
} from "./types.js";

/** 逐条检查落账后的聚合规则与执行编排（一个 Run 一次验证 = 一个 runner 实例复用） */
export class VerificationRunner {
  constructor(private readonly verifiers: readonly Verifier[]) {}

  /** 必查验证器 id 集合（required 缺省 = true，fail-closed 口径见 types.ts） */
  private requiredIds(): ReadonlySet<string> {
    return new Set(this.verifiers.filter((v) => v.required !== false).map((v) => v.id));
  }

  /** 跑完全部验证器并聚合：这是本模块唯一有政策的地方 */
  async run(context: VerificationContext): Promise<VerificationResult> {
    const startedAt = new Date().toISOString();
    const requiredIds = this.requiredIds();
    const checks: CheckResult[] = [];

    for (const verifier of this.verifiers) {
      let drafted: readonly VerifierCheck[];
      try {
        drafted = await verifier.verify(context);
      } catch (err) {
        // 验证器自身抛错 ≠ 验证失败也 ≠ 验证通过：折成 skipped 检查记录
        // 错误消息（不吞），交由下方聚合按必查口径判 inconclusive。
        checks.push({
          id: verifier.id,
          status: "skipped",
          message: `验证器 ${verifier.id} 执行抛错：${err instanceof Error ? err.message : String(err)}`,
          verifierId: verifier.id,
          verifierVersion: verifier.version,
        });
        continue;
      }
      if (drafted.length === 0) {
        // 必查验证器零产出 = 没有任何证据：显式记 skipped，绝不静默放行。
        checks.push({
          id: verifier.id,
          status: "skipped",
          message: `验证器 ${verifier.id} 未产出任何检查结果（证据缺失）`,
          verifierId: verifier.id,
          verifierVersion: verifier.version,
        });
        continue;
      }
      for (const check of drafted) {
        checks.push({ ...check, verifierId: verifier.id, verifierVersion: verifier.version });
      }
    }

    let status: VerificationStatus = "passed";
    for (const check of checks) {
      if (check.verifierId === undefined || !requiredIds.has(check.verifierId)) continue; // 可选：只落账
      if (check.status === "failed") {
        status = "failed";
        break; // 一票否决；checks 已完整，无需继续翻状态
      }
      if (check.status === "skipped") {
        status = "inconclusive";
      }
    }

    return {
      runId: context.runId,
      status,
      checks,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}
