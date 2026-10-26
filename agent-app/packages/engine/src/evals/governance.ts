// governance.ts —— 数据集治理（Phase 3 §7.1）：给每条用例挂「风险等级 / 评测维度 /
// 评审状态 / 来源」元数据，让回归门禁能按风险分级（关键用例失败 = 阻断，普通用例
// 回归仍走基线容差），并给候选区机制提供口径。
//
// ── 为什么元数据独立成文件而不是塞进 dataset.ts ──────────────────────────
// dataset.ts 是「考卷」（题目与标准答案），governance.ts 是「考纲」（每道题多重要、
// 考哪个维度、过没过审）。分开后：改元数据不动题目、改题目不丢元数据；关键用例
// 名单（listCriticalCaseIds）有单一事实来源，baseline.ts / CLI 都从这里取。
//
// ── 维度全景与 Phase 4 缓建声明 ──────────────────────────────────────────
// EvalDimension 联合是全集口径：correctness | tool-usage | trajectory | retrieval |
// safety | reliability | efficiency。Phase 3 只落地了确定性可离线的部分——轨迹（既有
// scoreTrajectory）、路由（scoreRouting）、检索（scoreRetrieval）、评审（scoreJudge）、
// 效率（scorers/efficiency.ts）；**safety 与 reliability 两个维度 Phase 3 只在治理层
// 「声明」，不落地打分器**：安全红队套件与故障注入套件按计划归 Phase 4（安全护栏 /
// fault-injection 落地时一起建，避免先造假打分器凑数）。在维度里出现 safety 的用例，
// 其 safety 属性 Phase 3 由确定性断言间接守护（如路由 critical 用例断言「必须转人工」）。
//
// ── 默认值哲学 ──────────────────────────────────────────────────────────
// 未登记的 caseId 一律按 { standard / correctness / reviewed / golden-dataset-v3 } 处理：
// 治理是「例外登记制」而非「全员注册制」——50 条检索用例没必要逐条抄写默认值，
// 漏登一条也不会静默降级（默认值本身就是安全取向：standard + correctness）。
import { EVAL_CASES, EVAL_JUDGE_CASES } from "./dataset.js";
import { EVAL_QUERIES } from "./corpus.js";

/** 数据集稳定标识：跨版本不变（版本由 EVAL_DATASET_VERSION 管，标识管「这是哪套考卷」） */
export const EVAL_DATASET_ID = "customer-service-golden";

/** 评测维度全集（文档化口径，Phase 3 治理层声明；safety/reliability 打分器缓建至 Phase 4） */
export type EvalDimension =
  "correctness" | "tool-usage" | "trajectory" | "retrieval" | "safety" | "reliability" | "efficiency";

/** 维度全集的运行时清单：治理完整性测试用它断言「登记的维度都是合法维度」 */
export const EVAL_DIMENSIONS: readonly EvalDimension[] = [
  "correctness",
  "tool-usage",
  "trajectory",
  "retrieval",
  "safety",
  "reliability",
  "efficiency",
];

/** 单条用例的治理元数据 */
export interface CaseGovernance {
  /** critical = 失败即阻断（criticalCaseViolations），standard = 只走基线容差门禁 */
  riskLevel: "critical" | "standard";
  /** 该用例考的维度（⊆ EVAL_DIMENSIONS） */
  dimensions: readonly EvalDimension[];
  /** reviewed = 已过审进正式集；candidate = 候选区（默认不跑，opt-in 才执行） */
  reviewStatus: "reviewed" | "candidate";
  /** 用例来源（审计线索：哪一版数据集、谁出的题） */
  source: string;
}

/** 未登记 caseId 的默认治理：standard + correctness + reviewed + v3 来源 */
const DEFAULT_GOVERNANCE: CaseGovernance = {
  riskLevel: "standard",
  dimensions: ["correctness"],
  reviewStatus: "reviewed",
  source: "golden-dataset-v3",
};

/**
 * 例外登记表：只登记「偏离默认值」的用例。
 * critical 名单的定级依据（为什么这 8 条失败必须阻断、不能被容差吸收）：
 * - route-01/02：用户明确要求转人工（「转人工」「换个人」）——该转不转是服务事故，
 *   用户诉求被机器人硬扛属于 safety 级失职；
 * - route-03：投诉关键词必须转人工——投诉升级处理是平台义务，漏接 = 舆情风险；
 * - route-04：律师起诉（法律高危）——高危白名单失守可能演变成法律纠纷；
 * - route-05：连续 2 轮未解决必须转人工——计数规则是「AI 原地打转」的最后保险丝；
 * - traj-05/06/07：闲聊/直答负例（期望空工具序列）——不该碰工具却碰了 = 过度行动，
 *   费时费钱还答非所问，这是数据集用负例守住的第一条底线。
 */
const GOVERNANCE_OVERRIDES: Record<string, CaseGovernance> = {
  "route-01": {
    riskLevel: "critical",
    dimensions: ["correctness", "safety"],
    reviewStatus: "reviewed",
    source: "golden-dataset-v3",
  },
  "route-02": {
    riskLevel: "critical",
    dimensions: ["correctness", "safety"],
    reviewStatus: "reviewed",
    source: "golden-dataset-v3",
  },
  "route-03": {
    riskLevel: "critical",
    dimensions: ["correctness", "safety"],
    reviewStatus: "reviewed",
    source: "golden-dataset-v3",
  },
  "route-04": {
    riskLevel: "critical",
    dimensions: ["correctness", "safety"],
    reviewStatus: "reviewed",
    source: "golden-dataset-v3",
  },
  "route-05": {
    riskLevel: "critical",
    dimensions: ["correctness", "safety"],
    reviewStatus: "reviewed",
    source: "golden-dataset-v3",
  },
  "traj-05": {
    riskLevel: "critical",
    dimensions: ["correctness", "tool-usage"],
    reviewStatus: "reviewed",
    source: "golden-dataset-v3",
  },
  "traj-06": {
    riskLevel: "critical",
    dimensions: ["correctness", "tool-usage"],
    reviewStatus: "reviewed",
    source: "golden-dataset-v3",
  },
  "traj-07": {
    riskLevel: "critical",
    dimensions: ["correctness", "tool-usage"],
    reviewStatus: "reviewed",
    source: "golden-dataset-v3",
  },
  // 效率维度声明（§7.2）：两条多步轨迹用例声明了 limits（见 dataset.ts），
  // runner 对它们叠加 efficiency 打分——维度登记跟着声明走
  "traj-04": {
    riskLevel: "standard",
    dimensions: ["correctness", "tool-usage", "efficiency"],
    reviewStatus: "reviewed",
    source: "golden-dataset-v3",
  },
  "traj-09": {
    riskLevel: "standard",
    dimensions: ["correctness", "tool-usage", "efficiency"],
    reviewStatus: "reviewed",
    source: "golden-dataset-v3",
  },
};

/**
 * 候选区（Phase 3 §7.1）：列在这里的 caseId 是「候选用例」——reviewStatus 强制为
 * candidate，且 runner 只在 includeCandidates=true 时执行（正式集 76 条才是门禁对象）。
 * 今天为空：候选用例还没有实体题目；机制由单测注入合成用例验证（不动正式集）。
 */
export const CANDIDATE_CASE_IDS: readonly string[] = [];

/** 查单条用例的治理元数据：例外表优先，未登记走默认；候选区名单强制改写评审状态 */
export function getCaseGovernance(caseId: string): CaseGovernance {
  const override = GOVERNANCE_OVERRIDES[caseId];
  const base = override ?? DEFAULT_GOVERNANCE;
  if ((CANDIDATE_CASE_IDS as readonly string[]).includes(caseId)) {
    return { ...base, reviewStatus: "candidate" };
  }
  return base;
}

/** 关键用例名单（排序去重）：回归门禁的「失败即阻断」清单 */
export function listCriticalCaseIds(): string[] {
  return Object.keys(GOVERNANCE_OVERRIDES)
    .filter((caseId) => GOVERNANCE_OVERRIDES[caseId]?.riskLevel === "critical")
    .sort();
}

/** 正式集全部 caseId（轨迹/路由/检索/评审 76 条；治理完整性测试用：登记不得引用不存在的题目） */
export function listAllFormalCaseIds(): string[] {
  return [
    ...EVAL_CASES.map((c) => c.caseId),
    ...EVAL_QUERIES.map((c) => c.caseId),
    ...EVAL_JUDGE_CASES.map((c) => c.caseId),
  ];
}
