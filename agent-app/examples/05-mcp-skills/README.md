# 05 · MCP 标准插口 + Skills 技能加载（离线版）

> 对应课：[learn/07 · MCP 标准插口](../../../docs/learn/03-capabilities/mcp-integration.md) · 对应源码：`packages/engine/src/mcp/`、`packages/engine/src/skills/`
> 两个「扩展机制」各演示最小形态：MCP（内存传输：server/client 同进程闭环）与 Skills（SKILL.md 加载注入）。**零密钥、零网络**。

## 前置

无。完全离线；`pnpm install` 后即可运行（内存传输不需要 spawn 子进程）。

## 命令与预期输出

```bash
pnpm examples:list
pnpm examples:check
pnpm exec tsx examples/05-mcp-skills/src/main.ts
```

`main.ts` 预期输出（内存传输 + 临时技能目录，确定性）：

```text
[MCP] 桥接：in-memory · 工具 3 个
[MCP] getOrderStatus({"orderId":"A-1024"}) → {"orderId":"A-1024","status":"已发货","eta":"明天 18 点前送达"}
[Skills] 加载 1 个技能：refund-flow
[Skills] 注入 prompt 的技能段含描述：是
```

## 学到什么

- **MCP 三角色在本仓库的映射**：`createMcpServer()` 把引擎三工具挂上标准协议；`createInMemoryMcpClientBridge()` 用 InMemoryTransport 同进程闭环（`cmd /c pnpm mcp:server` 是它的 stdio 兄弟）
- **协议往返后工具可直接合入 runToolLoop**：bridge.tools 就是 ToolSet——「翻译官」把 MCP 工具适配成自家 AgentTool
- **Skills 是知识扩展**（区别于 MCP 的能力扩展）：`loadSkillsFromDir` 读 SKILL.md（frontmatter name/description + 正文），`renderSkillsPrompt` 拼进 system prompt
- **告警不静默**：坏技能以 warnings 浮出，单个坏不拖死全部

## 真实路径（可选）

`createMcpClientBridge({ command: "cmd", args: ["/c", "pnpm", "mcp:server"] })` 连真实 stdio 服务器；`.agent-skills/` 目录是已配好的技能实例（refund-flow）。
