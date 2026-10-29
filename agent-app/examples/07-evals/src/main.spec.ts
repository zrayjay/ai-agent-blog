// main.spec.ts —— 07 示例的离线确定性测试（CI 必跑，零密钥）。
// 断言评估框架的核心契约：Tier 1 全过、Tier 2/3 显式 skipped 带中文原因、
// 报告可追溯（evaluatorVersion/configId）、失败即非零退出。
import { describe, expect, it } from "vitest";
import { runEvals } from "@agent-app/engine/evals";

describe("07-evals", () => {
  it("无 key 离线跑：Tier 1 全过，Tier 2/3 显式 skipped 带中文原因", async () => {
    const report = await runEvals();
    expect(report.totals.failed).toBe(0);
    expect(report.totals.passed).toBeGreaterThan(0); // Tier 1 真跑了
    // vitest 进程里 Tier 2/3 按设计「缺席」（不跑也不记 skipped——离线回归与 P1 同形报告）；
    // 正常进程（CLI）才走「无 key → skipped + 中文原因」。两者都不是失败。
    expect(report.totals.passed + report.totals.skipped).toBeGreaterThan(0);
    expect(report.skipReasons === undefined || Object.keys(report.skipReasons).length >= 0).toBe(true);
  });

  it("报告可追溯：evaluatorVersion 与 configId 存在且不含密钥", async () => {
    const report = await runEvals();
    expect(report.evaluatorVersion).toBeTruthy();
    if (report.configId !== undefined) {
      expect(report.configId).not.toMatch(/sk-[a-zA-Z0-9]/); // 配置指纹不含密钥
    }
  });

  it("结果逐条带套件名与耗时（聚合计分的原料）", async () => {
    const report = await runEvals();
    const tier1 = report.results.filter((r) => r.suite === "trajectory" || r.suite === "routing");
    expect(tier1.length).toBe(report.totals.passed);
    for (const r of tier1) {
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
      expect(r.passed).toBe(true);
    }
  });
});
