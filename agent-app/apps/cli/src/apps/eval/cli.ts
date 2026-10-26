// apps/eval/cli.ts —— pnpm eval 入口：跑评测套件 → 打印报告 → 基线比对 → 定退出码
// 链路：runEvals()（Tier 1 离线全跑 + Tier 2/3 按 key 门控）→
// printReportToConsole()（逐用例标记 + 分套件汇总表 + 失败详情）→
// writeReportFile()（.data/eval-report.json 留档）→ 基线回归门禁（P3）→
// 全过且无回归退出 0，否则退出 1（CI 拿退出码当门禁：pnpm eval && ... 的那道闸）。
// 基线门禁三态：--update-baseline 写基线；已有基线则比对回退；没有则提示首次生成。
// 质量门禁（Phase 4）：--gate 在评测跑完后叠加 evaluateQualityGate 裁决退出码
// （--gate-policy full|ci 选预设，--strict 把 inconclusive 也拦下）；不带 --gate
// 时行为与引入门禁前逐字节一致。
// 与 chat/cli.ts 同款约定：main(args) 导出供 index.ts 路由，直接运行时自启。
import { pathToFileURL } from "node:url";
import {
  buildBaseline,
  compareBaseline,
  criticalCaseViolations,
  evaluateQualityGate,
  loadBaseline,
  QUALITY_GATE_POLICY_CI_TIER1,
  QUALITY_GATE_POLICY_FULL,
  runEvals,
  saveBaseline,
} from "@agent-app/engine/evals";
import type { BaselineViolation, QualityGatePolicy } from "@agent-app/engine/evals";
import { printReportToConsole, writeReportFile } from "@agent-app/engine/evals";
import { enableTrace } from "@agent-app/engine/trace";

/**
 * 解析 --gate-policy 的值：full（发布门禁，四套件必跑）/ ci（CI Tier 1 门禁，
 * 只要求轨迹/路由）。未传默认 full；认识的值之外直接报错——门禁策略拼错还
 * 静默往下跑，等于把关闸的钥匙插错锁孔。
 */
function resolveGatePolicy(raw: string | undefined): QualityGatePolicy | undefined {
  if (raw === undefined) return QUALITY_GATE_POLICY_FULL;
  if (raw === "full") return QUALITY_GATE_POLICY_FULL;
  if (raw === "ci") return QUALITY_GATE_POLICY_CI_TIER1;
  return undefined;
}

/**
 * 评测入口。args 支持 --trace（引擎执行轨迹）、--update-baseline（把本轮结果
 * 存为回归基线）、--gate（跑完后叠加质量门禁裁决）、--gate-policy full|ci
 * （门禁策略预设，默认 full，仅与 --gate 同用）与 --strict（inconclusive 也拦）。
 */
export async function main(args: string[] = []): Promise<void> {
  if (args.includes("--trace")) enableTrace();

  const gateEnabled = args.includes("--gate");
  const gateStrict = args.includes("--strict");
  const gatePolicyRaw = args.includes("--gate-policy") ? args[args.indexOf("--gate-policy") + 1] : undefined;
  let gatePolicy: QualityGatePolicy | undefined;
  if (gateEnabled) {
    gatePolicy = resolveGatePolicy(gatePolicyRaw);
    if (gatePolicy === undefined) {
      console.error(`不认识的质量门禁策略：--gate-policy ${gatePolicyRaw}（可选 full | ci）。`);
      process.exitCode = 1;
      return;
    }
  }

  let report;
  try {
    report = await runEvals();
  } catch (err) {
    // 错误礼仪同 chat/cli.ts：告诉用户怎么修，而不是甩一串堆栈
    console.error("评测运行失败：" + (err instanceof Error ? err.message : String(err)));
    console.error("请检查：1) 是否在 agent-app 根目录运行（报告落在 .data/ 下）；");
    console.error("          2) packages/engine 是否已构建（pnpm --filter @agent-app/engine build）；");
    console.error("          3) 上述错误信息中的修复指引。");
    process.exitCode = 1;
    return;
  }

  printReportToConsole(report);

  // 统一报告字段（Phase 3 §7.4）：评测器版本 + 配置指纹一行速读；
  // 执行出错（errored）出现时追加计数——归因时先查基础设施再查判分
  console.log(
    `评测器版本 v${report.evaluatorVersion} · 配置指纹 ${report.configId}` +
      (report.totals.errors !== undefined ? ` · 执行出错 ${report.totals.errors} 例` : ""),
  );

  try {
    const written = writeReportFile(report);
    console.log(`报告已写入：${written}`);
  } catch (err) {
    console.error(`报告落盘失败：${err instanceof Error ? err.message : String(err)}`);
    console.error("请检查对 .data/ 目录的写权限（或当前工作目录是否为 agent-app 根目录）。");
    process.exitCode = 1;
    return;
  }

  // ── 基线回归门禁（P3，教程 week16 Day 6）───────────────────────────────
  // 退出码 = 两道闸的与：用例全过 && 无（非 stale）回归 && 无关键用例失败。
  // 基线是 .data/ 下的本地文件（不进 git）：换机器/CI 首次跑没有基线 →
  // 只提示不拦截；数据集版本/配置指纹不一致 → stale 提示，不拦截。
  let hasRegression = false;
  const baselineViolations: BaselineViolation[] = [];
  if (args.includes("--update-baseline")) {
    try {
      const saved = saveBaseline(buildBaseline(report));
      console.log(`已更新基线（${saved}）`);
    } catch (err) {
      console.error(`基线落盘失败：${err instanceof Error ? err.message : String(err)}`);
      console.error("请检查对 .data/ 目录的写权限（或当前工作目录是否为 agent-app 根目录）。");
      process.exitCode = 1;
      return;
    }
  } else {
    let baseline = null;
    let baselineBroken = false;
    try {
      baseline = loadBaseline();
    } catch (err) {
      // 基线损坏：报错并按无基线继续（本轮报告自身的失败仍然拦门禁），
      // 不让一个坏 JSON 把整轮评测打成基础设施错误
      baselineBroken = true;
      console.error(err instanceof Error ? err.message : String(err));
    }
    if (baseline !== null) {
      for (const violation of compareBaseline(report, baseline)) {
        baselineViolations.push(violation);
        if (violation.stale === true) {
          console.log(`[提示] ${violation.message}`);
        } else {
          console.log(`[REGRESSION] ${violation.suite}: ${violation.message}`);
          hasRegression = true;
        }
      }
    } else if (!baselineBroken) {
      console.log("首次运行可执行 pnpm eval --update-baseline 生成回归基线");
    }
  }

  // 关键用例阻断（Phase 3 §8.2）：与基线无关的一票否决——critical 用例失败
  // （含 --update-baseline 重置基线的场合）直接拦门禁，安全底线不被容差吸收
  const criticalViolations = criticalCaseViolations(report);
  for (const violation of criticalViolations) {
    console.log(`[CRITICAL] ${violation.suite}: ${violation.message}`);
    hasRegression = true;
  }

  // ── 质量门禁（Phase 4 §12，--gate 显式开启）────────────────────────────
  // 门禁只裁决退出码，绝不反哺执行：评测已经跑完，这里只是把报告 + 违规清单
  // 交给纯函数 evaluateQualityGate 出结论。逐规则打印中文原因，让 CI 日志的
  // 读者不需要翻代码就知道差在哪。
  if (gateEnabled && gatePolicy !== undefined) {
    const gate = evaluateQualityGate({ report, baselineViolations, criticalViolations }, gatePolicy);
    console.log("=".repeat(64));
    console.log(`质量门禁（策略：${gatePolicy === QUALITY_GATE_POLICY_CI_TIER1 ? "ci" : "full"}）`);
    for (const rule of gate.rules) {
      console.log(`[GATE] ${rule.id} · ${rule.status}${rule.blocking ? "（阻断）" : ""} — ${rule.reason}`);
    }
    console.log("=".repeat(64));
    if (gate.status === "passed") {
      console.log("[QUALITY GATE] passed — 全部门禁规则通过");
      process.exitCode = 0;
    } else if (gate.status === "failed") {
      console.log("[QUALITY GATE] failed — 存在阻断性失败规则，退出码 1 拦截");
      process.exitCode = 1;
    } else {
      // inconclusive：必跑套件被跳过等「无法判定」——不通过也不算失败。
      // 默认放行但大声标出来；--strict 把「不确定」也当失败（发布前最后把关用）。
      console.log(
        "[INCONCLUSIVE] 质量门禁无法得出确定结论（存在被跳过/缺席的必跑维度）——不是通过，也不视为失败",
      );
      if (gateStrict) {
        console.log("[STRICT] --strict 已开启：inconclusive 按失败处理，退出码 1");
        process.exitCode = 1;
      } else {
        process.exitCode = 0;
      }
    }
    return;
  }

  // 全过且无回归（含关键用例全过）= 0，否则 = 1：CI 把 pnpm eval 当门禁，退出码就是判决。
  // --gate 路径在上面已按门禁结论定退出码并提前返回——默认行为与引入门禁前逐字节一致。
  process.exitCode = report.totals.passed === report.totals.total && !hasRegression ? 0 : 1;
}

// 直接运行（pnpm eval）时自动执行；被 index.ts 路由导入时由调用方调 main(rest)
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
