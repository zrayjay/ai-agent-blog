// failure-cases.spec.ts —— 失败案例候选区与人工审核流（Phase 5，PRD §13）单测。
// 全程离线：合成报告直接喂 exportFailureCases；候选区文件注入临时目录，
// 不碰真实 .data。断言口径：PII 写入前脱敏；内容哈希去重（approved/rejected
// 不被重导出）；正式集与治理登记对 Agent 代码只读（§13.3 formal-set isolation）。
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EVAL_CASES,
  EVAL_JUDGE_CASES,
  EVAL_DATASET_VERSION,
  exportFailureCases,
  listAllFormalCaseIds,
  listCriticalCaseIds,
  listFailureCandidates,
  reviewCandidate,
} from "../src/evals/index.js";
import type { EvalReport, EvalResult } from "../src/evals/types.js";

/** 每个用例独享一个临时目录，跑完清理 */
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "phase5-failures-"));
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 合成单用例结果 */
function result(caseId: string, passed: boolean, detail: string): EvalResult {
  return {
    caseId,
    suite: "trajectory",
    passed,
    score: passed ? 1 : 0,
    detail,
    durationMs: 1,
  };
}

/** 合成报告：一条通过 + 一条带 PII 的失败（导出断言的主原料） */
function syntheticReportWithPiiFailure(): EvalReport {
  const results = [
    result("traj-ok", true, "通过"),
    result("traj-leak", false, "用户手机号 13812345678 无法接通，期望转人工"),
  ];
  return {
    datasetVersion: EVAL_DATASET_VERSION,
    startedAt: "2026-10-26T00:00:00.000Z",
    durationMs: 1,
    totals: {
      total: results.length,
      passed: 1,
      failed: 1,
      skipped: 0,
    },
    results,
    skipped: [],
    evaluatorVersion: "1",
    configId: "glm-4-flash|embedding-3|retries=2|timeout=60000",
  };
}

describe("exportFailureCases · 导出与去重", () => {
  it("失败案例写入 JSONL：detail 已 PII 脱敏，通过用例不进候选区", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const filePath = join(dir, "failure-candidates.jsonl");

    const counts = exportFailureCases(syntheticReportWithPiiFailure(), { filePath });
    expect(counts).toEqual({ added: 1, skipped: 0 });

    const candidates = listFailureCandidates(filePath);
    expect(candidates.length).toBe(1);
    const candidate = candidates[0];
    expect(candidate?.caseId).toBe("traj-leak");
    expect(candidate?.status).toBe("candidate");
    expect(candidate?.reviewStatus).toBe("pending-review");
    expect(candidate?.source).toBe("eval-run");
    expect(candidate?.configId).toBe("glm-4-flash|embedding-3|retries=2|timeout=60000");
    // PII 在写入前脱敏：文件里只有掩码形态，完整号码绝不落盘
    expect(candidate?.detail).toContain("138****5678");
    expect(candidate?.detail).not.toContain("13812345678");
    const rawFile = readFileSync(filePath, "utf8");
    expect(rawFile).toContain("138****5678");
    expect(rawFile).not.toContain("13812345678");
  });

  it("candidateId 稳定：同一失败重复导出 → 去重跳过（added=0, skipped=1）", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const filePath = join(dir, "failure-candidates.jsonl");

    const first = exportFailureCases(syntheticReportWithPiiFailure(), { filePath });
    const second = exportFailureCases(syntheticReportWithPiiFailure(), { filePath });

    expect(first.added).toBe(1);
    expect(second).toEqual({ added: 0, skipped: 1 });
    expect(listFailureCandidates(filePath).length).toBe(1);
  });

  it("errored 用例同样导出（失败口径 = passed===false，与报告一致）", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const filePath = join(dir, "failure-candidates.jsonl");
    const report = syntheticReportWithPiiFailure();
    report.results.push({
      caseId: "traj-errored",
      suite: "trajectory",
      passed: false,
      score: 0,
      detail: "评测执行出错：script 未以 text 轮收尾",
      durationMs: 1,
      errored: true,
    });

    const counts = exportFailureCases(report, { filePath });
    expect(counts.added).toBe(2);
  });
});

describe("reviewCandidate · 人工审核流", () => {
  it("approve / reject 留痕持久化：reviewStatus 带审核人与时间，行序保持", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const filePath = join(dir, "failure-candidates.jsonl");
    // 两条候选（复用同一报告导出一次，再补第二条），保证重写时行序可断言
    const report = syntheticReportWithPiiFailure();
    report.results.push(result("traj-second", false, "第二条失败：期望空序列但调了工具"));
    exportFailureCases(report, { filePath });
    const before = listFailureCandidates(filePath);
    expect(before.length).toBe(2);
    const firstId = before[0]?.candidateId as string;
    const secondId = before[1]?.candidateId as string;

    reviewCandidate(firstId, { decision: "approved", reviewer: "张三" }, filePath);
    reviewCandidate(secondId, { decision: "rejected", reviewer: "李四" }, filePath);

    const after = listFailureCandidates(filePath);
    expect(after.map((c) => c.candidateId)).toEqual([firstId, secondId]); // 行序保持
    expect(after[0]?.reviewStatus).toMatch(/^approved \(by 张三 at \d{4}-\d{2}-\d{2}T/);
    expect(after[1]?.reviewStatus).toMatch(/^rejected \(by 李四 at \d{4}-\d{2}-\d{2}T/);
  });

  it("已审核（approved/rejected）的候选不被重导出成 pending：内容哈希去重即审核防火墙", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const filePath = join(dir, "failure-candidates.jsonl");
    const report = syntheticReportWithPiiFailure();

    exportFailureCases(report, { filePath });
    const candidate = listFailureCandidates(filePath)[0];
    reviewCandidate(candidate?.candidateId as string, { decision: "approved", reviewer: "张三" }, filePath);

    // 同一失败再次导出：candidateId 相同 → 跳过，不会把 approved 覆盖回 pending
    const counts = exportFailureCases(report, { filePath });
    expect(counts).toEqual({ added: 0, skipped: 1 });
    const after = listFailureCandidates(filePath);
    expect(after.length).toBe(1);
    expect(after[0]?.reviewStatus).toMatch(/^approved/);
  });

  it("审核人必填与候选不存在 → 中文错误（宁可当场报错，不可静默假成功）", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const filePath = join(dir, "failure-candidates.jsonl");
    exportFailureCases(syntheticReportWithPiiFailure(), { filePath });
    const candidate = listFailureCandidates(filePath)[0];

    expect(() =>
      reviewCandidate(candidate?.candidateId as string, { decision: "approved", reviewer: "   " }, filePath),
    ).toThrow(/审核人不能为空/);
    expect(() => reviewCandidate("no-such-id", { decision: "approved", reviewer: "张三" }, filePath)).toThrow(
      /不存在/,
    );
  });
});

describe("正式集隔离（§13.3）：候选区操作不碰 dataset / governance", () => {
  it("导出与审核后，EVAL_CASES/EVAL_JUDGE_CASES 数量与治理登记原样（Agent 代码无写路径）", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const filePath = join(dir, "failure-candidates.jsonl");

    exportFailureCases(syntheticReportWithPiiFailure(), { filePath });
    const candidate = listFailureCandidates(filePath)[0];
    reviewCandidate(candidate?.candidateId as string, { decision: "approved", reviewer: "张三" }, filePath);

    // 正式集快照：轨迹/路由 18 条 + 评审 8 条，关键用例名单 8 条（与 dataset v3 一致）
    expect(EVAL_CASES.length).toBe(18);
    expect(EVAL_JUDGE_CASES.length).toBe(8);
    expect(listAllFormalCaseIds().length).toBe(76);
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
    // 候选区只写自己的文件：正式数据集是 TS 源码（git 管理），本模块从未 import 写入面
    expect(filePath).toContain("failure-candidates.jsonl");
  });
});
