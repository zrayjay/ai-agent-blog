---
type: stage-index
stage: 06-fullstack
title: 阶段 06 · 全栈交付
---

# 阶段 06 · 全栈交付

> 阶段目标：把引擎变成可交互的产品——Next.js 前端、NestJS BFF、SSE 流式、compose 部署。**阶段交付**：可本地启动的完整 Web 应用（`pnpm stack:up`，需 Docker）。

**前置**：[阶段 01–05](/learn/index)（前端消费的是前五个阶段的所有能力）

## 课程

| order | 课程                                   | 当前正文                       | status      |
| ----- | -------------------------------------- | ------------------------------ | ----------- |
| 100   | web-sse-frontend · Web 前端与 SSE 流式 | [guide/10](/guide/10-frontend) | implemented |

**源码**：`agent-app/apps/web/`（Next.js：聊天/kb/客服三页 + 审批/Handoff/步骤组件）、`agent-app/apps/api/`（NestJS：12 组端点）

## 阶段验收

- SSE 事件结构（step/token）、审批挂起为何必须走流式、BFF 存在的四个理由
- API 测试套件通过：`pnpm test:api`（94 例，引擎 mock）

## 下一阶段

[07 · 产品案例](/learn/07-applications/)。
