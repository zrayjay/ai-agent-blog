// verification/types.ts —— 结果验证契约：Verifier / CheckResult / VerificationResult 的数据形状（Phase 1）。
//
// ── 这个模块解决什么问题（审计 §2.4：Verification 完全缺失）────────────────
// runToolLoop 返回即「执行成功」，Agent 嘴上说「已完成」没有任何东西去核——
// 「执行成功 ≠ 验收通过」这个语义此前不存在。本模块提供独立于模型自述的
// 验收层：验证器（Verifier）拿上下文里的**客观证据**（schema / 工具轨迹 /
// 文件产物）做判定，Runner 按规则聚合成三态结论（passed / failed / inconclusive）。
//
// ── 三态而非二态的动机 ────────────────────────────────────────────────────
// 验证器可能「跑不了」而不是「没通过」（轨迹缺失、文件读不动、验证器自身抛错）。
// 把这些折算成 failed 会误伤，折算成 passed 会粉饰——inconclusive 单独成态，
// 「不确定」必须可见（与 evals 的 skipped ≠ failed 同一工程哲学）。
//
// ── 确定性纪律 ────────────────────────────────────────────────────────────
// 本模块全程零 LLM、零网络：所有验证器只消费结构化证据（zod schema、
// traceSummary、本地文件系统）。需要语义判断的验收归 evals 的 judge（Tier 3），
// 两层不混。

/**
 * 轨迹摘要：一次 Run 实际执行了哪些工具、各自成败。
 * 形状刻意最小（调用方从 onStep 事件或结构化轨迹归集）：
 * ToolExecutionVerifier 只信这份结构化事实，绝不解析模型的文本自述。
 */
export interface TraceSummary {
  steps: Array<{ toolName: string; failed: boolean }>;
}

/** 验证上下文：验证器能看到什么（可用的证据面，缺省字段 = 证据未提供） */
export interface VerificationContext {
  runId: string;
  /** 验收任务描述（人读，供 message/evidence 引用场景） */
  task?: string;
  /** 原始输入（Run 的入参） */
  input?: unknown;
  /** Run 的产出（循环最终文本 / 结构化结果）——SchemaVerifier 校验对象 */
  output?: unknown;
  /** 工具执行轨迹摘要——ToolExecutionVerifier 的唯一事实源 */
  traceSummary?: TraceSummary;
}

/** 单条检查结论：验证器产出的最小判定单元（一枚检查 = 一条可解释的证据） */
export interface VerifierCheck {
  /** 检查 id（验证器内部稳定，如 "expected-tool:create_ticket"） */
  id: string;
  status: "passed" | "failed" | "skipped";
  /** 人读结论说明（失败时说清期望 vs 实际，中文） */
  message?: string;
  /** 判定依据的结构化证据（命中的轨迹步、schema issues 等） */
  evidence?: unknown;
}

/** Runner 落账后的检查结果：在 VerifierCheck 上补验器溯源字段 */
export interface CheckResult extends VerifierCheck {
  /** 哪个验证器产出（多验证器聚合时定位归因） */
  verifierId?: string;
  verifierVersion?: string;
}

/** 验证总结论三态：passed（全部必查通过）/ failed（必查失败）/ inconclusive（必查无法判定） */
export type VerificationStatus = "passed" | "failed" | "inconclusive";

/** 一次验证的完整报告：结论 + 逐条检查 + 时间窗 */
export interface VerificationResult {
  runId: string;
  status: VerificationStatus;
  checks: CheckResult[];
  startedAt: string;
  finishedAt: string;
}

/**
 * 验证器契约：一个确定性的验收检查项。
 * - required 缺省视为 true（fail-closed）：挂上来的验证器默认是验收要求，
 *   「可选观察项」需显式 required: false 声明；
 * - verify 返回检查清单（可多条），Runner 负责补溯源字段与聚合——
 *   验证器只管判，Runner 管账，职责分离让验证器可以是最纯的函数。
 * - verify 允许同步返回或返回 Promise（确定性验证器大多同步）。
 */
export interface Verifier {
  id: string;
  /** 验证器版本（结论可追溯到具体一版判定逻辑） */
  version: string;
  /** 是否验收必查项（缺省 true，见上） */
  required?: boolean;
  verify(context: VerificationContext): readonly VerifierCheck[] | Promise<readonly VerifierCheck[]>;
}
