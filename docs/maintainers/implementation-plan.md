# AI Agent Blog 教学体系与 Agent App 系统重构实施方案

> **执行对象：OpenBot / AI 开发 Agent**  
> **目标仓库：** `https://github.com/zrayjay/ai-agent-blog`  
> **基线分支：** `main`（执行时记录具体 SHA）  
> **方案版本：** V1.0（2026-10-28）  
> **性质：** 实施规格书、阶段计划、质量门禁与验收标准  
> **边界：** 仅修改 `ai-agent-blog`，不得向 `personal-agent` 或其他仓库提交修改。

---

## 0. 一页决策摘要

本次重构**不是重写项目**，是将当前「23 周旧课程 + 新版 Guide + Reference + Products + Agent App」多套并行体系，改造为 **唯一主线的工程化教学体系**：

**学习原理（Learn） → 最小示例（Build） → 工程模块（Integrate） → 真实案例（Apply） → 验证质量（Verify）**。

必须同时达到五项目标：

1. **一个主学习入口**：以能力依赖关系组织课程，旧版 23 周课程保留为明确标注的历史资料，不再与主线并列。
2. **一套事实来源**：教程所述功能、源码、命令、测试与 CI 能够对应；计划中功能不能被描述为已经交付。
3. **一个渐进式工程内核**：保留 `agent-app` 现有可运行能力，先治理依赖和公共接口，再按实证需要拆包，不一次性推倒重来。
4. **逐章可复现**：每章都有目标、前置、原理、示例、真实模块映射、验证、边界及下一步；引用稳定可复现的代码版本。
5. **自动化、安全可回退的开发工作流**：每个独立任务从最新 `main` 拉新分支，开发→测试→独立审查→验收→合并→验证主干，然后自动进入下一任务；任何失败阻断后续任务。

### 不可突破的限制

- **不得**把 `agent-app/docs/personal-agent` 的规划当作 `agent-app` 已经具备的产品功能。
- **不得**在本仓库实施独立 `personal-agent` 产品需求；独立仓库 `zrayjay/personal-agent` 由其自身计划维护。
- **不得**为达成“目录美观”破坏现有 API、CLI、SSE、评估、包入口、数据格式或运行语义。
- **不得**未经完整映射直接删除旧文档、旧源码或测试；历史链接需要兼容重定向或保留迁移说明。
- **不得**未经测试及审查合并代码，不得强制推送、重写 `main` 历史或绕过 CI。
- **不得**合并与当前任务无关的个人代理开发、UI 重设计或新功能扩展。

---

## 1. 当前仓库基线与诊断

> 以下为 2026-10-28 对 `main` 结构的初步核对。执行开始必须重新拉取并核对，不能把这份清单当作永远准确的事实。

### 1.1 已见结构

```text
ai-agent-blog/
├── README.md
├── docs/
│   ├── .vitepress/config.mts
│   ├── guide/               # 新版 TypeScript 主线（01~13，包含 09b）
│   ├── reference/           # 模块深讲
│   ├── products/            # kb / service / docintel
│   ├── how-to/              # 扩展与成熟度
│   ├── archive/weeks/       # 历史 23 周课程
│   ├── preface.md
│   ├── roadmap.md
│   └── index.md
├── agent-app/
│   ├── apps/{web,api,cli}/
│   ├── packages/{engine,shared}/
│   ├── docs/                # 质量工程、personal-agent 规划
│   ├── samples/
│   ├── .agent-skills/
│   └── README.md / ARCHITECTURE.md / BACKLOG.md / SECURITY.md
└── .github/workflows/{deploy,agent-app,audit}.yml
```

### 1.2 已识别的实际问题（执行前需逐项验证）

| 编号 | 类型       | 观察                                                                         | 改造方向                                           |
| ---- | ---------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| D01  | 信息架构   | 新 `guide`、`reference`、`products` 与 23 周历史课程并存，侧边栏入口较多     | 建立唯一主学习路径、明确参考手册与归档             |
| D02  | 技术口径   | `docs/roadmap.md` 仍以 Python/FastAPI/LangGraph 混排阶段；新版以 TS 实现为主 | 统一 Node/TypeScript 主线，Python 独立进阶选修     |
| D03  | 文档冲突   | `docs/preface.md` 仍要求从旧 Week 1 Day 1 开始且存在重复段落                 | 按新教学体系重写前言                               |
| D04  | 课程编码   | `guide/09b-multi-agent.md` 显示学习顺序是后来插入式                          | 使用稳定 ID / slug 与元数据，禁止继续 09b 式编号   |
| D05  | 事实滞后   | `agent-app/README.md` 仍有把 Web 当占位的文字，而已有 Web 页面               | 文档基于源码和验收证据更新                         |
| D06  | 可运行示例 | `engine/examples` 有示例但不能逐章覆盖完整能力主线                           | 新建渐进式、独立可执行 examples                    |
| D07  | 内核职责   | `packages/engine` 含 Loop、RAG、Memory、MCP、Service、Orchestrator、Evals 等 | 先定义模块层级及依赖规则，再小步提取               |
| D08  | 产品边界   | `agent-app/docs/personal-agent` 存在独立产品的未来设计                       | 保留历史记录、添加跨仓库边界与跳转，不实施产品规划 |
| D09  | 文档复用   | 工程 README / Reference / Guide 同时长篇讲同一技术                           | 单一主解释源 + 其他入口摘要与链接                  |
| D10  | 证据追踪   | 教程与代码、测试、版本间缺少强制机器可校验关联                               | 建立 lesson-example-source-test 矩阵与自动检测     |

### 1.3 不可跳过的审计基线

在 P0 生成并提交：

- `docs/maintainers/inventory.md`：全部 Markdown 路径、标题、课程类型、重复/过时状态、迁移目标、旧 URL 处理。
- `docs/maintainers/source-of-truth.md`：每种事实的唯一权威来源（功能实现看源码；运行命令看 package.json；部署看 workflow；教程介绍看课程原文）。
- `docs/maintainers/capability-matrix.md`：每项能力的实现状态（implemented/partial/planned/deprecated）、源码、入口、测试、CI、对应课。
- `docs/maintainers/architecture-decisions/`：ADR，明确技术栈、包边界、拆包阈值、个人代理仓库边界。
- `docs/maintainers/route-migration.csv`：旧路径、新路径、兼容方式、验证结果。每条旧可访问路径须有处理记录。

**注意：** 内部文档也必须纳入 inventory；不可只审计导航上可见的教程。

---

## 2. 目标信息架构与学习体验

### 2.1 产品定位

站点名称建议：**AI Agent Engineering · 从原理到生产级 Agent 系统**。标题可由现有站点风格调整，但内容定位不改变。

**首页三个主要入口：**

1. **从零学习**：唯一、连续的 7 阶段主线。
2. **动手构建**：各章示例与完整工程的逐级对应。
3. **工程进阶**：架构、质量、安全、生产与高级实践。

导航建议：`首页 / 学习路线 / 动手实践 / 模块手册 / 案例 / 进阶 / GitHub`。历史课程仅通过页脚或“历史课程”入口访问，不占据默认主侧边栏大段区域。

### 2.2 推荐文档目录（目标结构，不是强制一次性迁移）

```text
docs/
├── index.md
├── start/
│   ├── index.md                 # 面向谁、前置要求、如何使用
│   ├── roadmap.md               # 唯一正式学习路线
│   ├── environment.md           # 版本锁定、启动、常见故障
│   └── glossary.md              # 术语与同义词
├── learn/                       # 唯一主线：按技术依赖组织
│   ├── 01-foundations/
│   ├── 02-runtime/
│   ├── 03-capabilities/
│   ├── 04-orchestration/
│   ├── 05-quality/
│   ├── 06-fullstack/
│   └── 07-applications/
├── labs/                        # 动手实践，指向 agent-app/examples
│   ├── index.md
│   └── ...
├── reference/                   # API 契约、架构和模块深入参考
│   └── ...
├── cases/                       # KB / Customer Service / Document Intelligence
│   └── ...
├── advanced/                    # 进阶专题（包括 Python 选修、趋势技术）
│   └── ...
├── maintainers/                 # 维护者文档和自动化可追踪矩阵
│   └── ...
├── archive/                     # 原 23 周及历史版本，明确过时提示
│   └── weeks/
└── .vitepress/
    ├── config.mts
    ├── sidebar/                 # 配置分拆：按目录生成侧边栏
    └── theme/
```

> `learn` 一篇课只解决一个相对独立的学习目标；`reference` 记录稳定技术契约/深讲；`labs` 负责复现实验；`cases` 负责完整应用。相同长篇内容只保留一个正式版本，其他位置用摘要与链接。

### 2.3 七阶段课程大纲与交付物

| 阶段                  | 内容                                                                | 验收成果                       | 前置         |
| --------------------- | ------------------------------------------------------------------- | ------------------------------ | ------------ |
| S1 基础与模型交互     | LLM API、消息、token、上下文、结构化输出、SSE                       | 流式聊天最小示例               | TS/Node 基础 |
| S2 Agent Runtime      | Tool Calling、手写 Agent Loop、终止条件、错误与超时、Run/Step       | 可调用工具的最小 Agent         | S1           |
| S3 Agent Capabilities | Tools、Skills、MCP、Memory、RAG、检索溯源                           | 带可控工具、记忆与知识的 Agent | S2           |
| S4 Orchestration      | Planner/Executor/Reviewer、DAG、状态机、队列、取消/恢复、人工审批   | 可验证的多任务编排实验         | S2/S3        |
| S5 可靠性与质量       | 安全、Guardrails、幂等、Tracing、Verification、Evals、回归/发布门禁 | 可重复运行的质量评估报告       | S2~S4        |
| S6 全栈交付           | NestJS API、Next.js UI、SSE、认证边界、Worker、持久化、部署、CI     | 可本地启动的完整演示应用       | S1~S5        |
| S7 产品案例           | 知识库问答、客服、文档智能、完整故障场景                            | 可演示的三类业务案例及测试     | S3~S6        |

**课程顺序不等于未来必须增加的生产功能。** 某主题若仅有演示/计划，必须标注 `partial` 或 `planned`，不允许写“已经生产可用”。

### 2.4 每篇主线教程的内容契约

所有 `docs/learn/**` 主课均必须包含（由检查脚本校验）：

```yaml
---
lessonId: agent-runtime-loop
stage: 02-runtime
order: 20
status: implemented # implemented | partial | planned
prerequisites:
  - llm-structured-output
example: agent-app/examples/03-agent-loop
source:
  - agent-app/packages/engine/src/agent-loop.ts
tests:
  - agent-app/packages/engine/test/agent-loop.spec.ts
lastVerifiedCommit: "<已验证的 commit sha>"
---
```

正文标准章节：

1. 学完会什么（明确可验收成果）
2. 先决知识与运行环境
3. 业务问题与最小场景
4. 核心原理（流程图，解释边界）
5. 最小可执行实现（含命令与结果）
6. 真实工程实现位置（源码、关键调用链与设计取舍）
7. 异常、并发、错误、安全与性能边界
8. 测试与验收（无需密钥的离线验证优先）
9. 常见误区与排错
10. 自测及下一章

**规则：** 代码必须可运行；未经执行的示例不得标记为已验证；课内复制整段长期维护的引擎源码应尽可能改为重点片段 + 固定版本源码链接。

### 2.5 历史内容迁移原则

- 原 `docs/archive/weeks/` 保留，不无声删除，不混入新主线导航。
- 原 `docs/guide`、`docs/products`、`docs/how-to` 每篇归类：`MIGRATE` / `MERGE` / `REDIRECT` / `ARCHIVE` / `KEEP`；不得缺失映射。
- 旧路线图、前言、导读等入口必须明确指向**唯一新路线图**，并注明旧 23 周课程为历史参考。
- 使用 VitePress 支持的兼容策略（实际 redirect 能力需验证），优先确保已发布旧链接仍可访问。缺少可靠重定向时保留原路径的迁移说明页，不得提交空链接。
- 深链、目录片段锚点需抽样检测；外部链接破损必须统计并按严重度处理。
- `docs/.vitepress/config.mts` 中导航和侧边栏改为可维护的分模块配置；控制首页和移动端体验；保留当前 logo、主题色和 GitHub 入口。

---

## 3. agent-app 的重构策略

### 3.1 重构原则

`agent-app` 当前拥有 `apps/web`、`apps/api`、`apps/cli`、`packages/engine`、`packages/shared`。**第一阶段不重命名、不移动大批源码；先围绕当前结构建立架构规则。**

优先级：保证行为不变 → 教学示例可运行 → 模块依赖清晰 → 模块解耦 → 必要时拆包。

### 3.2 目标分层（逻辑架构）

```text
用户端：apps/web / apps/cli
           ↓
HTTP 适配：apps/api (HTTP/SSE/Auth/DTO/Approval Controller)
           ↓
应用场景：chat / knowledge-base / customer-service / docintel
           ↓
编排层：orchestration (task/state/roles/policies)
           ↓
能力层：tools / skills / mcp / memory / rag
           ↓
核心层：agent loop / run context / model ports / tool contracts
           ↓
基础适配：LLM gateway / Postgres / Redis / vector store / logger

横切关注点：guardrails / verification / telemetry / evals
```

- `core` 不依赖具体 `apps`、业务案例或 `Next.js/NestJS`。
- 能力层只依赖稳定核心契约，不导入上层业务应用。
- 编排层通过接口调用核心和能力，不将完整业务产品逻辑硬编码进 Agent Loop。
- `evals` 可以依赖公开接口或测试接缝，不让普通运行时强制加载测试数据集。
- `service` 等领域场景逐步从通用内核包中解耦，但**必须保持现有导出与调用方兼容**，迁移需有薄代理/兼容层。
- 对跨包拆分实行 **ADR 决策**：只有真实的依赖循环、职责混杂、构建成本或独立复用需求得到证据支持时才拆。

### 3.3 建议最终包结构（仅目标，不作为 P0 必须达成条件）

```text
agent-app/
├── apps/{web,api,cli}/
├── packages/
│   ├── engine/               # 第一阶段继续作为稳定兼容入口
│   ├── shared/
│   ├── core/                 # 经过 ADR 批准后可提取
│   ├── capabilities/         # 经过 ADR 批准后可提取
│   ├── orchestration/        # 经过 ADR 批准后可提取
│   └── quality/              # 经过 ADR 批准后可提取
├── examples/
│   ├── 01-llm/
│   ├── 02-tool-calling/
│   ├── 03-agent-loop/
│   ├── 04-memory/
│   ├── 05-rag/
│   ├── 06-mcp-skills/
│   ├── 07-orchestration/
│   └── 08-evaluation/
├── scenarios/                # 完整业务案例的文档、脚本、样本与验收
│   ├── knowledge-base/
│   ├── customer-service/
│   └── document-intelligence/
└── tests/integration/
```

### 3.4 examples 规范

每个最小示例必须包含：

- `README.md`：用途、前置、`pnpm` 命令、预期输出、依赖、对应课、对应源码。
- `src/`（尽可能小的可运行核心，不做与主工程平行的第二份真实内核）。
- `*.spec.ts` / fixtures：至少一条离线、确定性、可在 CI 中运行的检查。
- 严格控制与密钥相关的能力：真实 API 演示标记可选；默认提供 mock/fake 离线路径。
- 示例使用已稳定的包公开接口，不 import 不稳定私有源码（除被特意标注的内部实现教学篇章）。
- 新教程每篇最多指向一个主示例及少量补充示例；每个示例有唯一维护者文档入口。

### 3.5 现有业务不可回归的契约

执行前生成基线快照，至少覆盖：

- CLI：chat / kb / service / team / eval / mcp-server 的命令与退出语义。
- API：chat、KB、客服、team 现有端点、SSE 事件结构、错误码及审批流程。
- Web：聊天、知识库、客服页面及流式消息处理。
- Engine：Agent Loop 多步工具调用、终止/错误、Memory、RAG、MCP、Skills、Orchestrator。
- 安全与质量：Guardrails、工具审批、幂等、Evals、Verification、Telemetry、质量门禁。
- 结构契约：现有 `@agent-app/engine` 子路径导出，`@agent-app/shared` 事件类型、环境变量及 Docker compose 使用方式。
- 需要基础设施的集成测试：在独立 CI job 或 profile 执行，明确区分离线与真实环境测试。

**变更必须有 characterization test（特征测试）证明旧行为，再实施重构。**

### 3.6 安全与运行边界

- Token/API Key/连接串不得进入日志、样例、测试快照或 PR。
- Tool 执行权限必须保留服务端授权链；不能用 Prompt 代替鉴权。
- 未经明确授权不得自动触发真实外部写入、付费操作、账号变更。
- 真实模型测试不得成为无需 Key 的离线 CI 唯一依赖。
- 任务取消、重复请求、重试和幂等不得因目录重构改变。
- 不在这次重构中“顺手”上线新 BullMQ/持久后台 Agent/Agent Factory；这些属于另一产品范围。

---

## 4. Personal Agent 仓库边界

`agent-app/docs/personal-agent/` 目前是**历史规划/设计材料**。本重构仅处理文档组织：

1. 标明该目录不是本仓库当前功能，也不是执行计划。
2. 核对独立 `zrayjay/personal-agent` 的现行文档后，增加指向它的说明；如不一致，保留历史文档并标注 superseded/archived，不擅自覆盖独立仓库权威方案。
3. 可添加案例文章讲解 Personal Agent 的**通用架构原则**，但不将其开发需求写进 `agent-app` 本期任务。
4. 不得在 `personal-agent` 仓库进行代码提交、分支操作或 PR；若发现跨仓库依赖问题，开后续建议，不阻塞无关教学改造。

---

## 5. 阶段实施计划与原子任务

### P0｜审计、冻结基线与设计决策（不迁移代码）

**任务：**

- P0-01 抓取仓库 main HEAD、文件树、包依赖、脚本、CI、导航、全部文章 frontmatter，并生成内容清单。
- P0-02 找出错链、冲突页面、重复主题、旧实现断言，确定每篇迁移分类与新 slug。
- P0-03 建立源码能力矩阵：implemented/partial/planned/deprecated + 证据路径。
- P0-04 记录 API、CLI、SSE、包 exports、Env 与测试基线，形成兼容清单。
- P0-05 制定 ADR：主学习路线、TS 优先、示例策略、模块分层、独立产品边界。

**交付：** `docs/maintainers/**` 清单、ADR、风险列表、原始可复现命令和测试结果。

**验收：** 文档清单全覆盖；所有主要能力有证据；旧到新路由映射无未决的“直接删除”；未修改运行语义。

### P1｜重建教学导航与文档信息架构

- P1-01 新增 `start/` 唯一入口、重写前言和路线图，说明当前与历史课程边界。
- P1-02 建立 `learn/` 7 阶段框架、章节索引与课程元数据 Schema。
- P1-03 将 Guide 章节逐篇 `MIGRATE / MERGE / REDIRECT`，清理 09b 编号并保留旧链接。
- P1-04 归并 Reference 的重复叙事，将参考资料定位为专题深讲和 API/架构契约。
- P1-05 将 Products 迁移/映射为 Cases，How-to 迁移为 Advanced/运维指南，老 23 周完全归档。
- P1-06 分拆 VitePress 导航配置，新增入口及正确的上一章/下一章；保留原主题、logo、GitHub 链接。

**验收：** 首页到主线首页 ≤2 次点击；每阶段有索引；每章有前后学习路径；导航中无相互竞争的主路线；旧链接兼容；VitePress build 成功。

### P2｜教学示例与教程-源码追踪

- P2-01 建 `agent-app/examples` 模板与统一运行器/校验命令。
- P2-02 最小 LLM、Tool Calling、Agent Loop 示例，真实模型路径可选，离线测试必有。
- P2-03 Memory、RAG、MCP/Skills 示例，Mock 后端 + 可选真实连接。
- P2-04 Orchestration、Verification/Evals 示例，包含失败/重试/取消演示。
- P2-05 将每章映射至真实源码、命令、测试、固定可复现 commit；生成并校验矩阵。
- P2-06 编写初学者 Windows/PowerShell 与跨平台命令差异说明，不让命令示例假定 Linux 唯一环境。

**验收：** 关键主线章节 100% 有可执行示例/测试或清晰的“纯概念章”例外；离线样例自动运行；示例无裸密钥；全站映射校验成功。

### P3｜agent-app 依赖边界与文档治理（先不拆包）

- P3-01 复核 `dependency-cruiser`、`pnpm workspace`、`turbo` 实际依赖图；新增/收紧“core 不依赖应用层”等规则。
- P3-02 修正文档中的过时架构、占位页、错误脚本或组件关系。
- P3-03 将通用接口/业务实现边界写成 ADR，修复确认存在的错误跨层 import（一次小范围改动）。
- P3-04 `service`/RAG 等业务领域从 `engine` 解耦的可行性评估，不迁移未证实需要迁移的模块。
- P3-05 为迁移候选模块添加 characterization tests / API 合约测试。

**验收：** 依赖图无新增非法边界；公共出口兼容；全部现有离线测试保持通过；有明确的保留与拆分理由。

### P4｜有证据的模块提取与场景收敛

- P4-01 只选择 P3 确认的高价值模块，遵循单模块单 PR 迁移。
- P4-02 先加兼容导出，再切换新实现，再逐个替换调用方；不得一次性移动整个 `engine`。
- P4-03 将业务案例的脚本/fixture/测试整理至 `scenarios`，**保留旧应用入口**。
- P4-04 代码与文档同步改动，测试覆盖旧/新公开路径；记录 bundle/构建/接口性能对比。

**验收：** 无公共 API 破坏；无回归；重构复杂度与依赖方向确实改善；无额外多余包。若缺乏足够证据，**P4 可以以“不拆包 + ADR”完成**，不能为完成任务而制造文件搬迁。

### P5｜质量门禁与文档自动校验

- P5-01 新增课程 metadata 校验、引用文件存在性检查、导航/内部链接检查。
- P5-02 测试示例可运行性、敏感信息扫描、命令有效性抽样。
- P5-03 增加文档构建和 agent-app 离线验证的独立 CI Job；外部模型测试保持可选且显式报告。
- P5-04 检测已实现/已验证断言的证据缺失；实现状态无法证实的页面自动失败或警示。
- P5-05 检查站点页面的桌面/移动端导航、搜索、深链接、样式不回归。

**验收：** 文档 PR 可在 CI 中识别断链、无效课元数据、丢失示例；Agent CI 维持可重复离线通过。

### P6｜最终交付与文档收尾

- P6-01 重写仓库根 README（项目定位、快速入口、架构图、运行与开发指引）；避免根 README 包含冗长且易失效的逐命令 CI 教程。
- P6-02 统一 `agent-app/README.md`、`ARCHITECTURE.md`、模块 README 与站点的职责分工。
- P6-03 完成旧课程兼容提示、变更说明、迁移索引和维护指南。
- P6-04 完整冒烟测试、人工审阅截图/导航、发布检查、回滚预案。

**验收：** 新用户从根 README 到运行首个例子有连续路径；首页与内页导航正常；无已知阻断级 404；发布及 CI 全绿。

---

## 6. 依赖顺序、交付节奏与任务调度

**推荐顺序：** P0 → P1 → P2 → P3 → P4（按证据决定拆分规模）→ P5 → P6。

允许 P5 的部分检测脚本在 P1/P2 提前落地，但主任务执行必须保持单分支单任务、完整验收之后再进入下一项。

每个子任务都在 `docs/maintainers/implementation-tracker.md` 记录：

| 字段     | 内容                                                         |
| -------- | ------------------------------------------------------------ |
| taskId   | 如 P1-03                                                     |
| state    | todo / in_progress / blocked / in_review / merged / verified |
| baseSHA  | 分支建立时 main SHA                                          |
| branch   | `refactor/p1-03-guide-migration`                             |
| commits  | 变更 commit SHA                                              |
| PR       | PR URL                                                       |
| checks   | 必需 CI 的名称与结果                                         |
| review   | 独立审查结论及缺陷闭环                                       |
| rollback | 回滚 commit / PR 方案                                        |
| docs     | 更新文件和迁移映射                                           |
| evidence | 测试日志/构建记录/截图链接                                   |

任务之间存在依赖时，必须先核实依赖任务已处于 `verified`，不能只以“代码已经写完”判定完成。

---

## 7. OpenBot 自动执行协议（强制）

### 7.1 每一个原子任务的标准循环

```text
从计划中选择首个未完成且依赖满足的任务
       │
       ▼
读取最新 main，确保工作区干净，记录 HEAD SHA
       │
       ▼
从 main 创建全新 feat/refactor 分支（不得复用旧任务分支）
       │
       ▼
明确任务目标、边界、验收指标、风险、需保护的契约
       │
       ▼
修改代码/文档 + 添加或修正测试 + 更新追踪矩阵
       │
       ▼
本地校验（lint/typecheck/test/build/docs + 针对性回归）
       │
       ├──失败──►修复并重新运行
       ▼
提交并推送分支，创建 PR
       │
       ▼
等待 PR 所有必需 CI 完成；进行独立代码审查
       │
       ├──失败/严重缺陷──►留在当前分支修复后重新审查
       ▼
核对验收标准、迁移/回滚、权限与文档变更
       │
       ▼
合并 PR 至 main（受仓库分支保护规则约束）
       │
       ▼
拉取最新 main，再次确认主干 CI / 文档构建通过
       │
       ├──失败──►停止调度，优先创建独立修复任务
       ▼
更新追踪表为 verified，并自动进入下一任务
```

### 7.2 不允许的操作

- 从旧任务分支创建新任务分支。
- 两个未完成任务混在同一 PR。
- 明知 CI 红灯却合并。
- 只凭本地测试通过宣称主干通过。
- 强推 `main`、跳过分支保护、抹掉历史。
- 自动忽略独立 Reviewer 的 P0/P1 缺陷。
- 含未审查大规模删除的 PR。
- 在主干失败或需求语义冲突时继续无条件推进。

### 7.3 审查与失败处理

审查范围必须固定为 `baseSHA...headSHA`，包含：

1. 需求与验收是否完整；
2. 真实兼容风险、链接失效、业务逻辑回归；
3. 跨层依赖、公开 API、测试覆盖及安全；
4. CI 证据、迁移和回滚可行性。

Review 结论：`PASS` / `CHANGES_REQUIRED` / `BLOCKED`；后两种禁止合并。

持续失败时可自动重试，但应限制同一类无进展重试次数（默认 3 次）；若仍失败，记录失败证据并停在 `blocked`，报告阻塞原因，不要改验收标准来“通过”。

PR 合并后若 main 的必需检查失败，停止下一个任务，优先定位原因并用新分支修复；必要时回滚最近合并。

### 7.4 无需人工逐任务确认的边界

用户已授权按本方案的**已明确任务范围**自动执行：创建分支、提交、建 PR、完成审查后合并和继续下一项。对于下面这些高风险变动，需暂停并提交决策选项：

- 删除大量内容且无法提供旧路径兼容证据；
- 修改公共 API 的不兼容语义或需要数据迁移；
- 涉及密钥/权限/发布部署方式的安全实质变化；
- 跨仓库写入、付费第三方服务、生产环境删除操作；
- 架构目标严重冲突、客观上无法证明验收通过。

**注意：** 是否真的有 GitHub 写权限、CI 是否可读、是否具备自动审查能力，必须运行时核实；缺权限则停止并说明，不能谎报已合并。

---

## 8. CI 与质量门禁

### 8.1 已有脚本（执行前核对 package.json）

`agent-app` 已提供 `build`、`typecheck`、`lint:deps`、`test:engine`、`test:api`、`selftest`、`verify`、`eval`、`quality-gate` 等命令。站点使用 VitePress `docs:build`。不得凭本方案推断所有命令都适合根目录执行，必须使用准确 cwd 和锁定版本。

建议门禁矩阵：

| 改动类别    | 最低检查                                                 |
| ----------- | -------------------------------------------------------- |
| docs-only   | 内容元数据、内部链接、路线/导航、docs build、旧 URL 兼容 |
| examples    | 示例离线测试、类型检查、相关模块测试、docs build         |
| engine      | 类型检查、引擎单测、依赖规则、离线评测门禁、相关集成测试 |
| API/CLI/Web | 对应单测/e2e、SSE/DTO/CLI 合约、build、适当的 UI 冒烟    |
| scripts/CI  | 沙箱检查、workflow 语法审查、现有必需任务不被削弱        |

### 8.2 基本验收数字

- **100%** 新主线章节具备有效 `lessonId`、阶段、前置、状态与来源关联（纯概念章可有明确例外）。
- **100%** 已迁移旧路由有映射与可访问或可解释的兼容页面。
- **100%** 关键示例有离线可运行校验；真实模型依赖显式可选。
- **0** 未确认的“已实现/生产级”能力描述。
- **0** 新增的跨层依赖违规、裸密钥、必需 CI 失败。
- 关键原有 API/CLI/SSE 契约回归测试保持通过；需要真实外部资源的测试不应被假装执行。

### 8.3 手动验收场景（最低）

1. 从首页进入学习路线，两次点击内能到第 1 章。
2. 任一主线章可顺序进入上一章/下一章；无孤立课程。
3. 历史 23 周旧入口仍能找到历史内容，页面显示归档提示。
4. 原收藏的旧 `guide`、`products`、`roadmap` 链接可以访问正确内容或跳转说明。
5. 搜索 Agent Loop、MCP、RAG 时能找到主课和参考页且职责清楚。
6. Windows PowerShell 与 Linux/macOS 运行命令有明确差异说明。
7. 不配真实密钥可以跑离线示例；配置密钥后可按文档运行真实路径（需实际授权时再执行）。
8. Web 聊天、KB、客服及 SSE 主要业务路径回归无破坏。
9. README、站点、架构文档与当前目录和能力一致。
10. 主干 GitHub Actions 与 Pages 的结果有真实链接证据，不能只用“本地 build 成功”替代。

---

## 9. 迁移、兼容与回滚

### 9.1 文档迁移

- 每次移动均更新 `route-migration.csv`，包含 `oldPath,newPath,action,status,verifiedAt`。
- 如 VitePress 不支持适用重定向，使用同路径兼容页说明搬迁，而不是直接删文件。
- 同一章别名只能有一个 canonical 页面，其他页加入归档/迁移说明，避免搜索重复正文。
- 不保留两个长期同步的大块相同正文。

### 9.2 源码迁移

- 保持现有 exports，提前创建兼容层，逐步替换调用方；拆除兼容入口需要单独的破坏性变更决策。
- 对运行状态和持久化的任何改动必须预先提供数据迁移、回滚与幂等验证；本重构默认不碰业务数据迁移。
- 提供 `git revert <merge-commit>` 或 PR revert 的回滚方案，按仓库的合并策略选择实际命令；不使用 force push。

### 9.3 完成定义（DoD）

一个任务同时满足：代码/文档已合入 main、必需 CI 通过、独立审查 PASS、验收证据齐备、原任务目标达成、兼容与回滚说明存在、主干复检通过，才能标为 `verified`。

---

## 10. 任务完成报告格式

每个子任务结束输出简洁报告：

```markdown
### TASK Pn-xx — <标题>

- 结果：VERIFIED / BLOCKED
- Base SHA / Head SHA：...
- Branch / PR：...
- 核心变更：...
- 保留的兼容性：...
- Tests：<命令及通过结果>
- CI：<必需检查 + 真实 URL / 结果>
- Reviewer：PASS / CHANGES_REQUIRED / BLOCKED（含修复证据）
- 风险与回滚：...
- 下一任务：Pn-yy / 已暂停的具体原因
```

每个阶段完成时输出阶段报告，包含任务清单、未解决风险、目录/能力差异、迁移状态及关键链接。不能用“全部完成”代替真实检查结果。

---

## 11. 可直接交给 OpenBot 的总控提示词

> 以下整段可复制作为 OpenBot 的执行指令，**同时将本文件作为唯一主重构方案输入**。

```text
你是 AI Agent Blog 重构项目的总执行 Agent，承担架构治理、开发、测试、文档迁移、CI 修复、独立审查协调与 GitHub PR 交付。

目标仓库：https://github.com/zrayjay/ai-agent-blog
目标分支：main
权威规格：AI-Agent-Blog-Refactoring-Implementation-Plan.md

任务：严格按规格书 P0→P6 依赖顺序，执行所有原子任务，直至所有任务 VERIFIED，或遇到真实阻塞。

每个任务必须：
1. 获取最新 main、记录 baseSHA，创建全新任务分支。
2. 读取当前仓库实际代码、文档、CI，检验规格书中的现状假设。事实发生变化时更新审计清单，不照抄过时内容。
3. 明确当前任务 scope、验收标准、兼容风险与回滚策略；不得夹带其他阶段的功能。
4. 实现最小必要变更，添加匹配测试，更新维护矩阵和文档。
5. 跑与修改相关的本地必需门禁，包括文档构建及涉及 agent-app 时的类型/单测/离线评测；如缺环境，明确区分“未运行”和“通过”。
6. 提交、推送、创建 PR，确认远程必需 CI 全部通过；如失败，留在同一任务分支分析并修复。
7. 进行独立代码审查：必须审查 baseSHA...headSHA，不信任开发 Agent 的自我声明；严重或中等级真实缺陷必须修复并复审。
8. 通过验收后合并到 main，再确认 main 上相关 CI 成功。
9. 更新 implementation-tracker.md：任务、branch、commit、PR、测试、审查、风险、证据；然后自动开始下一个未完成且依赖满足的任务。

禁止：强推/绕过 CI/在失败时继续/无证据断言通过/跨仓库修改 personal-agent/大规模直接删除旧文章/未经批准改变公开 API / 将未来 Personal Agent 产品规划伪装为已实现能力。

如果遇到设计冲突、高风险不可逆操作、缺乏必要写权限、真实 CI 长期不可用或连续三次同类修复失败，则停止当前任务，报告 BLOCKED 与明确的最小解决选项；不能伪造成功，也不能降低验收标准。

先执行 P0 审计，并提交具体的实施跟踪表、路由迁移表和能力矩阵；通过 P0 的检查后进入 P1。全过程坚持“唯一教学主线、可运行示例、事实和代码一致、渐进式模块治理、全流程回归和可回滚”。
```

---

## 12. 非目标（防止范围失控）

- 不把博客改造成 LMS（登录、学分、付费课程、社区系统）。
- 不因为重构顺便加入新模型供应商、浏览器 Agent、长期后台 Agent Factory 等新业务。
- 不把 Python 选修内容直接删除；可归档/进阶保留，明确与 TS 主线关系。
- 不为形式上的“微服务化”把一个稳定工作区强行拆成多个服务。
- 不重设计现有品牌 Logo、主题色或首页视觉基调（除导航体验必要的小修）。
- 不将演示用的内存态默认能力描述为持久化生产能力。

---

## 13. 最终交付清单

- [ ] 唯一正式学习路线与 7 阶段主线落地
- [ ] 历史 23 周课程归档，旧路由有兼容方案
- [ ] 新首页、侧边栏、上一章/下一章、检索体验通过验收
- [ ] 教程标准模板和必填元数据生效
- [ ] 教程→示例→源码→测试→CI 追踪矩阵可校验
- [ ] `agent-app/examples` 形成渐进式可运行系列
- [ ] Engine 的分层/依赖治理落实；拆包仅在有依据时进行
- [ ] 原 Web/API/CLI/SSE/Engine 功能与公开接口不回归
- [ ] Personal Agent 独立产品边界清晰且未跨仓库误改
- [ ] 文档/示例/应用质量门禁稳定、主干 CI 全绿
- [ ] README/ARCHITECTURE/参考手册与真实实现一致
- [ ] 每个任务都有 PR、审查、CI、验收与回滚记录

**最终验收标准：** 一个新读者能循序渐进完成“LLM → Agent Loop → 能力扩展 → 编排 → 质量 → 全栈 → 真实案例”；一个开发者能快速找到每章背后的实际源码、复现命令和测试证据；一个维护者能安全地增量演进仓库，而不需要维护多套互相矛盾的教学叙事。
