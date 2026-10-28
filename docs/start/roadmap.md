# 学习路线图

> 本页是全站**唯一正式学习路线**：七阶段能力主线。它按技术依赖组织——每一阶段的产出是下一阶段的前置。读完本页你会知道整条路有多长、每站交付什么、现在该从哪开始。

## 路线总览

| 阶段              | 主题                                             | 你将交付                                     | 前置    |
| ----------------- | ------------------------------------------------ | -------------------------------------------- | ------- |
| S1 基础与模型交互 | LLM API、流式、结构化输出、工具调用协议          | 能徒手调通 OpenAI 兼容网关的流式与 JSON 调用 | TS 基础 |
| S2 Agent Runtime  | 手写工具循环、终止条件、错误回灌、审批与幂等     | 一个 200 行、带五道工程防御的工具循环        | S1      |
| S3 Capabilities   | 记忆（三层）、RAG（含引用溯源）、MCP、Skills     | 带记忆、可检索私有知识、可接外部工具的 Agent | S2      |
| S4 Orchestration  | 多 Agent 编排：拆 · 派 · 跑、DAG 并行、验收闭环  | 可运行的多任务编排实验（`pnpm cli team`）    | S2      |
| S5 质量与可靠     | 护栏、红队、评估框架、质量门禁、生产化           | 可重复运行的评估报告与 CI 门禁               | S2~S3   |
| S6 全栈交付       | Next.js 前端、NestJS BFF、SSE 流式、compose 部署 | 可本地启动的完整 Web 应用                    | S1~S5   |
| S7 产品案例       | 知识库问答、智能客服、文档智能                   | 三个可演示的业务案例及组装说明               | S3~S6   |

**课程顺序不预示产品功能**：某主题若只有演示或设计，教程会如实标注，不写「已生产可用」。全站能力现状见各章「状态」声明与 [MATURITY 成熟度矩阵](/how-to/MATURITY)。

## 主线章节（guide 01-13）

主线正文共 13 站，按上表阶段分组。每站的「上一站/下一站」在页首页尾，跳读后可随时回到顺序路径：

| 站                                                       | 标题                        | 所属阶段 |
| -------------------------------------------------------- | --------------------------- | -------- |
| [01](/learn/01-foundations/llm-structured-output)        | LLM API 与结构化输出        | S1       |
| [02](/learn/02-runtime/agent-loop)                       | 手写工具循环（Agent 核心）  | S2       |
| [03](/learn/03-capabilities/memory-context)              | 记忆与上下文压缩            | S3       |
| [04](/learn/03-capabilities/rag-knowledge-base)          | RAG 知识库与检索            | S3       |
| [05](/learn/03-capabilities/tools-hardening)             | 工具层加固与幂等            | S2/S3    |
| [06](/learn/05-quality/guardrails-safety)                | 护栏与安全红队              | S5       |
| [07](/learn/03-capabilities/mcp-integration)             | MCP 标准插口                | S3       |
| [08](/learn/05-quality/evals-quality-gate)               | 评估框架：跑分说话          | S5       |
| [09](/learn/07-applications/service-product-line)        | 产品线组装：客服系统        | S7       |
| [09b](/learn/04-orchestration/multi-agent-orchestration) | 多 Agent 编排：拆 · 派 · 跑 | S4       |
| [10](/learn/06-fullstack/web-sse-frontend)               | Web 前端与 SSE 流式         | S6       |
| [11](/learn/05-quality/production-maturity)              | 生产化与成熟度              | S5/S6    |
| [12](/guide/12-roadmap)                                  | 学完之后：演进方向          | 毕业站   |
| [13](/guide/13-interview)                                | 面试实战：带着问题通关      | 求职专题 |

> 编号即推荐学习顺序。09b 编排专题已重编号为课程 `multi-agent-orchestration`（[阶段 04](/learn/04-orchestration/)，旧链接 `/guide/09b-multi-agent` 保留跳转）；09 之后进入全栈与收尾。

## 建议节奏

- **有全栈经验**：S1→S2 直进，第 3-8 站按序，预计 2-3 周（每天 2-3 小时）
- **前端转 Agent 方向**：全序走完，重点补 S2 与 S5，预计 4-6 周
- **只关心某个案例**（如知识库）：01→02→04→09 最短路径，再回头补 03/05/08——但案例之外的站不建议永久跳过，护栏与评估是生产底线

每周节奏建议：读站内正文 → 跑配套命令 → 做自测题 → 卡住查模块深读（reference）。

## 历史路线（23 周）的边界

本站前身是《23 周通关教程》：按天组织、混排 Python 主线、以求职冲刺收尾。它已**完整归档**：

- 目录：[归档 · 按周索引](/archive/weeks/week01/)（第 1-23 周，161 篇日课 + 加餐，原样保留、不再更新）
- 旧路线图：[23 周路线图（历史）](/roadmap)
- Python 内容：归档在第 9-10、12-19 周，定位为「第二引擎」选修，与 TS 主线相互独立

归档内容中的版本信息以写作当时（2026-09）为准；主线教程基于 `agent-app/` 真实实现持续校准。两套结构不再互相导航，从本页出发只会进入主线。

## 下一步

- 环境没搭？[运行环境](/start/environment)
- 术语不熟？第 01 站开篇有最小概念集，遇到再查
- 直接开始：[第 01 站 · LLM API 与结构化输出](/learn/01-foundations/llm-structured-output)
