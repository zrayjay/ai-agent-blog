// experiments.spec.ts —— 实验台账与结果比较（Phase 5，PRD §11）单测。
// 全程离线：runEvals 显式关掉 key 门控套件（{ embeddingAvailable:false, judgeAvailable:false }，
// Tier 1 约 40ms/轮）；台账/候选区一律注入临时目录路径，不碰真实 .data。
// 断言口径：预算超限明确停止（stopReason）；n<2 无区间；坏行容错绝不 crash。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXPERIMENT_MAX_RUNS_BUDGET,
  compareReports,
  computeExperimentStats,
  ExperimentLedger,
  runExperimentRepeats,
} from "../src/evals/index.js";
import type { EvalReport, EvalResult, EvalSuiteName, TrajectoryEvalCase } from "../src/evals/types.js";

const OFFLINE_RUN_OPTIONS = { embeddingAvailable: false, judgeAvailable: false } as const;

/** 每个用例独享一个临时目录（台账/候选区文件互不串扰），跑完清理 */
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "phase5-experiments-"));
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 合成单用例结果（compareReports 的原料：passed 与 score 同步） */
function result(caseId: string, suite: EvalSuiteName, passed: boolean): EvalResult {
  return {
    caseId,
    suite,
    passed,
    score: passed ? 1 : 0,
    detail: passed ? "通过" : "期望与实际不符",
    durationMs: 5,
  };
}

/** 合成报告：给 compareReports 提供 A/B 两侧 */
function syntheticReport(results: EvalResult[]): EvalReport {
  return {
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
}

/** 合成失败轨迹用例：期望空序列但剧本调了 search_orders → 必然 FAIL（走真实判分管线） */
const syntheticFailingCase: TrajectoryEvalCase = {
  caseId: "synth-fail-01",
  suite: "trajectory",
  description: "合成失败用例：期望空工具序列，剧本却调了工具",
  userMessage: "帮我找找订单 6688",
  script: [
    { kind: "tool-calls", calls: [{ toolName: "search_orders", input: { keyword: "6688" } }] },
    { kind: "text", text: "已为您查询到相关订单。" },
  ],
  expectedToolCalls: [],
};

describe("runExperimentRepeats · 重复运行与预算闸", () => {
  it("repeat=3：3 轮全部留档，stopReason=completed，统计在值域内（离线 Tier 1）", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const ledgerPath = join(dir, "experiments.jsonl");

    const record = await runExperimentRepeats({
      repeat: 3,
      ledgerPath,
      runOptions: OFFLINE_RUN_OPTIONS,
    });

    expect(record.runs.length).toBe(3);
    expect(record.stopReason).toBe("completed");
    expect(record.runs.map((r) => r.runIndex)).toEqual([1, 2, 3]);
    for (const run of record.runs) {
      expect(run.configId).toBeTypeOf("string");
      expect(run.configId.length).toBeGreaterThan(0);
      expect(run.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    expect(record.datasetVersion).toBe("3");
    expect(record.evaluatorVersion).toBe("1");
    expect(record.stats.passRateMean).toBeGreaterThanOrEqual(0);
    expect(record.stats.passRateMean).toBeLessThanOrEqual(1);
    // 真实离线轮的单例耗时可能测得 0ms（Tier 1 纯函数太快），只断言非负与单调
    expect(record.stats.latencyP50Ms).toBeGreaterThanOrEqual(0);
    expect(record.stats.latencyP95Ms).toBeGreaterThanOrEqual(record.stats.latencyP50Ms);
  });

  it("预算闸：repeat=8 > maxRuns=5 → 正好 5 轮 + stopReason=budget-exhausted:maxRuns（§11.3）", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);

    const record = await runExperimentRepeats({
      repeat: 8,
      maxRuns: 5,
      ledgerPath: join(dir, "experiments.jsonl"),
      runOptions: OFFLINE_RUN_OPTIONS,
    });

    expect(EXPERIMENT_MAX_RUNS_BUDGET).toBe(5);
    expect(record.runs.length).toBe(5);
    expect(record.stopReason).toBe("budget-exhausted:maxRuns");
  });

  it("置信区间：n=1 无区间无标准差；n=3 有区间且 lo ≤ mean ≤ hi（随机性任务不凭单次下结论）", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);

    const single = await runExperimentRepeats({
      repeat: 1,
      ledgerPath: join(dir, "single.jsonl"),
      runOptions: OFFLINE_RUN_OPTIONS,
    });
    expect(single.stats.passRateCi95).toBeUndefined();
    expect(single.stats.passRateStddev).toBeUndefined();

    const triple = await runExperimentRepeats({
      repeat: 3,
      ledgerPath: join(dir, "triple.jsonl"),
      runOptions: OFFLINE_RUN_OPTIONS,
    });
    expect(triple.stats.passRateCi95).toBeDefined();
    expect(triple.stats.passRateStddev).toBeDefined();
    const [lo, hi] = triple.stats.passRateCi95 as [number, number];
    expect(lo).toBeLessThanOrEqual(triple.stats.passRateMean);
    expect(hi).toBeGreaterThanOrEqual(triple.stats.passRateMean);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
  });

  it("失败归因：合成失败候选用例（includeCandidates）计入 failureClassification 且逐轮累计", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);

    const record = await runExperimentRepeats({
      repeat: 2,
      ledgerPath: join(dir, "experiments.jsonl"),
      runOptions: {
        ...OFFLINE_RUN_OPTIONS,
        includeCandidates: true,
        candidateCases: [syntheticFailingCase],
      },
    });

    // Tier 1 正式集离线全绿（0 失败），唯一失败来源就是合成的候选用例
    expect(record.stats.failureClassification["synth-fail-01"]).toBe(2);
    expect(Object.keys(record.stats.failureClassification)).toEqual(["synth-fail-01"]);
  });
});

describe("ExperimentLedger · JSONL 台账（容错 + 隔离）", () => {
  it("round-trip：appendExperiment → listExperiments → loadExperiment 原样取回", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const ledger = new ExperimentLedger(join(dir, "experiments.jsonl"));

    const record = {
      experimentId: "exp-rt-1",
      startedAt: "2026-10-26T00:00:00.000Z",
      finishedAt: "2026-10-26T00:00:01.000Z",
      stopReason: "completed" as const,
      configId: "glm-4-flash|embedding-3|retries=2|timeout=60000",
      datasetVersion: "3",
      evaluatorVersion: "1",
      runs: [],
      stats: {
        passRateMean: 1,
        failureClassification: {},
        latencyP50Ms: 1,
        latencyP95Ms: 1,
      },
    };
    ledger.appendExperiment(record);

    const listed = ledger.listExperiments();
    expect(listed.length).toBe(1);
    expect(listed[0]?.experimentId).toBe("exp-rt-1");
    expect(ledger.loadExperiment("exp-rt-1")?.stopReason).toBe("completed");
    expect(ledger.loadExperiment("no-such-id")).toBeUndefined();
  });

  it("容错解析：坏行跳过 + warn，合法行照常返回（append-only 单行损坏不连坐）", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const ledgerPath = join(dir, "experiments.jsonl");
    const validLine =
      '{"experimentId":"exp-ok","startedAt":"t","finishedAt":"t","stopReason":"completed",' +
      '"configId":"c","datasetVersion":"3","evaluatorVersion":"1","runs":[],' +
      '"stats":{"passRateMean":1,"failureClassification":{},"latencyP50Ms":1,"latencyP95Ms":1}}';
    writeFileSync(ledgerPath, `${validLine}\n{这行不是JSON\n\n"裸字符串也不是对象"\n{"缺id":true}\n`, "utf8");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const listed = new ExperimentLedger(ledgerPath).listExperiments();
      expect(listed.length).toBe(1);
      expect(listed[0]?.experimentId).toBe("exp-ok");
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("写失败不炸评测：ledgerPath 指向目录（EISDIR）→ warn 且 appendExperiment 不抛", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const dirAsLedgerPath = join(dir, "not-a-file");
    mkdirSync(dirAsLedgerPath, { recursive: true });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const record = await runExperimentRepeats({
        repeat: 1,
        ledgerPath: dirAsLedgerPath,
        runOptions: OFFLINE_RUN_OPTIONS,
      });
      // 台账写挂只留警告：内存记录照常返回（留档是增强，不是评测本体）
      expect(record.runs.length).toBe(1);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("computeExperimentStats · 跨轮统计纯函数", () => {
  it("nearest-rank P50/P95 与失败计数对合成数据逐点断言", () => {
    // 20 个耗时样本：P50=第 10 名=100，P95=第 19 名=950（nearest-rank）
    const durations = Array.from({ length: 20 }, (_, i) => (i + 1) * 50);
    const runResults = durations.map((durationMs, i) => [
      {
        caseId: `case-${i % 3}`,
        suite: "trajectory" as const,
        passed: i % 3 !== 0,
        score: i % 3 !== 0 ? 1 : 0,
        detail: "d",
        durationMs,
      },
    ]);
    const stats = computeExperimentStats(runResults);
    expect(stats.latencyP50Ms).toBe(500);
    expect(stats.latencyP95Ms).toBe(950);
    // 失败的是 i%3===0 的样本（i=0,3,6,9,12,15,18）→ case-0 失败 7 次
    expect(stats.failureClassification).toEqual({ "case-0": 7 });
  });
});

describe("compareReports · 报告比较（A=基准，B=对照）", () => {
  it("套件级行 + 用例级翻转：一条新增失败、一条新增通过各归其位", () => {
    const reportA = syntheticReport([
      result("traj-a", "trajectory", true),
      result("traj-b", "trajectory", false),
      result("route-a", "routing", true),
    ]);
    const reportB = syntheticReport([
      result("traj-a", "trajectory", false),
      result("traj-b", "trajectory", true),
      result("route-a", "routing", true),
    ]);

    const comparison = compareReports(reportA, reportB);
    const trajectoryRow = comparison.suites.find((row) => row.suite === "trajectory");
    expect(trajectoryRow).toBeDefined();
    expect(trajectoryRow?.passedA).toBe(1);
    expect(trajectoryRow?.passedB).toBe(1);
    expect(trajectoryRow?.totalA).toBe(2);
    expect(trajectoryRow?.totalB).toBe(2);
    expect(trajectoryRow?.avgScoreA).toBeCloseTo(0.5);
    expect(trajectoryRow?.avgScoreB).toBeCloseTo(0.5);
    expect(trajectoryRow?.delta).toBeCloseTo(0);

    expect(comparison.newlyFailing).toEqual(["traj-a"]);
    expect(comparison.newlyPassing).toEqual(["traj-b"]);
  });

  it("delta 反映 avg score 变化；单侧缺席的用例不判翻转", () => {
    const reportA = syntheticReport([
      result("traj-a", "trajectory", true),
      result("traj-b", "trajectory", true),
    ]);
    const reportB = syntheticReport([
      result("traj-a", "trajectory", true),
      result("traj-c", "trajectory", false), // B 新增的用例：不判翻转
    ]);

    const comparison = compareReports(reportA, reportB);
    expect(comparison.newlyFailing).toEqual([]);
    expect(comparison.newlyPassing).toEqual([]);
    const row = comparison.suites.find((r) => r.suite === "trajectory");
    expect(row?.delta).toBeCloseTo(-0.5); // avg 1.0 → 0.5
  });
});
