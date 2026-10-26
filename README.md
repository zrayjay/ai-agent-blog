# AI Agent 全栈工程师 · 23 周通关教程（博客项目）

配套《企业级 AI Agent 全栈工程师 · 23 周每日执行手册》的 VitePress 博客教程。

手册负责"每天做什么"，本博客负责"怎么学会"——每天一篇保姆级教程：概念讲解 + 可运行代码 + 踩坑实录 + 自测题。

## 项目架构总览（基于当前代码）

本仓库是**教程文档 + 可运行 Agent 工程**的双主线项目：`docs/` 通过 VitePress 组织学习内容；`agent-app/` 是 pnpm workspace Monorepo，提供 TypeScript Agent 引擎、Next.js Web、NestJS API、CLI 和可选的持久化基础设施。下方矢量架构图基于仓库**已有能力及其接线**制作，并保留分模块的文字说明与源码链接；不将演进路线误标为已上线功能。

### 1. 整体技术架构与功能流程图

[![AI Agent 全栈工程师项目架构与流程总览](./docs/public/images/ai-agent-architecture-overview.svg)](./docs/public/images/ai-agent-architecture-overview.svg)

> 点击图片可查看放大的矢量架构图；图片包含仓库双主线、运行时分层架构、Chat / RAG / 客服 / 多 Agent 流程、MCP / Skills、安全机制、质量工程闭环和 CI 发布流程。详细模块说明与源码链接见下文。


| 目录 | 核心职责 | 深入阅读 |
| --- | --- | --- |
| `docs/` | 主线教程 `guide/`、模块参考 `reference/`、产品 `products/`、旧版按周教程 `archive/` | [教程首页](./docs/index.md) |
| `agent-app/apps/web/` | Next.js 对话、知识库、客服页面，使用 SSE 显示执行步骤和答案 | [Web README](./agent-app/apps/web/README.md) |
| `agent-app/apps/api/` | NestJS REST/SSE BFF、数据校验、限流、审批、Team 端点 | [应用说明](./agent-app/README.md) |
| `agent-app/apps/cli/` | Chat、KB、Service、Team、Eval、MCP Server 命令入口 | [应用说明](./agent-app/README.md) |
| `agent-app/packages/engine/` | Agent Loop、工具、RAG、记忆、编排、MCP、Skills、质量工程 | [架构详解](./agent-app/ARCHITECTURE.md) |
| `agent-app/packages/shared/` | Web 与 API 共用的事件和业务类型 | [Shared README](./agent-app/packages/shared/README.md) |
| `agent-app/docs/` | 质量工程方案、审计及落地说明 | [质量工程方案](./agent-app/docs/AGENT-QUALITY-ENGINEERING.md) |
| `.github/workflows/` | 教程站发布和 Agent 应用 CI 门禁 | [工作流目录](./.github/workflows/) |

### 2. 教程文档的构建与发布


文档配置位于 `docs/.vitepress/config.mts`。站点工作流和 Agent 项目质量工作流相互独立。

### 3. Chat 对话：会话与 SSE 流式响应


- Web 端用 `fetch + ReadableStream` 消费事件；`step` 描述工具步骤，`token` 描述最终回复片段。
- API 的非流式 `POST /api/chat` 不提供挂起式审批；如果 `AGENT_CONFIRM_TOOLS` 配置了需要确认的工具，应使用 SSE 流式入口。
- 参考：[Chat Service](./agent-app/apps/api/src/chat/chat.service.ts)、[Chat Controller](./agent-app/apps/api/src/chat/chat.controller.ts)。

### 4. Agent 核心：手写 Tool Loop


模型只收到去掉 `execute` 的工具 Schema，**模型点名，代码执行**。执行阶段可以通过外层组合工具适配器、审批、幂等与安全包装；`onStep` 和 `onEvent` 用于追踪。参考：[agent-loop.ts](./agent-app/packages/engine/src/agent-loop.ts)。

### 5. 知识库 RAG：入库与检索问答


RAG 存储接口支持内存/JSON 快照和 PostgreSQL + pgvector 切换；引用编号由后端检索结果生成，而不是交给模型虚构。参考：[RAG README](./agent-app/packages/engine/src/rag/README.md)。

### 6. 智能客服：Supervisor 分诊和 Handoff


硬规则优先于 LLM 分类，业务 Worker 使用最小工具权限。转人工的 `createTicket` 是 demo mock，不意味着对接了真实工单系统。客服还提供 `/api/service/stream` 推送 `route / step / token / handoff / done` 等事件。参考：[Service README](./agent-app/packages/engine/src/service/README.md)。

### 7. 多 Agent：任务拆分、DAG 调度和验收


支持状态机、依赖并行、验收闭环、失败策略和同 ID 续跑。**默认 `MemoryStateStore` 只在当前进程内存中保留状态**，跨进程恢复需要持久化实现。提供 CLI `pnpm team` 和 `GET /api/team/stream`；当前 Web 仅有对话、KB、客服三个页面，并无独立 Team 页。参考：[Orchestrator README](./agent-app/packages/engine/src/orchestrator/README.md)。

### 8. 三层记忆：会话、偏好和情景


这是**引擎支持的三类存储能力**，并不是说每个 API 端点都自动召回三层记忆。工厂配置通过 `SESSION_STORE`、`PREFERENCE_STORE`、`EPISODIC_STORE` 选择后端。参考：[Memory README](./agent-app/packages/engine/src/memory/README.md)。

### 9. MCP 和 Skills：工具能力与领域操作知识


**MCP 提供可调用的能力，Skills 提供使用能力的流程知识**。外部 MCP 工具和本地 Skills 目前主要在 CLI Chat 中装配，MCP Server 可通过独立命令启动，并非自动注册到每个 API。参考：[MCP README](./agent-app/packages/engine/src/mcp/README.md)、[Skills README](./agent-app/packages/engine/src/skills/README.md)。

### 10. 安全：Guardrails、审批与幂等


**不要把两条安全链路理解成所有入口默认统一执行的护栏**：`guardrails/gate.ts` 主要用于 CLI 外部 MCP 工具；API Chat 通过审批事件、登记簿和 HTTP 裁决挂起高危调用。API 的审批壳在幂等壳外面，拒绝不写入幂等缓存。参考：[Guardrails README](./agent-app/packages/engine/src/guardrails/README.md)、[Chat 工具装配](./agent-app/apps/api/src/chat/tool-assembly.ts)。

### 11. Agent 质量工程：验收、追踪、评测及门禁


`runWithVerification` 是**可选包装器**，不能理解成现有 API 已全面自动验收。运行成功与验收通过是两类不同结果。`pnpm eval` 和 `pnpm quality-gate` 以数据集、报告与策略检查质量；CI 必跑的是**离线 Tier 1** 门禁，不能误写成需要真实模型密钥的评测都已强制纳入 CI。参考：[质量工程实施文档](./agent-app/docs/AGENT-QUALITY-ENGINEERING.md)、[Evals README](./agent-app/packages/engine/src/evals/README.md)。

### 12. CI：站点发布与 Agent 工程测试


`.github/workflows/deploy.yml` 发布文档；`.github/workflows/agent-app.yml` 对应用触发构建、架构检查、离线测试和评测门禁。Agent CI 的 `test` 和 `evals` 是**两个独立 Job**。容器部署和基础设施启动参考 [agent-app README](./agent-app/README.md) 与 [docker-compose.yml](./agent-app/docker-compose.yml)。

---

## 本地运行

```bash
cd ai-agent-blog
npm install        # 或 pnpm install
npm run docs:dev   # 开发服务器 http://localhost:5173
```

## 构建

```bash
npm run docs:build     # 产出 docs/.vitepress/dist
npm run docs:preview   # 本地预览构建结果
```

## 目录结构

```text
ai-agent-blog/
├── README.md
├── docs/
│   ├── .vitepress/config.mts  # VitePress 站点配置
│   ├── guide/                # 主线教程
│   ├── reference/            # 模块深讲
│   ├── products/             # 产品实践
│   ├── archive/weeks/        # 旧版按周教程
│   ├── how-to/               # 扩展与成熟度指南
│   ├── index.md
│   └── roadmap.md
├── agent-app/
│   ├── apps/{web,api,cli}/   # Next.js / NestJS / CLI
│   ├── packages/{engine,shared}/
│   ├── docs/                 # Agent 质量工程资料
│   ├── docker-compose.yml
│   └── README.md
├── .github/workflows/       # 文档发布和应用 CI
└── package.json
```

## 如何扩展教程内容

1. 选择 `docs/guide/`（主线教程）、`docs/reference/`（模块深讲）、`docs/products/`（产品实践），或 `docs/archive/weeks/`（按周历史内容）。
2. 沿用相邻文档的写作结构，必要时链接到 `agent-app/` 的真实实现。
3. 在 `docs/.vitepress/config.mts` 更新导航与侧边栏。
4. 执行 `pnpm docs:dev` 本地预览和 `pnpm docs:build` 构建验证。

## 部署

当前采用 **GitHub Actions 自动部署到 GitHub Pages**（本仓库已配置 `.github/workflows/deploy.yml`）。

- **Vercel / Netlify（备选）**：导入仓库，构建命令 `pnpm docs:build`，输出目录 `docs/.vitepress/dist`

### deploy.yml 配置说明

整体流程一图流：

```text
push 到 main ──► checkout 代码 ──► 装 pnpm ──► 装 Node 22 ──► pnpm install
                                                                              │
线上访问 ◄── deploy-pages 发布 ◄── upload-pages-artifact 打包 ◄── vitepress build
```

#### 1. 触发条件

```yaml
on:
  push:
    branches: [main]     # 只有 main 分支的推送才触发部署
  workflow_dispatch: {}  # 允许在 Actions 页面手动点按钮重跑
```

#### 2. 权限声明（GitHub Pages 部署的核心）

```yaml
permissions:
  contents: read    # 读仓库代码
  pages: write      # 向 Pages 服务写入产物
  id-token: write   # OIDC 免密令牌
```

`id-token: write` 是关键：GitHub 会为工作流自动签发短期令牌，**全程不需要配置任何 Secret**——这是官方推荐的 Pages 部署方式（比老式的 PAT + gh-pages 分支方案安全，令牌用完即焚）。

#### 3. 并发控制

```yaml
concurrency:
  group: pages           # 所有部署共用一个"队列"
  cancel-in-progress: false  # 排队等待，不取消进行中的部署
```

连续快速 push 多次时，部署不会并发打架，也不会中途掐断正在发布的版本（掐断 = 线上可能半新半旧）。

#### 4. build 任务（构建产物）

| 步骤 | 作用 |
|------|------|
| `actions/checkout@v4` | 拉代码（`fetch-depth: 0` 取全历史，供"最后更新时间"类功能使用） |
| `pnpm/action-setup@v4` | 安装 pnpm——**自动读取 package.json 里的 `packageManager: "pnpm@11.17.0"`**，保证 CI 与本地同版本（这就是为什么之前要加这个字段） |
| `actions/setup-node@v4` | 安装 Node 22，并开启 **pnpm 依赖缓存**（命中后 install 从 ~40s 降到 ~3s） |
| `pnpm install --frozen-lockfile` | 严格按 lockfile 安装，lockfile 与 package.json 不一致时直接报错，杜绝"本地能跑 CI 挂" |
| `pnpm docs:build` | VitePress 构建，产出 `docs/.vitepress/dist` |
| `actions/upload-pages-artifact@v3` | 把 dist 打包成制品上传 |

#### 5. deploy 任务（发布上线）

```yaml
deploy:
  environment:
    name: github-pages
    url: ${{ steps.deployment.outputs.page_url }}
  needs: build                    # build 成功才执行
  steps:
    - uses: actions/deploy-pages@v4   # 把制品发布到 Pages
```

### 常见自定义

- **换默认分支**：`branches: [main]` 改成你的分支名
- **换 Node 版本**：`node-version: 22` 改掉即可（VitePress 要求 ≥18）
- **绑定自定义域名**：仓库 Settings → Pages → Custom domain 填入域名并加 DNS CNAME 记录；当前 `docs/.vitepress/config.mts` 已配置 `base: '/'`；只有部署到仓库子路径时才需改为 `base: '/ai-agent-blog/'`
- **看部署日志/重跑**：仓库 Actions 页 → 点对应运行记录 → 展开红色/黄色步骤

### 排错速查

| 症状 | 先检查 |
|------|--------|
| Actions 成功但 404 | 仓库 Settings → Pages → Build source 是否为 **GitHub Actions**；`config.mts` 的 `base` 是否与仓库名一致 |
| 页面出来了但样式丢失 | `base` 路径配错（F12 看 CSS 请求是否 404） |
| install 阶段失败 | 本地跑 `pnpm install` 后提交更新的 `pnpm-lock.yaml` |
| esbuild 相关报错 | `pnpm-workspace.yaml` 的 `allowBuilds: esbuild: true` 是否还在 |

> 顺带一提：这套 workflow 正是学习手册**第 7 周（Docker + CI/CD）** GitHub Actions 部分的实战案例，学到那周时可以回来对着真实项目读一遍。
