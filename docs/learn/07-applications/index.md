---
type: stage-index
stage: 07-applications
title: 阶段 07 · 产品案例
---

# 阶段 07 · 产品案例

> 阶段目标：把零件组装成业务——同一套引擎的三种车身。**阶段交付**：可演示的产品线（客服在主线内，知识库/文档智能有完整组装说明书）。

**前置**：[阶段 03](/learn/03-capabilities/) + [阶段 06](/learn/06-fullstack/)。

## 课程

| order | 课程                                        | 当前正文                                                              | status                                                                      |
| ----- | ------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 90    | service-product-line · 产品线组装：客服系统 | [learn/09 · 客服产品线](/learn/07-applications/service-product-line)  | implemented                                                                 |
| —     | 知识库问答案例                              | [products/kb](/cases/knowledge-base)（P1-05 迁为 cases）              | implemented（kb 产品线有源码与 API e2e 测试背书）                           |
| —     | 文档智能案例                                | [products/docintel](/cases/document-intelligence)（P1-05 迁为 cases） | —（正文为 Python 教学叙事，`agent-app` 无对应实现；只作案例链接，不标状态） |

## 阶段验收

- 硬规则路由为何优先于模型、三分类兜模糊、转人工的 HandoffPack 里有什么
- 跑通 `pnpm service`（REPL）或 Web 客服页；转人工 createTicket 是 demo mock（诚实边界）

## 主线毕业

完成 01–07 即主线毕业。后续：[12 · 演进方向](/advanced/evolution)、[13 · 面试实战](/advanced/interview)（advanced，P1-05 归位）。
