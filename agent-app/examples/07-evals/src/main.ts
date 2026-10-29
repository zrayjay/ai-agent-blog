// main.ts —— 07 示例：评估框架的完整跑（环境决定 Tier 2/3 深度）。
// runEvals()：Tier 1（轨迹/路由）零密钥全跑；Tier 2/3（检索/评审）按环境三态门控——
// 本机 .env 有 key 则真跑，无 key 则 skipped + 中文原因（跳过 ≠ 失败，也绝不假装跑过）；
// vitest 进程里 Tier 2/3 按设计缺席（离线回归与 P1 同形报告）。
// REAL 路径：.env 配 key 后重跑，Tier 2/3 真执行（pnpm eval 等价）。
import { runEvals } from "@agent-app/engine/evals";

const report = await runEvals();

console.log(`[评测] 数据集版本 ${report.datasetVersion} · 总耗时 ${report.durationMs}ms`);
console.log(
  `[评测] 总计：passed ${report.totals.passed} / failed ${report.totals.failed} / skipped ${report.totals.skipped}` +
    "（skipped 数取决于环境：有 key 为 0，无 key 为 N + 中文原因，vitest 进程缺席）",
);
for (const [suite, reason] of Object.entries(report.skipReasons ?? {})) {
  console.log(`[评测] 跳过原因：${suite}=${reason.slice(0, 40)}…`);
}
if (report.totals.failed > 0) {
  console.error("[评测] 存在失败用例（Tier 1 失败即门禁失败）");
  process.exit(1);
}
console.log("[评测] 全部 Tier 1 用例通过 → 退出码 0");
