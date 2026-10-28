---
type: stage-index
stage: 05-quality
title: 阶段 05 · 质量与可靠
---

# 阶段 05 · 质量与可靠

> 阶段目标：让 Agent 的行为可证明——护栏与红队、评估框架、质量门禁、生产化成熟度。**阶段交付**：可重复运行的评估报告与 CI 质量门禁（Tier 1 离线必跑）。

**前置**：[阶段 02](/learn/02-runtime/)；评估课建议先完成 [03](/learn/03-capabilities/)。

## 课程

| order | 课程                                    | 当前正文                                                | status      |
| ----- | --------------------------------------- | ------------------------------------------------------- | ----------- |
| 60    | guardrails-safety · 护栏与安全红队      | [learn/06 · 护栏](/learn/05-quality/guardrails-safety)  | implemented |
| 80    | evals-quality-gate · 评估框架：跑分说话 | [learn/08 · 评估](/learn/05-quality/evals-quality-gate) | implemented |
| 110   | production-maturity · 生产化与成熟度    | [guide/11](/guide/11-production)                        | implemented |

**源码与测试**：`engine/src/guardrails/`、`engine/src/evals/`、`engine/src/verification/`、`engine/src/telemetry/` · 对应 `test/guardrails.spec.ts`、`test/evals.spec.ts`、`test/quality-gate.spec.ts` 等

## 阶段验收

- 四道护栏各拦什么、拒绝为何是数据而非异常、评估与单测的本质区别
- 跑通 `pnpm eval` 与 `pnpm quality-gate --gate-policy ci`（零密钥）

## 下一阶段

[06 · 全栈交付](/learn/06-fullstack/)。
