// verification/verifiers/schema.ts —— SchemaVerifier：用 zod 校验 Run 产出的结构（Phase 1）。
//
// ── 判定口径 ──────────────────────────────────────────────────────────────
// ctx.output 能过 schema.safeParse → passed；过不了 → failed（evidence 带
// zod issues，哪个字段不合规可定位）。ctx.output 缺省（undefined）→ skipped：
// 没有产出就无结构可校验，这是「证据缺失」不是「校验失败」——必查时由
// Runner 聚合成 inconclusive，可选时只落账。
//
// 为什么不把「无产出」判 failed：调用方可能验证的是可选产出（比如只对
// 结构化结果运行）；失败的裁决权在聚合规则手里，验证器只如实报告证据状态。

import type { z } from "zod";
import type { VerificationContext, Verifier, VerifierCheck } from "../types.js";

/** SchemaVerifier 装配项：schema 必给，其余沿用 Verifier 缺省语义 */
export interface SchemaVerifierOptions {
  /** 产出必须满足的 zod schema */
  schema: z.ZodType;
  id?: string;
  version?: string;
  required?: boolean;
}

/** 内建 id：多份 schema 验证器可共用（溯源靠 verifierId + check.id） */
export const SCHEMA_VERIFIER_ID = "schema";

export function createSchemaVerifier(options: SchemaVerifierOptions): Verifier {
  const { schema, required } = options;
  const id = options.id ?? SCHEMA_VERIFIER_ID;
  const version = options.version ?? "1";
  return {
    id,
    version,
    required,
    verify(context: VerificationContext): readonly VerifierCheck[] {
      if (context.output === undefined) {
        return [
          {
            id: `${id}:no-output`,
            status: "skipped",
            message: "产出（context.output）未提供，无结构可校验",
          },
        ];
      }
      const parsed = schema.safeParse(context.output);
      if (parsed.success) {
        return [{ id: `${id}:output-shape`, status: "passed" }];
      }
      return [
        {
          id: `${id}:output-shape`,
          status: "failed",
          message: `产出不符合 schema：${parsed.error.issues.length} 处不合规（首个：${parsed.error.issues[0]?.path.join(".") || "（根）"} ${parsed.error.issues[0]?.message}）`,
          evidence: parsed.error.issues,
        },
      ];
    },
  };
}
