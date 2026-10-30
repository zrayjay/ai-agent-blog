// service.contract.spec.ts —— service 产品线 characterization tests（P3-05）。
//
// 为什么（P3-04/ADR-0004 背景）：service 裁决为「不迁移、留在 engine 内」，
// 方案 P3-05 要求为迁移候选模块补 characterization/API 合约测试——迁移候选集
// 为空，但 service 作为 L3 产品层是未来最可能的迁移候选，本套件把它的
// 现有公开行为固化下来：一旦未来迁移（拆包/改名/导出面调整），本套件
// 不改一行即可暴露行为漂移。同一接缝也可在迁移时原样搬走当新包的验收。
//
// 覆盖层次说明：service 已有「纯函数级」（apps/cli __tests__ 5/5 硬规则）与
// 「HTTP e2e 级」（api service.stream.spec）覆盖；本套件固化 engine 包公开
// 导出面的行为合约。全程离线：硬规则是纯函数；buildHandoffPack 的摘要器
// 会调模型，故本套件只测 formatHandoffPack/handoffReply 纯函数段。
import { describe, expect, it } from "vitest";
import {
  supervise,
  formatHandoffPack,
  handoffReply,
  isUnresolvedSignal,
  checkHardRules,
  matchAnyKeyword,
  HUMAN_REQUEST_KEYWORDS,
  HIGH_RISK_KEYWORDS,
} from "@agent-app/engine/service";
import type { SupervisorState } from "@agent-app/engine/service";

function stateOf(msg: string, unresolvedRounds = 0): SupervisorState {
  return { lastUserMessage: msg, unresolvedRounds };
}

/** 硬规则路由（characterization：行为冻结） */
describe("service 契约 · 硬规则路由", () => {
  it("人工请求关键词命中 → human 决策", () => {
    const decision = checkHardRules(stateOf("我要转人工，找真人客服"));
    expect(decision).not.toBeNull();
    expect(decision?.target).toBe("human");
  });

  it("高危关键词命中 → human 决策", () => {
    for (const kw of HIGH_RISK_KEYWORDS.slice(0, 2)) {
      expect(checkHardRules(stateOf(`请帮我处理${kw}`))?.target).toBe("human");
    }
  });

  it("普通问题不命中硬规则 → null（交给模型分类）", () => {
    expect(checkHardRules(stateOf("今天天气不错"))).toBeNull();
  });

  it("matchAnyKeyword：命中返回关键词，未命中 null", () => {
    expect(matchAnyKeyword("我要转人工", HUMAN_REQUEST_KEYWORDS)).toBe("转人工");
    expect(matchAnyKeyword("今天天气不错", HUMAN_REQUEST_KEYWORDS)).toBeNull();
  });

  it("isUnresolvedSignal：追问语义识别", () => {
    expect(isUnresolvedSignal("还是没解决，到底怎么办")).toBe(true);
    expect(isUnresolvedSignal("好的明白了谢谢")).toBe(false);
  });
});

/** supervise 全流程：路由决策由硬规则 + 模型分类驱动——硬规则路径零模型可测；
 *  模型分类路径需要真实 key，此处只冻结「硬规则直接命中时绕过模型」的合约。 */
describe("service 契约 · supervise 硬规则短路", () => {
  it("人工请求 → supervise 直接返回 human 决策（不调模型）", async () => {
    const decision = await supervise(stateOf("转人工"), [{ role: "user", content: "转人工" }]);
    expect(decision.target).toBe("human");
  });

  it("高危请求 → supervise 直接返回 human 决策（不调模型）", async () => {
    const decision = await supervise(stateOf("我要投诉"), [{ role: "user", content: "我要投诉" }]);
    expect(decision.target).toBe("human");
  });
});

/** handoff 打包纯函数段（buildHandoffPack 的摘要器调模型，不在离线范围） */
describe("service 契约 · handoff 纯函数", () => {
  const pack = {
    ticketId: "TK-SPEC-001",
    reason: "用户明确要求人工",
    userSummary: "用户要求退款",
    recentTranscript: "user: 我要退款\nassistant: 好的，为您转接人工。",
    createdAt: "2026-10-30T00:00:00Z",
  };

  it("formatHandoffPack 产出含工单号/原因/对话的可读文本", () => {
    const text = formatHandoffPack(pack);
    expect(text).toContain("TK-SPEC-001");
    expect(text).toContain("用户明确要求人工");
    expect(text).toContain("我要退款");
  });

  it("handoffReply 返回非空安抚话术", () => {
    const reply = handoffReply(pack);
    expect(typeof reply).toBe("string");
    expect(reply.length).toBeGreaterThan(0);
  });
});
