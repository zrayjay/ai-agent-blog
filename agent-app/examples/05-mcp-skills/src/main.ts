// main.ts —— 05 示例：MCP 内存闭环 + Skills 加载的最小离线形态。
// MCP：createMcpServer() 挂引擎三工具 → createInMemoryMcpClientBridge() 同进程闭环
//      （真实路径 = createMcpClientBridge({command:"cmd",args:["/c","pnpm","mcp:server"]})）。
// Skills：临时目录按 <name>/SKILL.md 布局写技能 → loadSkillsFromDir → renderSkillsPrompt。
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpServer, createInMemoryMcpClientBridge } from "@agent-app/engine/mcp";
import { loadSkillsFromDir, renderSkillsPrompt } from "@agent-app/engine/skills";

// ① MCP 内存闭环：server 与 client 在同一进程，协议往返是真的
const bridge = await createInMemoryMcpClientBridge(createMcpServer());
console.log(`[MCP] 桥接：${bridge.name} · 工具 ${Object.keys(bridge.tools).length} 个`);

// ② 经协议调用一个工具：返回的 output 是 MCP structuredContent（原对象）
const orderTool = bridge.tools.getOrderStatus;
if (orderTool?.execute === undefined) throw new Error("getOrderStatus 未注册 execute");
const callResult = (await orderTool.execute(
  { orderId: "A-1024" },
  { toolCallId: "mcp-example-1", messages: [] },
)) as { orderId: string; status: string };
console.log(`[MCP] getOrderStatus({"orderId":"A-1024"}) → ${JSON.stringify(callResult)}`);
await bridge.close();

// ③ Skills：目录布局 = <技能名>/SKILL.md（与 .agent-skills/refund-flow 同款）
const skillsDir = mkdtempSync(join(tmpdir(), "agent-app-skills-"));
const skillDir = join(skillsDir, "refund-flow");
mkdirSync(skillDir);
writeFileSync(
  join(skillDir, "SKILL.md"),
  [
    "---",
    "name: refund-flow",
    "description: 客服退款处理流程：判断何时可退、先查订单再建工单",
    "---",
    "",
    "## 退款流程",
    "1. 先查订单状态（getOrderStatus）",
    "2. 符合退款条件 → createTicket 建工单",
    "3. 不确定 → escalateToHuman 转人工",
  ].join("\n"),
);
const { skills, warnings } = loadSkillsFromDir(skillsDir);
console.log(`[Skills] 加载 ${skills.length} 个技能：${skills.map((s) => s.name).join(", ")}`);

// ④ 注入 prompt：技能正文拼进 system prompt（「知识扩展」与 MCP 的「能力扩展」互补）
const prompt = renderSkillsPrompt(skills);
console.log(`[Skills] 注入 prompt 的技能段含描述：${prompt.includes("退款处理流程") ? "是" : "否"}`);
if (warnings.length) console.log(`[Skills] 告警：${warnings.join("; ")}`);
