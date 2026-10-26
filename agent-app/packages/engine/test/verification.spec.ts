// verification.spec.ts —— 结果验证模块的行为测试（离线、确定性，无基础设施门控）
// 覆盖五个面：Runner 聚合规则（三态判定 / 可选不翻转 / 证据缺失 / 抛错落账）、
// 三个内建验证器（schema / 工具轨迹 / 产物文件）、注册表、集成接缝
// runWithVerification（PRD §15.3 案例 2：执行成功 ≠ 验收通过）。
// 产物验证用系统临时目录夹具（同 evals.spec.ts 的 mkdtemp 纪律），零网络。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV2 } from "ai/test";
import type { LanguageModel } from "ai";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { tool } from "ai";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { VerificationRunner } from "../src/verification/runner.js";
import { createVerifierRegistry } from "../src/verification/registry.js";
import { createSchemaVerifier } from "../src/verification/verifiers/schema.js";
import { createToolExecutionVerifier } from "../src/verification/verifiers/tool-execution.js";
import { createArtifactVerifier } from "../src/verification/verifiers/artifact.js";
import { runWithVerification } from "../src/verification/run-with-verification.js";
import type { VerificationContext, Verifier, VerifierCheck } from "../src/verification/types.js";

/** 最小验证器工厂：一组预写检查（聚合规则测试的证据脚手架） */
function staticVerifier(id: string, checks: VerifierCheck[], required?: boolean): Verifier {
  return { id, version: "1", required, verify: () => checks };
}

/** 造一个最小验证上下文（聚合规则测试只关心 runId） */
function ctx(overrides: Partial<VerificationContext> = {}): VerificationContext {
  return { runId: "run-test", ...overrides };
}

describe("Runner 聚合规则", () => {
  it("全部必查通过 → passed", async () => {
    const result = await new VerificationRunner([
      staticVerifier("v1", [{ id: "c1", status: "passed" }]),
      staticVerifier("v2", [{ id: "c2", status: "passed" }]),
    ]).run(ctx());
    expect(result.status).toBe("passed");
    expect(result.checks).toHaveLength(2);
  });

  it("任一必查失败 → failed（一票否决，其余检查照常落账）", async () => {
    const result = await new VerificationRunner([
      staticVerifier("v1", [{ id: "c1", status: "passed" }]),
      staticVerifier("v2", [{ id: "c2", status: "failed", message: "产物缺失" }]),
    ]).run(ctx());
    expect(result.status).toBe("failed");
    expect(result.checks.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("必查验证器抛错 → inconclusive，错误记录为 skipped 检查且带消息（不吞错）", async () => {
    const exploding: Verifier = {
      id: "boom",
      version: "1",
      verify: () => {
        throw new Error("验证器内部故障");
      },
    };
    const result = await new VerificationRunner([
      staticVerifier("v1", [{ id: "c1", status: "passed" }]),
      exploding,
    ]).run(ctx());
    expect(result.status).toBe("inconclusive");
    const recorded = result.checks.find((c) => c.verifierId === "boom");
    expect(recorded?.status).toBe("skipped");
    expect(recorded?.message).toContain("验证器内部故障");
  });

  it("可选检查失败只落账，不翻转总结论（required: false）", async () => {
    const result = await new VerificationRunner([
      staticVerifier("required", [{ id: "rc", status: "passed" }]),
      staticVerifier("optional", [{ id: "oc", status: "failed", message: "观察项不达标" }], false),
    ]).run(ctx());
    expect(result.status).toBe("passed");
    const optional = result.checks.find((c) => c.verifierId === "optional");
    expect(optional?.status).toBe("failed");
  });

  it("必查检查 skipped（证据缺失）→ inconclusive，绝不默认通过", async () => {
    const result = await new VerificationRunner([
      staticVerifier("v1", [{ id: "c1", status: "skipped", message: "轨迹未提供" }]),
    ]).run(ctx());
    expect(result.status).toBe("inconclusive");
  });

  it("必查验证器零产出（空清单）→ inconclusive：空清单不静默折算 passed", async () => {
    const result = await new VerificationRunner([staticVerifier("empty", [])]).run(ctx());
    expect(result.status).toBe("inconclusive");
    expect(result.checks[0]?.status).toBe("skipped");
    expect(result.checks[0]?.message).toContain("证据缺失");
  });

  it("failed 优先于 inconclusive：确定性坏消息优先上报，不确定项仍在 checks", async () => {
    const result = await new VerificationRunner([
      staticVerifier("v1", [{ id: "c1", status: "skipped" }]),
      staticVerifier("v2", [{ id: "c2", status: "failed", message: "硬失败" }]),
    ]).run(ctx());
    expect(result.status).toBe("failed");
  });

  it("落账带溯源：每条检查补 verifierId / verifierVersion，报告带时间窗与 runId", async () => {
    const result = await new VerificationRunner([staticVerifier("v1", [{ id: "c1", status: "passed" }])]).run(
      ctx({ runId: "run-42" }),
    );
    expect(result.runId).toBe("run-42");
    expect(result.startedAt).toBeTruthy();
    expect(result.finishedAt).toBeTruthy();
    expect(result.checks[0]?.verifierId).toBe("v1");
    expect(result.checks[0]?.verifierVersion).toBe("1");
  });
});

describe("SchemaVerifier", () => {
  const schema = z.object({ ticketId: z.string(), status: z.literal("已创建") });

  it("产出合规 → passed", async () => {
    const [check] = await createSchemaVerifier({ schema }).verify(
      ctx({ output: { ticketId: "TK-1", status: "已创建" } }),
    );
    expect(check.status).toBe("passed");
  });

  it("产出不合规 → failed，evidence 带 zod issues", async () => {
    const [check] = await createSchemaVerifier({ schema }).verify(
      ctx({ output: { ticketId: 42, status: "已创建" } }),
    );
    expect(check.status).toBe("failed");
    expect(Array.isArray(check.evidence)).toBe(true);
  });

  it("产出缺省 → skipped（无结构可校验 = 证据缺失，不是校验失败）", async () => {
    const [check] = await createSchemaVerifier({ schema }).verify(ctx());
    expect(check.status).toBe("skipped");
  });
});

describe("ToolExecutionVerifier", () => {
  it("期望工具都被调用且无失败 → passed", async () => {
    const [check] = await createToolExecutionVerifier({ expectedToolNames: ["create_ticket"] }).verify(
      ctx({
        traceSummary: {
          steps: [
            { toolName: "search_orders", failed: false },
            { toolName: "create_ticket", failed: false },
          ],
        },
      }),
    );
    expect(check.status).toBe("passed");
  });

  it("期望工具没被调用 → failed（编排没发生）", async () => {
    const [check] = await createToolExecutionVerifier({ expectedToolNames: ["create_ticket"] }).verify(
      ctx({ traceSummary: { steps: [{ toolName: "search_orders", failed: false }] } }),
    );
    expect(check.status).toBe("failed");
    expect(check.message).toContain("未在轨迹中出现");
  });

  it("工具被调用但执行失败 → failed（调了 ≠ 跑成了）", async () => {
    const [check] = await createToolExecutionVerifier({ expectedToolNames: ["create_ticket"] }).verify(
      ctx({ traceSummary: { steps: [{ toolName: "create_ticket", failed: true }] } }),
    );
    expect(check.status).toBe("failed");
  });

  it("轨迹摘要缺省 → skipped（没有轨迹就没有事实）", async () => {
    const [check] = await createToolExecutionVerifier({ expectedToolNames: ["create_ticket"] }).verify(ctx());
    expect(check.status).toBe("skipped");
  });
});

describe("ArtifactVerifier（临时目录夹具）", () => {
  const makeTmpDir = (): string => mkdtempSync(join(tmpdir(), "verify-artifact-"));
  const withTmp = async <T>(fn: (dir: string) => Promise<T> | T): Promise<T> => {
    const dir = makeTmpDir();
    try {
      return await fn(dir); // 等异步断言跑完再清理，防止夹具先于检查被删
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("产物存在且 contains 命中 → passed", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "report.md");
      writeFileSync(file, "# 报告\n工单 TK-1 已创建", "utf8");
      const [check] = await createArtifactVerifier({
        artifacts: [{ path: file, contains: "TK-1 已创建" }],
      }).verify(ctx());
      expect(check.status).toBe("passed");
    });
  });

  it("产物存在但不含期望子串 → failed", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "report.md");
      writeFileSync(file, "# 报告\n无相关内容", "utf8");
      const [check] = await createArtifactVerifier({ artifacts: [{ path: file, contains: "TK-1" }] }).verify(
        ctx(),
      );
      expect(check.status).toBe("failed");
    });
  });

  it("产物不存在（ENOENT）→ failed（确定性坏消息）", async () => {
    await withTmp(async (dir) => {
      const [check] = await createArtifactVerifier({
        artifacts: [{ path: join(dir, "missing.txt") }],
      }).verify(ctx());
      expect(check.status).toBe("failed");
      expect(check.message).toContain("产物不存在");
    });
  });

  it("路径存在但读不动（目录 + contains）→ skipped：必查时聚合成 inconclusive（fail-closed）", async () => {
    await withTmp(async (dir) => {
      const subDir = join(dir, "payload");
      mkdirSync(subDir);
      const result = await new VerificationRunner([
        createArtifactVerifier({ artifacts: [{ path: subDir, contains: "x" }] }),
      ]).run(ctx());
      expect(result.status).toBe("inconclusive");
      expect(result.checks[0]?.status).toBe("skipped");
    });
  });

  it("只验存在性、不配 contains 时目录也 → passed（stat 成功即可判定）", async () => {
    await withTmp(async (dir) => {
      const [check] = await createArtifactVerifier({ artifacts: [{ path: dir }] }).verify(ctx());
      expect(check.status).toBe("passed");
    });
  });

  it("artifacts 为空 → skipped（无产物可核）", async () => {
    const [check] = await createArtifactVerifier({ artifacts: [] }).verify(ctx());
    expect(check.status).toBe("skipped");
  });
});

describe("注册表", () => {
  it("register → get → create 全链路可用", () => {
    const registry = createVerifierRegistry();
    registry.register("schema", () => createSchemaVerifier({ schema: z.object({}) }));
    expect(registry.get("schema")).toBeTypeOf("function");
    const verifier = registry.create("schema");
    expect(verifier.id).toBe("schema");
  });

  it("重复注册同 id 抛错（不静默覆盖）", () => {
    const registry = createVerifierRegistry();
    registry.register("schema", () => createSchemaVerifier({ schema: z.object({}) }));
    expect(() => registry.register("schema", () => createSchemaVerifier({ schema: z.object({}) }))).toThrow(
      /重复注册/,
    );
  });

  it("未注册的 id create 抛中文错误并列出已注册项", () => {
    const registry = createVerifierRegistry();
    expect(() => registry.create("nope")).toThrow(/未注册的验证器 id：nope/);
  });
});

describe("集成接缝 runWithVerification（PRD §15.3 案例 2）", () => {
  const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  type ScriptedResponse = Awaited<ReturnType<LanguageModelV2["doGenerate"]>>;

  /** 剧本模型：第一轮发起 create_ticket 工具调用，第二轮给出「成功」口吻的最终文本 */
  function scriptedModel(): LanguageModel {
    let cursor = 0;
    return new MockLanguageModelV2({
      doGenerate: async (): Promise<ScriptedResponse> => {
        const index = cursor;
        cursor += 1;
        if (index === 0) {
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "call-1",
                toolName: "create_ticket",
                input: JSON.stringify({ subject: "催单", description: "订单 A-1024 三天未发货" }),
              },
            ],
            finishReason: "tool-calls",
            usage: ZERO_USAGE,
            warnings: [],
          };
        }
        return {
          content: [{ type: "text" as const, text: "好的，工单已创建成功，我们会尽快处理您的催单诉求。" }],
          finishReason: "stop",
          usage: ZERO_USAGE,
          warnings: [],
        };
      },
    });
  }

  /** 会炸的建单工具：模拟上游工单系统故障（返回类型显式标注，OUTPUT 不被推成 never） */
  const tools = {
    create_ticket: tool({
      description: "为用户创建客服工单",
      inputSchema: z.object({ subject: z.string(), description: z.string() }),
      execute: async (): Promise<{ ticketId: string }> => {
        throw new Error("上游工单系统 500");
      },
    }),
  };

  it("执行成功（循环有出口、文本声称成功）但验证失败：两个事实同时成立且分开表达", async () => {
    const result = await runWithVerification({
      model: scriptedModel(),
      messages: [{ role: "user", content: "帮我建个催单工单" }],
      tools,
      verifiers: [createToolExecutionVerifier({ expectedToolNames: ["create_ticket"] })],
    });
    expect(result.run.text).toContain("已创建成功");
    expect(result.verification.status).toBe("failed");
    const failedCheck = result.verification.checks.find((c) => c.status === "failed");
    expect(failedCheck?.id).toContain("create_ticket");
    expect(failedCheck?.message).toContain("1/1 次执行失败");
  });

  it("调用方自己的 onStep 不被劫持：事件照常转发", async () => {
    const observed: string[] = [];
    const result = await runWithVerification({
      model: scriptedModel(),
      messages: [{ role: "user", content: "帮我建个催单工单" }],
      tools,
      onStep: (event) => {
        observed.push(event.toolCall.toolName);
      },
      verifiers: [],
    });
    expect(observed).toEqual(["create_ticket"]);
    expect(result.verification.status).toBe("passed"); // 空验证器清单 = 无必查项
    expect(result.verification.checks).toHaveLength(0);
  });

  it("显式 runId 透传进验证报告（缺省时生成非空 runId）", async () => {
    const named = await runWithVerification({
      model: scriptedModel(),
      messages: [{ role: "user", content: "帮我建个催单工单" }],
      tools,
      runId: "run-explicit-1",
      verifiers: [],
    });
    expect(named.runId).toBe("run-explicit-1");
    expect(named.verification.runId).toBe("run-explicit-1");
  });
});
