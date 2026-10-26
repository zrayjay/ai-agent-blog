// evals-governance.spec.ts —— Phase 3 新机制的行为测试（离线、确定性、零网络）
// 覆盖六个面：数据集治理（默认值 / 关键名单 / 完整性护栏）、候选区机制（合成用例
// opt-in 才跑，正式集一条不动）、效率打分器（预算核对）、Judge 加固（版本化 rubric
// / 证据注入 / 畸形输出防御）、统一报告字段（evaluatorVersion / configId / errored）、
// 基线加固（容差可配 / 指纹 stale / 关键用例阻断）。既有 76 例的行为回归在
// evals.spec.ts，本文件只增不改。
import { describe, expect, it, vi } from "vitest";
import type { ToolLoopStepEvent } from "../src/agent-loop.js";
import { buildConfigId } from "../src/config.js";
import {
  CANDIDATE_CASE_IDS,
  EVAL_CASES,
  EVAL_DATASET_ID,
  EVAL_DATASET_VERSION,
  EVAL_DIMENSIONS,
  EVAL_EVALUATOR_VERSION,
  EVAL_JUDGE_CASES,
  EVAL_QUERIES,
  JUDGE_RUBRIC_VERSION,
  BASELINE_TOLERANCE,
  buildBaseline,
  buildJudgePrompt,
  compareBaseline,
  criticalCaseViolations,
  getBaselineTolerance,
  getCaseGovernance,
  listAllFormalCaseIds,
  listCriticalCaseIds,
  parseJudgeVerdict,
  runEvals,
  scoreEfficiency,
} from "../src/evals/index.js";
import type {
  EvalReport,
  EvalResult,
  JudgeFn,
  RetrievalEvalCase,
  RoutingEvalCase,
  TrajectoryEvalCase,
} from "../src/evals/index.js";

/** 造一个最小 ToolLoopStepEvent（效率打分器只数步数，其余字段填占位值） */
function step(toolName: string): ToolLoopStepEvent {
  return { step: 1, toolCall: { toolName, input: {} }, output: {} };
}

/** 造一条合成结果行（基线/关键违规判定只看 caseId/suite/score/passed/errored） */
function row(
  caseId: string,
  suite: EvalResult["suite"],
  score: number,
  passed: boolean,
  errored?: boolean,
): EvalResult {
  return errored === undefined
    ? { caseId, suite, passed, score, detail: "", durationMs: 0 }
    : { caseId, suite, passed, score, detail: "", durationMs: 0, errored };
}

/** 用合成结果行拼一份最小报告（compareBaseline 只消费 datasetVersion/configId/results） */
function reportOf(version: string, rows: EvalResult[], configId?: string): EvalReport {
  const report: EvalReport = {
    datasetVersion: version,
    startedAt: "2026-10-26T00:00:00.000Z",
    durationMs: 1,
    totals: {
      total: rows.length,
      passed: rows.filter((r) => r.passed).length,
      failed: rows.filter((r) => !r.passed).length,
      skipped: 0,
    },
    results: rows,
    skipped: [],
  };
  if (configId !== undefined) report.configId = configId;
  return report;
}

// ══ 数据集治理（governance.ts）━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("数据集治理 getCaseGovernance / listCriticalCaseIds", () => {
  it("数据集稳定标识存在且未登记的 caseId 走安全默认值", () => {
    expect(EVAL_DATASET_ID).toBe("customer-service-golden");
    expect(getCaseGovernance(" totally-unknown-case ")).toEqual({
      riskLevel: "standard",
      dimensions: ["correctness"],
      reviewStatus: "reviewed",
      source: "golden-dataset-v3",
    });
  });

  it("关键名单恰好 8 条：5 条安全路由 + 3 条闲聊负例，按序且唯一", () => {
    expect(listCriticalCaseIds()).toEqual([
      "route-01",
      "route-02",
      "route-03",
      "route-04",
      "route-05",
      "traj-05",
      "traj-06",
      "traj-07",
    ]);
    for (const caseId of listCriticalCaseIds()) {
      expect(getCaseGovernance(caseId).riskLevel).toBe("critical");
    }
  });

  it("效率维度登记跟声明走：traj-04/traj-09 是 standard 但考 efficiency", () => {
    for (const caseId of ["traj-04", "traj-09"]) {
      const governance = getCaseGovernance(caseId);
      expect(governance.riskLevel).toBe("standard");
      expect(governance.dimensions).toContain("efficiency");
    }
  });

  it("完整性护栏：critical/维度登记不得引用不存在的题目或非法维度", () => {
    const formalIds = new Set(listAllFormalCaseIds());
    for (const caseId of listCriticalCaseIds()) {
      expect(formalIds.has(caseId), `critical 登记 ${caseId} 不在正式集里`).toBe(true);
    }
    for (const caseId of listAllFormalCaseIds()) {
      const governance = getCaseGovernance(caseId);
      for (const dimension of governance.dimensions) {
        expect(EVAL_DIMENSIONS, `${caseId} 登记了非法维度 ${dimension}`).toContain(dimension);
      }
      expect(governance.reviewStatus).toBe("reviewed");
    }
  });

  it("候选区今天为空：正式集是门禁的唯一对象", () => {
    expect(CANDIDATE_CASE_IDS).toHaveLength(0);
    expect(EVAL_CASES).toHaveLength(18);
  });
});

// ══ 候选区机制（runner opt-in）━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("候选区机制 includeCandidates（合成用例，正式集不动）", () => {
  /** 合成候选轨迹用例：与正式集同构的最小单工具场景 */
  const candTraj: TrajectoryEvalCase = {
    caseId: "cand-traj-01",
    suite: "trajectory",
    description: "合成候选：单工具查物流（治理机制验证，不属于正式集）",
    userMessage: "查一下订单 C-0001 的物流到哪了",
    script: [
      { kind: "tool-calls", calls: [{ toolName: "query_logistics", input: { orderId: "C-0001" } }] },
      { kind: "text", text: "订单 C-0001 已发货，预计明天送达。" },
    ],
    expectedToolCalls: ["query_logistics"],
  };
  /** 合成候选路由用例 */
  const candRoute: RoutingEvalCase = {
    caseId: "cand-route-01",
    suite: "routing",
    description: "合成候选：转人工（治理机制验证，不属于正式集）",
    state: { lastUserMessage: "转人工", unresolvedRounds: 0 },
    expectedTarget: "human",
  };

  it("默认不 opt-in：候选区缺席，正式集数量不变（formal 集才是门禁对象）", async () => {
    const report = await runEvals();
    expect(report.totals.total).toBe(EVAL_CASES.length);
    expect(report.results.some((r) => r.caseId.startsWith("cand-"))).toBe(false);
  });

  it("opt-in 但未注入候选实体：无候选可跑，等于正式集裸跑", async () => {
    const report = await runEvals({ includeCandidates: true });
    expect(report.totals.total).toBe(EVAL_CASES.length);
  });

  it("opt-in + 合成候选：候选照常执行并判分，正式集全绿不变", async () => {
    const report = await runEvals({ includeCandidates: true, candidateCases: [candTraj, candRoute] });

    expect(report.totals.total).toBe(EVAL_CASES.length + 2);
    expect(report.totals.failed).toBe(0);
    expect(report.totals.skipped).toBe(0);
    const candidateRows = report.results.filter((r) => r.caseId.startsWith("cand-"));
    expect(candidateRows.map((r) => r.caseId)).toEqual(["cand-traj-01", "cand-route-01"]);
    expect(candidateRows.every((r) => r.passed)).toBe(true);
    // 正式集 18 条一条不少、全部照常通过
    expect(report.results.filter((r) => !r.caseId.startsWith("cand-"))).toHaveLength(EVAL_CASES.length);
  });

  it("候选区混入门控套件（检索）→ 当场报错，绝不静默漏跑", async () => {
    const candRtv: RetrievalEvalCase = {
      caseId: "cand-rtv-01",
      suite: "retrieval",
      description: "合成候选（非法：门控套件不进候选区）",
      query: "退货政策",
      expectedDocId: "doc-return-policy",
    };
    await expect(runEvals({ includeCandidates: true, candidateCases: [candRtv] })).rejects.toThrow(/候选区/);
  });
});

// ══ 效率打分器（scorers/efficiency.ts）━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("效率打分器 scoreEfficiency", () => {
  it("工具数在预算内 → 通过，detail 写明实测/预算", () => {
    const output = scoreEfficiency([step("a"), step("b")], { maxToolCalls: 3 });
    expect(output.passed).toBe(true);
    expect(output.score).toBe(1);
    expect(output.detail).toContain("工具调用 2 次（预算 3）");
  });

  it("工具数超预算 → 不通过 0 分", () => {
    const output = scoreEfficiency([step("a"), step("b"), step("c"), step("d")], { maxToolCalls: 3 });
    expect(output.passed).toBe(false);
    expect(output.score).toBe(0);
    expect(output.detail).toContain("工具调用 4 次（预算 3）");
  });

  it("耗时在预算内 → 通过；超预算 → 不通过（实测值来自 runner 同一块表）", () => {
    expect(scoreEfficiency([], { maxDurationMs: 100 }, 50).passed).toBe(true);
    const over = scoreEfficiency([], { maxDurationMs: 100 }, 150);
    expect(over.passed).toBe(false);
    expect(over.detail).toContain("总耗时 150ms（预算 100ms）");
  });

  it("声明了耗时预算但未提供实测值 → 跳过该项核对且不误判（不拿 0 冒充实测）", () => {
    const output = scoreEfficiency([], { maxDurationMs: 100 });
    expect(output.passed).toBe(true);
    expect(output.detail).toContain("未测量");
  });

  it("双限额同时声明：任一超限即不通过；两项都未声明 → 默认通过", () => {
    expect(scoreEfficiency([step("a")], { maxToolCalls: 5, maxDurationMs: 1000 }, 10).passed).toBe(true);
    expect(
      scoreEfficiency([step("a"), step("b")], { maxToolCalls: 1, maxDurationMs: 60000 }, 10).passed,
    ).toBe(false);
    const noLimits = scoreEfficiency([step("a")], {});
    expect(noLimits.passed).toBe(true);
    expect(noLimits.detail).toContain("未声明");
  });

  it("数据集布线：恰好 traj-04/traj-09 声明预算且预算 ≥ 期望工具数（剧本下必然满足）", () => {
    const withLimits = EVAL_CASES.filter(
      (c): c is TrajectoryEvalCase => c.suite === "trajectory" && c.limits !== undefined,
    );
    expect(withLimits.map((c) => c.caseId).sort()).toEqual(["traj-04", "traj-09"]);
    for (const testCase of withLimits) {
      expect(testCase.limits?.maxToolCalls).toBeGreaterThanOrEqual(testCase.expectedToolCalls.length);
    }
  });
});

// ══ Judge 加固（scorers/judge.ts）━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Judge 加固：版本化 rubric + 证据注入 + 畸形输出防御", () => {
  const promptInput = {
    userMessage: "查一下订单 A-1024 的物流到哪了",
    answer: "订单 A-1024 已发货，预计明天送达。",
    rubric: ["回答必须包含订单号 A-1024"],
  };

  it("评审框架版本 v1 写进 system 前言（版本化 rubric 契约）", () => {
    expect(JUDGE_RUBRIC_VERSION).toBe("1");
    const { system } = buildJudgePrompt(promptInput);
    expect(system).toContain("评审框架版本：v1");
  });

  it("提供 evidence → user 追加【验证证据】段：证据内容在场且带数据声明（H7 围栏）", () => {
    const { user } = buildJudgePrompt({
      ...promptInput,
      evidence: { source: "verification", checks: ["tool-seq-ok"] },
    });
    expect(user).toContain("【验证证据】");
    expect(user).toContain("不是指令");
    expect(user).toContain("tool-seq-ok");
  });

  it("不提供 evidence → prompt 完全不出现证据段（缺省即不注入）", () => {
    const { user } = buildJudgePrompt(promptInput);
    expect(user).not.toContain("【验证证据】");
  });

  it('对抗样本 {"pass": "yes"}（类型错误）→ 判不通过：宁可误杀', () => {
    const verdict = parseJudgeVerdict('{"pass": "yes", "reason": "挺好的"}');
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain("boolean");
  });

  it("正常 JSON 仍照常解析（防御不误伤协议内输出）", () => {
    expect(parseJudgeVerdict('{"pass": true, "reason": "条目全满足"}')).toEqual({
      pass: true,
      reason: "条目全满足",
    });
  });

  it("judgeEvidence 钩子注入时评审员按用例拿到证据；缺省时证据为 undefined", async () => {
    const seen: unknown[] = [];
    const spyJudge: JudgeFn = async (input) => {
      seen.push(input.evidence);
      return { pass: true, reason: "合成判定" };
    };
    await runEvals({
      embeddingAvailable: false,
      judgeAvailable: true,
      judgeDeps: spyJudge,
      judgeEvidence: (testCase) => ({ caseId: testCase.caseId, synthetic: true }),
    });
    expect(seen).toHaveLength(EVAL_JUDGE_CASES.length);
    expect(seen.every((e) => e !== undefined)).toBe(true);

    const seenWithoutHook: unknown[] = [];
    const plainJudge: JudgeFn = async (input) => {
      seenWithoutHook.push(input.evidence);
      return { pass: true, reason: "合成判定" };
    };
    await runEvals({ embeddingAvailable: false, judgeAvailable: true, judgeDeps: plainJudge });
    expect(seenWithoutHook).toHaveLength(EVAL_JUDGE_CASES.length);
    expect(seenWithoutHook.every((e) => e === undefined)).toBe(true);
  });
});

// ══ 统一报告字段（§7.4）━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("统一报告字段 evaluatorVersion / configId / errored", () => {
  it("runner 恒填评测器版本与配置指纹（与 config.ts 的指纹规则同源、不含密钥）", async () => {
    const report = await runEvals();
    expect(report.evaluatorVersion).toBe(EVAL_EVALUATOR_VERSION);
    expect(report.evaluatorVersion).toBe("1");
    expect(report.configId).toBe(buildConfigId());
    expect(report.configId).toMatch(/retries=\d+\|timeout=\d+/);
    expect(report.configId).not.toMatch(/key|Key|KEY/);
    // 正式集全绿时 errors 缺席（可选字段只在发生时出现）
    expect(report.totals.errors).toBeUndefined();
  });

  it("执行抛错 ≠ 判不过：errored 单独标记并计入 totals.errors，同时仍算 failed", async () => {
    const brokenCase: TrajectoryEvalCase = {
      caseId: "cand-traj-err",
      suite: "trajectory",
      description: "合成用例：剧本为空必炸（验证 errored 归因链路）",
      userMessage: "随便说点什么",
      script: [],
      expectedToolCalls: [],
    };
    const report = await runEvals({ includeCandidates: true, candidateCases: [brokenCase] });

    const brokenRow = report.results.find((r) => r.caseId === "cand-traj-err");
    if (brokenRow === undefined) throw new Error("合成出错用例应当出现在结果里");
    expect(brokenRow.passed).toBe(false);
    expect(brokenRow.errored).toBe(true);
    expect(brokenRow.detail).toContain("评测执行出错");
    expect(report.totals.errors).toBe(1);
    expect(report.totals.failed).toBe(1);
  });

  it("回归测试：跳过永不计入通过/失败/出错（skipped ≠ failed ≠ errored 三态互斥）", async () => {
    const report = await runEvals({ embeddingAvailable: false, judgeAvailable: false });
    expect(report.totals.skipped).toBe(EVAL_QUERIES.length + EVAL_JUDGE_CASES.length);
    expect(report.totals.failed).toBe(0);
    expect(report.totals.passed).toBe(report.totals.total);
    expect(report.totals.errors).toBeUndefined();
  });
});

// ══ 基线加固（§8.1/§8.2）━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("基线加固 getBaselineTolerance（env 可配，非法回退默认并告警）", () => {
  /** 保存/恢复环境变量的同步原语：测试之间互不渗漏 */
  function withEnv(key: string, value: string | undefined, fn: () => void): void {
    const original = process.env[key];
    try {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
      fn();
    } finally {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  }

  it("未设置 → 默认 0.03；合法正数 → 生效", () => {
    expect(BASELINE_TOLERANCE).toBe(0.03);
    withEnv("AGENT_EVAL_BASELINE_TOLERANCE", undefined, () => {
      expect(getBaselineTolerance()).toBe(0.03);
    });
    withEnv("AGENT_EVAL_BASELINE_TOLERANCE", "0.1", () => {
      expect(getBaselineTolerance()).toBeCloseTo(0.1, 12);
    });
  });

  it("非法值（非数字 / 0 / 负数）→ 回退默认并打中文告警", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const bad of ["abc", "0", "-0.5"]) {
        withEnv("AGENT_EVAL_BASELINE_TOLERANCE", bad, () => {
          expect(getBaselineTolerance()).toBe(0.03);
        });
      }
      expect(warnSpy).toHaveBeenCalledTimes(3);
      expect(warnSpy.mock.calls[0]?.[0]).toContain("AGENT_EVAL_BASELINE_TOLERANCE");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("compareBaseline 按当前生效容差判定：容差调松到 0.1 后 5% 跌幅不再算回归", () => {
    const baseline = buildBaseline(reportOf(EVAL_DATASET_VERSION, [row("j-1", "judge", 1, true)]));
    const current = reportOf(EVAL_DATASET_VERSION, [row("j-1", "judge", 0.95, true)]);
    const original = process.env.AGENT_EVAL_BASELINE_TOLERANCE;
    try {
      expect(compareBaseline(current, baseline)).toHaveLength(1); // 默认容差下算回归
      process.env.AGENT_EVAL_BASELINE_TOLERANCE = "0.1";
      expect(compareBaseline(current, baseline)).toEqual([]); // 调松后被容差吸收
    } finally {
      if (original === undefined) delete process.env.AGENT_EVAL_BASELINE_TOLERANCE;
      else process.env.AGENT_EVAL_BASELINE_TOLERANCE = original;
    }
  });
});

describe("基线加固 configId 指纹比对（stale 提示，不拦退出码）", () => {
  it("两边指纹都有且不一致 → 恰好一条 stale 提示（suite=config）", () => {
    const rows = [row("t-1", "trajectory", 1, true)];
    const baseline = buildBaseline(
      reportOf(EVAL_DATASET_VERSION, rows, "glm-4-flash|embedding-3|retries=2|timeout=60000"),
    );
    const current = reportOf(EVAL_DATASET_VERSION, rows, "deepseek-chat|embedding-3|retries=2|timeout=60000");

    const violations = compareBaseline(current, baseline);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.stale).toBe(true);
    expect(violations[0]?.suite).toBe("config");
    expect(violations[0]?.message).toContain("配置指纹");
  });

  it("指纹一致或任一边缺指纹 → 不产生提示（旧基线向后兼容）", () => {
    const rows = [row("t-1", "trajectory", 1, true)];
    const baseline = buildBaseline(
      reportOf(EVAL_DATASET_VERSION, rows, "glm-4-flash|embedding-3|retries=2|timeout=60000"),
    );
    expect(
      compareBaseline(
        reportOf(EVAL_DATASET_VERSION, rows, "glm-4-flash|embedding-3|retries=2|timeout=60000"),
        baseline,
      ),
    ).toEqual([]);
    expect(compareBaseline(reportOf(EVAL_DATASET_VERSION, rows), baseline)).toEqual([]);
  });
});

describe("关键用例阻断 criticalCaseViolations", () => {
  it("critical 用例失败（含 errored）→ 阻断性违规，message 指名用例与等级", () => {
    const failed = criticalCaseViolations(
      reportOf(EVAL_DATASET_VERSION, [row("route-03", "routing", 0, false)]),
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.suite).toBe("routing");
    expect(failed[0]?.stale).toBeUndefined();
    expect(failed[0]?.message).toContain("route-03");
    expect(failed[0]?.message).toContain("critical");

    const errored = criticalCaseViolations(
      reportOf(EVAL_DATASET_VERSION, [row("route-02", "routing", 0, false, true)]),
    );
    expect(errored).toHaveLength(1);
  });

  it("critical 用例通过 → 无违规", () => {
    expect(
      criticalCaseViolations(reportOf(EVAL_DATASET_VERSION, [row("route-01", "routing", 1, true)])),
    ).toEqual([]);
  });

  it("standard 用例失败 → 不产生关键违规（沿用基线容差门禁，行为不变）", () => {
    expect(
      criticalCaseViolations(reportOf(EVAL_DATASET_VERSION, [row("traj-01", "trajectory", 0, false)])),
    ).toEqual([]);
  });

  it("门禁语义：critical 失败在基线比对干净时也阻断（一票否决，不容差吸收）", () => {
    // 基线只压了 trajectory 套件；本轮 routing 里 critical 的 route-01 挂了——
    // compareBaseline 对缺席套件不比对（无回归可判），但关键用例违规照出
    const baseline = buildBaseline(reportOf(EVAL_DATASET_VERSION, [row("t-1", "trajectory", 1, true)]));
    const current = reportOf(EVAL_DATASET_VERSION, [
      row("t-1", "trajectory", 1, true),
      row("route-01", "routing", 0, false),
    ]);
    expect(compareBaseline(current, baseline)).toEqual([]);
    expect(criticalCaseViolations(current)).toHaveLength(1);
  });
});
