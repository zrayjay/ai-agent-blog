---
type: stage-index
stage: 01-foundations
title: 阶段 01 · 基础与模型交互
---

# 阶段 01 · 基础与模型交互

> 阶段目标：把模型当成「会接龙的文本函数」用明白——原生 API、流式响应、function calling 与 JSON 模式的可靠性差异、多网关切换。**阶段交付**：能徒手调通任何 OpenAI 兼容网关的流式与结构化调用。

**前置**：TypeScript 基础（[从这里开始](/start/index)有自查表）· [运行环境](/start/environment)就绪

## 课程

| order | 课程                                         | 当前正文                                                          | status                                                                                                                                                                   |
| ----- | -------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 10    | llm-structured-output · LLM API 与结构化输出 | [learn/01 · LLM API](/learn/01-foundations/llm-structured-output) | partial（精简框架版；能力已实现，[examples/minimal-agent](https://github.com/zrayjay/ai-agent-blog/blob/main/agent-app/packages/engine/examples/minimal-agent.ts) 可跑） |

## 阶段验收

- 能说清 messages 三角色、流式 chunk 结构、function calling 与 JSON 模式的可靠性排序
- 跑通 `pnpm examples:minimal`（无密钥时的报错也是教材）

## 下一阶段

[02 · Agent Runtime](/learn/02-runtime/) —— 让模型从「会说」到「会做」。
