// evals/failure-cases.ts —— 失败案例候选区与人工审核流（Phase 5，PRD §13）
//
// ── 候选区是什么：评测失败 → 人审 → 人决定是否入正式集 ────────────────────
// 评测跑出来的失败用例是「改进的原料」：可能是数据集缺的边界场景、可能是
// 引擎真 bug。但**未经审核的失败数据绝不进正式数据集**（§13.3 铁律）——
// 坏题目进了考卷，之后每一轮门禁都在为它买单。因此本模块把失败案例导出成
// 「候选记录」（candidate），走 JSONL 候选区留档；Agent 代码**只写候选区**，
// dataset.ts / baseline.ts / quality-gate.ts 三个门禁对象对 Agent 代码只读——
// 转正（把候选题目手工写进 dataset.ts 并登记 governance）是**人的动作**，
// 不存在任何自动晋升代码路径（评审通过的候选也要人手工改 dataset.ts）。
//
// ── candidateId 为什么是内容哈希 ─────────────────────────────────────────
// sha256(caseId|configId|normalizedDetail) 取前 16 位十六进制：同一用例在同一
// 配置下反复失败（detail 语义相同）→ 同一个 candidateId → 重复导出天然去重；
// 已审核（approved/rejected）的候选也因 id 相同而不会被再次导出成 pending——
// 去重即审核状态的防火墙。detail 参与哈希前先 PII 脱敏 + 空白归一：候选区
// 是落盘文件，脱敏必须在写入前完成（与 telemetry/redact.ts 的 sink 出口
// 同一取向：离开进程边界的数据先脱敏）。
//
// ── JSONL 与容错 ─────────────────────────────────────────────────────────
// 候选区与实验台账（experiments.ts）同款 append-only JSONL：坏行跳过 + warn
// 绝不 crash；reviewCandidate 用「整文件重写、保持行序」实现状态更新——
// 候选量级是人工审核量级（几十条），重写的简单性远比流式改写的精巧可靠。
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { maskPii } from "../guardrails/pii-mask.js";
import type { EvalReport } from "./types.js";

/** 默认候选区路径：agent-app/.data/failure-candidates.jsonl（.data 已 gitignore） */
export const DEFAULT_FAILURE_CANDIDATES_PATH = join(process.cwd(), ".data", "failure-candidates.jsonl");

/**
 * 一条失败案例候选记录。
 * reviewStatus 是自由文本：pending-review = 待审；approved/rejected 后缀带
 * 「审核人 + 时间」（`approved (by 张三 at 2026-…)`）——审核留痕直接长在
 * 状态字段里，人工扫读台账时一眼看到谁在何时裁的决。
 */
export interface FailureCandidate {
  candidateId: string;
  caseId: string;
  suite: string;
  /** 失败详情（已 PII 脱敏——候选区是落盘文件，写入前必须完成脱敏） */
  detail: string;
  /** 产生该失败时的配置指纹（报告未带 configId 时缺省） */
  configId?: string;
  datasetVersion: string;
  evaluatorVersion?: string;
  capturedAt: string;
  status: "candidate";
  reviewStatus: string;
  source: "eval-run";
}

/** exportFailureCases 的选项（filePath 可注入供单测写临时目录） */
export interface FailureExportOptions {
  /** 候选区落盘路径（缺省 .data/failure-candidates.jsonl） */
  filePath?: string;
}

/** 导出结果计数：added = 新写入条数，skipped = 因 candidateId 已存在而跳过条数 */
export interface FailureExportCounts {
  added: number;
  skipped: number;
}

/** 审核决定：approved = 通过（人手工转正），rejected = 驳回（留在候选区存档） */
export interface FailureReviewDecision {
  decision: "approved" | "rejected";
  /** 审核人（必填）：候选区没有匿名的门禁 */
  reviewer: string;
}

/** 从失败详情生成去重键：PII 脱敏 → 空白归一 → sha256 前 16 位（口径见头注释） */
function buildCandidateId(caseId: string, configId: string | undefined, detail: string): string {
  const masked = maskPii(detail);
  const normalized = masked.replace(/\s+/g, " ").trim();
  const raw = `${caseId}|${configId ?? "-"}|${normalized}`;
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 16);
}

/** 容错读候选区：坏行跳过 + warn（与 ExperimentLedger.listExperiments 同一口径） */
function readCandidates(filePath: string): FailureCandidate[] {
  if (!existsSync(filePath)) return [];
  const candidates: FailureCandidate[] = [];
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      console.warn(`[候选区] 第 ${index + 1} 行不是合法 JSON，已跳过（其余行照常读取）。`);
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      console.warn(`[候选区] 第 ${index + 1} 行不是对象，已跳过。`);
      continue;
    }
    const candidateId: unknown = Reflect.get(parsed, "candidateId");
    if (typeof candidateId !== "string") {
      console.warn(`[候选区] 第 ${index + 1} 行缺 candidateId 字段，已跳过。`);
      continue;
    }
    candidates.push(parsed as FailureCandidate);
  }
  return candidates;
}

/**
 * 从一轮评测报告导出失败案例到候选区（追加写 JSONL）：
 * - 失败判定 = passed===false（含 errored——执行出错的用例同样是改进原料）；
 * - detail 先 maskPii 再落盘；candidateId 内容哈希去重：
 *   已存在（无论 pending/approved/rejected）的 candidateId 跳过不重写；
 * - 只写候选区文件：dataset.ts / 基线 / 门禁对 Agent 代码只读（§13.3，头注释）。
 */
export function exportFailureCases(
  report: EvalReport,
  options: FailureExportOptions = {},
): FailureExportCounts {
  const filePath = options.filePath ?? DEFAULT_FAILURE_CANDIDATES_PATH;
  const existing = new Set(readCandidates(filePath).map((candidate) => candidate.candidateId));

  const failures = report.results.filter((result) => !result.passed);
  const counts: FailureExportCounts = { added: 0, skipped: 0 };
  const newLines: string[] = [];

  for (const failure of failures) {
    const detail = maskPii(failure.detail);
    const candidateId = buildCandidateId(failure.caseId, report.configId, failure.detail);
    if (existing.has(candidateId)) {
      counts.skipped += 1;
      continue;
    }
    const candidate: FailureCandidate = {
      candidateId,
      caseId: failure.caseId,
      suite: failure.suite,
      detail,
      datasetVersion: report.datasetVersion,
      capturedAt: new Date().toISOString(),
      status: "candidate",
      reviewStatus: "pending-review",
      source: "eval-run",
    };
    if (report.configId !== undefined) candidate.configId = report.configId;
    if (report.evaluatorVersion !== undefined) candidate.evaluatorVersion = report.evaluatorVersion;
    newLines.push(JSON.stringify(candidate));
    existing.add(candidateId); // 同一轮报告里的重复失败同样去重
    counts.added += 1;
  }

  if (newLines.length > 0) {
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${newLines.join("\n")}\n`, "utf8");
  }
  return counts;
}

/** 列出全部候选（容错解析，坏行跳过） */
export function listFailureCandidates(
  filePath: string = DEFAULT_FAILURE_CANDIDATES_PATH,
): FailureCandidate[] {
  return readCandidates(filePath);
}

/**
 * 审核一条候选：整文件重写、保持行序，把目标行的 reviewStatus 改成
 * `approved (by <审核人> at <ISO>)` / `rejected (by <审核人> at <ISO>)`。
 * - 审核人必填（空白 = 拒绝执行）：没有署名的审核没有问责对象；
 * - candidateId 不存在 → 抛中文错误（宁可当场报错，不可静默假成功）；
 * - **转正不在本函数**：通过 ≠ 进正式集——把候选题目手工写进 dataset.ts
 *   并登记 governance 是人的动作（§13.3，头注释）。
 */
export function reviewCandidate(
  candidateId: string,
  decision: FailureReviewDecision,
  filePath: string = DEFAULT_FAILURE_CANDIDATES_PATH,
): void {
  const reviewer = decision.reviewer.trim();
  if (reviewer === "") {
    throw new Error("审核人不能为空：请通过 --reviewer 提供署名（候选区没有匿名的门禁）。");
  }

  const lines = existsSync(filePath) ? readFileSync(filePath, "utf8").split(/\r?\n/) : [];
  const kept: string[] = [];
  let found = false;
  for (const line of lines) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      kept.push(line); // 坏行原样保留：重写不销毁证据，list 时另有 warn
      continue;
    }
    const lineCandidateId =
      typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "candidateId") : undefined;
    if (lineCandidateId !== candidateId) {
      kept.push(line);
      continue;
    }
    found = true;
    if (typeof parsed !== "object" || parsed === null) continue;
    const candidate = parsed as FailureCandidate;
    candidate.reviewStatus = `${decision.decision} (by ${reviewer} at ${new Date().toISOString()})`;
    kept.push(JSON.stringify(candidate));
  }

  if (!found) {
    throw new Error(
      `候选 ${candidateId} 不存在（${filePath}）：请先执行 pnpm eval --list-failures 核对候选 id。`,
    );
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${kept.join("\n")}\n`, "utf8");
}
