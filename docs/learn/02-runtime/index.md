---
type: stage-index
stage: 02-runtime
title: 阶段 02 · Agent Runtime
---

# 阶段 02 · Agent Runtime

> 阶段目标：手写 Agent 的发动机——多步工具循环。**阶段交付**：一个 200 行、无框架、带五道工程防御（maxSteps 保险丝 / 校验闸回灌 / 幂等壳 / 审批壳 / abort 中止）的工具循环，每步可观测。

**前置**：[阶段 01](/learn/01-foundations/)（function calling 的可靠性排序是本阶段地基）

## 课程

| order | 课程                      | 当前正文                         | status      |
| ----- | ------------------------- | -------------------------------- | ----------- |
| 20    | agent-loop · 手写工具循环 | [guide/02](/guide/02-agent-loop) | implemented |

**源码与测试**：`agent-app/packages/engine/src/agent-loop.ts` · `test/agent-loop.spec.ts`、`test/reliability.spec.ts`、`test/hardening.spec.ts`

## 阶段验收

- 能说清循环出口条件、回灌为何不可省、五道防御各针对什么故障
- 跑通 `pnpm chat --trace` 并读懂轨迹输出

## 下一阶段

[03 · Agent 能力层](/learn/03-capabilities/)（主路径）或 [04 · 编排](/learn/04-orchestration/)（依赖 02 后即可并行）。
