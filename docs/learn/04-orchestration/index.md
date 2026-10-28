---
type: stage-index
stage: 04-orchestration
title: 阶段 04 · 编排
---

# 阶段 04 · 编排

> 阶段目标：单 Agent 不够用时，把「拆 · 派 · 跑」工程化。**阶段交付**：可运行的多任务编排实验——LLM 拆单 → DAG 波次并行派发 → 逐任务验收，失败四分支退路，全程预算受控。

**前置**：[阶段 02](/learn/02-runtime/)（循环与两个「壳」）；理解 Supervisor 形态建议先读 [guide/09](/learn/07-applications/service-product-line)。

## 课程

| order | 课程                                      | 当前正文                                                                      | status      |
| ----- | ----------------------------------------- | ----------------------------------------------------------------------------- | ----------- |
| 95    | multi-agent-orchestration · 多 Agent 编排 | [learn/04 · 多 Agent 编排](/learn/04-orchestration/multi-agent-orchestration) | implemented |

**源码与测试**：`agent-app/packages/engine/src/orchestrator/`（Effect 版）· `test/orchestrator.spec.ts`（30 离线用例）、`test/failure-cases.spec.ts`

## 阶段验收

- 能说出「拆/派/跑」各对应编排器哪个阶段、失败四分支是什么、预算在哪控制
- 跑通 `pnpm cli team "目标" --trace` 并对照轨迹指出三个阶段

## 下一阶段

[05 · 质量与可靠](/learn/05-quality/) —— 编排过的系统更要证明可靠。
