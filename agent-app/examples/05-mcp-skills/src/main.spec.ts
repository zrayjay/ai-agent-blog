// main.spec.ts —— 05 示例的离线确定性测试（CI 必跑，零密钥）。
// 断言两个扩展机制的契约：MCP 协议往返后工具可直接执行、Skills 目录布局加载/告警不静默。
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpServer, createInMemoryMcpClientBridge } from "@agent-app/engine/mcp";
import { loadSkillsFromDir, renderSkillsPrompt } from "@agent-app/engine/skills";

function writeSkill(dir: string, name: string, body: string): void {
  const skillDir = join(dir, name);
  mkdirSync(skillDir);
  writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} 流程\n---\n\n${body}`);
}

describe("05-mcp-skills", () => {
  it("MCP 内存闭环：协议往返后工具表可执行，返回 structuredContent 原对象", async () => {
    const bridge = await createInMemoryMcpClientBridge(createMcpServer());
    expect(bridge.name).toBe("in-memory");
    expect(Object.keys(bridge.tools).sort()).toEqual(["createTicket", "getOrderStatus", "searchKnowledge"]);

    const orderTool = bridge.tools.getOrderStatus;
    const execute = orderTool?.execute;
    expect(execute).toBeDefined();
    const out = (await execute?.({ orderId: "A-1024" }, { toolCallId: "spec-1", messages: [] })) as {
      orderId: string;
      status: string;
    };
    expect(out).toMatchObject({ orderId: "A-1024" });
    await bridge.close();
  });

  it("Skills：<name>/SKILL.md 布局加载成功并注入 prompt", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-app-skills-spec-"));
    writeSkill(dir, "refund-flow", "先查订单再建工单。");
    const { skills, warnings } = loadSkillsFromDir(dir);
    expect(warnings).toEqual([]);
    expect(skills[0]?.name).toBe("refund-flow");
    expect(renderSkillsPrompt(skills)).toContain("先查订单再建工单");
  });

  it("Skills 告警不静默：目录下无 SKILL.md 以 warning 浮出", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-app-skills-bad-"));
    mkdirSync(join(dir, "empty-skill"));
    const { skills, warnings } = loadSkillsFromDir(dir);
    expect(skills).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
