// apps/eval/cli.ts —— pnpm eval 入口：跑评测套件 → 打印报告 → 基线比对 → 定退出码
// 链路：runEvals()（Tier 1 离线全跑 + Tier 2/3 按 key 门控）→
// printReportToConsole()（逐用例标记 + 分套件汇总表 + 失败详情）→
// writeReportFile()（.data/eval-report.json 留档）→ 基线回归门禁（P3）→
// 全过且无回归退出 0，否则退出 1（CI 拿退出码当门禁：pnpm eval && ... 的那道闸）。
// 基线门禁三态：--update-baseline 写基线；已有基线则比对回退；没有则提示首次生成。
// 质量门禁（Phase 4）：--gate 在评测跑完后叠加 evaluateQualityGate 裁决退出码
// （--gate-policy full|ci 选预设，--strict 把 inconclusive 也拦下）；不带 --gate
// 时行为与引入门禁前逐字节一致。
// 失败案例候选区（Phase 5，PRD §13）：--export-failures 在评测跑完后把失败案例
// 导出进 .data/failure-candidates.jsonl 候选区（内容哈希去重）；--list-failures /
// --approve-failure <id> / --reject-failure <id>（配合 --reviewer <署名>）是纯
// 候选区操作，不跑评测、提前返回——转正永远是人手工改 dataset.ts（§13.3），
// Agent 代码不碰正式集/基线/门禁。
// 与 chat/cli.ts 同款约定：main(args) 导出供 index.ts 路由，直接运行时自启。
import { pathToFileURL } from "node:url";
import {
  buildBaseline,
  compareBaseline,
  criticalCaseViolations,
  evaluateQualityGate,
  exportFailureCases,
  listFailureCandidates,
  loadBaseline,
  QUALITY_GATE_POLICY_CI_TIER1,
  QUALITY_GATE_POLICY_FULL,
  reviewCandidate,
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

/** 读布尔开关后跟的值参数（如 --reviewer <name>）；开关不存在返回 undefined */
function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

/**
 * 失败案例候选区的纯操作分支（--list-failures / --approve-failure / --reject-failure）：
 * 只读写 .data/failure-candidates.jsonl，不跑评测、不碰门禁退出码语义——
 * 列表/审核是审核员的工作台动作，跟「这一轮评测过没过」是两件事。
 * 处理过任一候选区操作 → 返回 true（调用方直接 return）。
 */
function handleFailureCandidateOps(args: string[]): boolean {
  const listRequested = args.includes("--list-failures");
  const approveId = flagValue(args, "--approve-failure");
  const rejectId = flagValue(args, "--reject-failure");
  if (!listRequested && approveId === undefined && rejectId === undefined) return false;
  if (approveId !== undefined && rejectId !== undefined) {
    console.error("--approve-failure 与 --reject-failure 互斥：一次只裁决一条候选。");
    process.exitCode = 1;
    return true;
  }

  if (listRequested) {
    const candidates = listFailureCandidates();
    if (candidates.length === 0) {
      console.log("失败案例候选区为空：评测失败后可执行 pnpm eval --export-failures 导出候选。");
      return true;
    }
    console.log(`失败案例候选区（${candidates.length} 条，.data/failure-candidates.jsonl）：`);
    for (const candidate of candidates) {
      console.log(
        `[${candidate.candidateId}] ${candidate.caseId} · ${candidate.suite} · ${candidate.reviewStatus}`,
      );
      console.log(`    ${candidate.detail}`);
    }
    console.log(
      "转正提示：approved 候选由人工手工写入 dataset.ts 并登记 governance（Agent 不得自动改正式集）。",
    );
    return true;
  }

  const decision =
    approveId !== undefined
      ? { id: approveId, decision: "approved" as const }
      : { id: rejectId as string, decision: "rejected" as const };
  const reviewer = flagValue(args, "--reviewer");
  if (reviewer === undefined || reviewer.trim() === "") {
    console.error(
      `--${decision.decision === "approved" ? "approve" : "reject"}-failure 需要配合 --reviewer <署名>：候选区没有匿名的门禁。`,
    );
    process.exitCode = 1;
    return true;
  }
  try {
    reviewCandidate(decision.id, { decision: decision.decision, reviewer: reviewer.trim() });
    console.log(
      `已${decision.decision === "approved" ? "通过" : "驳回"}候选 ${decision.id}（审核人：${reviewer.trim()}）。`,
    );
    if (decision.decision === "approved") {
      console.log("提醒：通过 ≠ 转正——请人工把该用例写入 dataset.ts 并登记 governance 后升版数据集。");
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
  return true;
}

/**
 * 评测入口。args 支持 --trace（引擎执行轨迹）、--update-baseline（把本轮结果
 * 存为回归基线）、--gate（跑完后叠加质量门禁裁决）、--gate-policy full|ci
 * （门禁策略预设，默认 full，仅与 --gate 同用）与 --strict（inconclusive 也拦）。
 * Phase 5 候选区：--export-failures（评测后导出失败案例）、--list-failures /
 * --approve-failure <id> / --reject-failure <id>（配合 --reviewer <署名>，
 * 纯候选区操作，不跑评测、提前返回）。
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
    // 候选区纯操作（列表/审核）不跑评测：处理过即提前返回（Phase 5 §13）
    if (handleFailureCandidateOps(args)) return;
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

  // ── 失败案例导出（Phase 5 §13，--export-failures 显式开启）──────────────
  // 从内存中的本轮报告导出失败案例进候选区（内容哈希去重）。导出失败只警告
  // 不改退出码：候选区是改进原料的留档，不该倒过来把一轮合法评测判成失败。
  if (args.includes("--export-failures")) {
    try {
      const { added, skipped } = exportFailureCases(report);
      console.log(
        `失败案例导出：新增 ${added} 条，去重跳过 ${skipped} 条（候选区 .data/failure-candidates.jsonl）`,
      );
      console.log(
        "候选区需人工审核：pnpm eval --list-failures 查看；转正由人工改 dataset.ts（Agent 不自动改正式集）。",
      );
    } catch (err) {
      console.error(`失败案例导出失败：${err instanceof Error ? err.message : String(err)}`);
    }
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
