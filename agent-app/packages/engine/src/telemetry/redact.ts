// telemetry/redact.ts —— 事件脱敏政策：sink 出口前的最后一道闸（PRD §6.3.5/6.3.6）。
//
// ── 为什么脱敏放在 sink 而不是发射点 ─────────────────────────────────────
// 发射点（agent-loop / run-with-verification / gate）只管把事实如实记下来；
// 「哪些东西不能出去」是输出政策，集中在 sink 边界统一执行——政策改一处生效，
// 发射点不用每个都懂（与 VerificationRunner 聚聚合、验证器只管判是同一分工哲学）。
// 内存里的 all() 保留原文（source of truth，指标聚合要用真实 usage 数字），
// **离开进程边界的拷贝**（stderr / 未来落盘）永远经 redactEvent 脱敏。
//
// ── fail-safe：默认开启 ──────────────────────────────────────────────────
// 不传 policy = 全量脱敏。理由（审计 §10.2.1「默认安全」同款）：观测数据会进
// 日志采集系统，泄了收不回来；显式关闭（enabled: false）是「我知道我在本地
// 调试」的主动声明，而不是默认态。宁可多打一枚 [REDACTED] 标记，不可漏一个 key。
//
// ── 纯函数纪律 ───────────────────────────────────────────────────────────
// redactEvent 永不修改入参：attributes 原样时返回同一引用（零拷贝快路径），
// 需要动的地方才逐层克隆。测试可对同一对象反复调用互不污染。

import type { AgentRunEvent } from "./events.js";
import { maskPii } from "../guardrails/pii-mask.js";

/**
 * 脱敏政策（当前只有一个开关，形状刻意留成对象——后续加白名单/自定义识别器
 * 不用改调用方签名）。缺省 = enabled: true（fail-safe，见头注释）。
 */
export interface RedactionPolicy {
  /** 显式关闭脱敏（仅限本地调试等可信场景；缺省 true = 开） */
  enabled?: boolean;
}

/** OpenAI 风格密钥：sk- 前缀 + 至少 16 位的 base62/连字符/下划线（太短会误伤普通词） */
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{16,}\b/g;

/** Bearer 令牌：`Bearer ` 后跟至少 8 位令牌字符（覆盖 JWT / opaque token 常见形态） */
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi;

/**
 * 秘密属性键名模式：属性 KEY 本身就在泄露（api_key / apiKey / password / …）。
 * 边界纪律与 pii-mask 的 lookaround 同源：关键词两侧必须是非字母数字边界——
 * "tokenize" 的 token 后面紧跟字母（[^a-z0-9] 不命中）故不误伤。词表刻意收窄到
 * 「含这些词就当秘密」的强信号词；复数（api_keys / credentials）由 s? 容忍。
 * 不带 g 标志（lastIndex 状态坑见 pii-mask.ts 头注释，test() 只做无状态判定）。
 */
const SECRET_KEY_PATTERN =
  /(^|[^a-z0-9])(api[-_]?key|apikey|token|secret|password|passwd|credential|authorization)s?($|[^a-z0-9])/i;

/** 值内命中的类别标记（给人看的证据：哪个通道被脱了） */
const OPENAI_KEY_MARKER = "[REDACTED:openai_key]";
const BEARER_TOKEN_MARKER = "[REDACTED:bearer_token]";

/** 秘密 KEY 的类别标记：从命中关键词映射到证据标签（与 SECRET_KEY_PATTERN 的词表同源） */
function secretKeyMarker(key: string): string {
  const k = key.toLowerCase();
  if (k.includes("api") && k.includes("key")) return "[REDACTED:api_key]";
  if (k.includes("token") || k.includes("authorization")) return "[REDACTED:token]";
  if (k.includes("secret")) return "[REDACTED:secret]";
  if (k.includes("password") || k.includes("passwd")) return "[REDACTED:password]";
  return "[REDACTED:credential]";
}

/**
 * 字符串值的三步脱敏：OpenAI 密钥 → Bearer 令牌 → 中文语境 PII（复用 pii-mask）。
 * 顺序无歧义（三类模式形状互不重叠），PII 放最后让已替换文本里的 `*` 不参与匹配。
 */
function maskSecretsAndPii(text: string): string {
  return maskPii(
    text.replace(OPENAI_KEY_PATTERN, OPENAI_KEY_MARKER).replace(BEARER_TOKEN_PATTERN, BEARER_TOKEN_MARKER),
  );
}

/**
 * 属性值递归脱敏：字符串值走三步脱敏；秘密 KEY 直接整值换证据标记（值可能是
 * 密钥本体，部分打码反而留下可猜测的残段）；非字符串（数字/布尔/null）原样
 * 保留——它们是指标聚合的原料，regex 对它们无意义。普通对象/数组逐层下钻。
 */
function redactValue(key: string, value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_KEY_PATTERN.test(key) ? secretKeyMarker(key) : maskSecretsAndPii(value);
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      // 数组元素沿用父键判定（数组整体若是密钥值，元素同罪）
      const redacted = redactValue(key, item);
      if (redacted !== item) changed = true;
      return redacted;
    });
    return changed ? next : value;
  }
  if (value !== null && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const redacted = redactValue(k, v);
      if (redacted !== v) changed = true;
      next[k] = redacted;
    }
    return changed ? next : value;
  }
  return value;
}

/**
 * 对单条事件应用脱敏政策，返回**新对象**（纯函数，不改入参）。
 * - 秘密 KEY（api_key/token/password/credential/…）→ 整值替换为 [REDACTED:<类别>]；
 * - 字符串值内的 sk- 密钥 / Bearer 令牌 → [REDACTED:openai_key] / [REDACTED:bearer_token]；
 * - 字符串值内的中文语境 PII → maskPii（138****5678 保头尾形态）；
 * - 非字符串属性（数字/布尔/null/嵌套结构里的非字符串叶子）原样保留。
 * attributes 无一命中时原引用返回——不制造无意义的拷贝。
 */
export function redactEvent(event: AgentRunEvent, policy: RedactionPolicy = {}): AgentRunEvent {
  if (policy.enabled === false) return event;
  const attrs = event.attributes;
  if (attrs === undefined) return event; // 无属性面 = 无泄露面
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const redacted = redactValue(key, value);
    if (redacted !== value) changed = true;
    next[key] = redacted;
  }
  return changed ? { ...event, attributes: next } : event; // 快路径：零命中零拷贝
}
