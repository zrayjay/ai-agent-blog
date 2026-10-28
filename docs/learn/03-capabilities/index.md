---
type: stage-index
stage: 03-capabilities
title: 阶段 03 · Agent 能力层
---

# 阶段 03 · Agent 能力层

> 阶段目标：给循环装上能力——记忆（会话/偏好/情景三层）、RAG（切块到引用溯源）、工具加固（幂等/审批）、MCP 标准插口。**阶段交付**：带记忆、可检索私有知识、可接外部标准工具的 Agent。

**前置**：[阶段 02](/learn/02-runtime/)

## 课程

| order | 课程                                  | 当前正文                                                             | status      |
| ----- | ------------------------------------- | -------------------------------------------------------------------- | ----------- |
| 30    | memory-context · 记忆与上下文压缩     | [guide/03](/guide/03-memory)                                         | implemented |
| 40    | rag-knowledge-base · RAG 知识库与检索 | [guide/04](/guide/04-rag)                                            | implemented |
| 50    | tools-hardening · 工具层加固与幂等    | [guide/05](/guide/05-tools-hardening)                                | implemented |
| 70    | mcp-integration · MCP 标准插口        | [guide/07](/guide/07-mcp)                                            | implemented |
| —     | skills 专题                           | 暂无（代码已实现：`engine/src/skills/`，测试 `test/skills.spec.ts`） | planned     |

## 阶段验收

- 三层记忆各解决什么、压缩水位何时触发、RAG 引用编号为何由后端生成
- 跑通 `pnpm kb:ingest` + `pnpm kb` 带引用问答；MCP 客户端测试通过

## 下一阶段

[05 · 质量与可靠](/learn/05-quality/)（主路径）；编排兴趣可先读 [04](/learn/04-orchestration/)。
