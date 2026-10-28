# 运行环境

> 版本锁定、一次性搭建步骤、按症状排错。目标：10 分钟内跑通第一个离线示例，不需要任何 API 密钥。

## 版本要求

| 工具    | 版本                       | 说明                                                  |
| ------- | -------------------------- | ----------------------------------------------------- |
| Node.js | **≥ 18.18**（推荐 22 LTS） | `agent-app/package.json` `engines` 字段锁定；CI 用 22 |
| pnpm    | **11.17.x**                | `packageManager` 字段锁定；corepack 自动对齐（见下）  |
| Git     | 任意近期版本               | Windows 建议 Git Bash 或 PowerShell 均可              |
| Docker  | 可选                       | 仅 `pnpm stack:up` 全栈与基础设施集成测试需要         |

版本对齐方式（推荐，免手动装 pnpm）：

```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
```

> 教程命令默认跨平台书写；Windows PowerShell 与 POSIX shell 的差异只在盘符路径与少数内建命令，遇到差异时本文会双列给出。

## 一次性搭建

```bash
git clone https://github.com/zrayjay/ai-agent-blog
cd ai-agent-blog/agent-app
pnpm install
pnpm build        # shared → engine → api 按依赖拓扑构建（web/cli 免构建或独立构建）
```

验证安装（全程零网络、零密钥）：

```bash
pnpm selftest     # 引擎零件 13 项自检：切块器 / 余弦检索 / 会话存储等
pnpm typecheck    # 全 workspace 类型检查
```

两步都通过即环境就绪。

## 第一个可运行示例

```bash
pnpm examples:minimal
```

这是一个 40 行的最小 Agent：模型自己决定调用几次天气工具。**无密钥时会打印清晰的配置错误提示而不崩溃**——这就是预期行为；想看完整效果需在 `agent-app/.env` 配置 OpenAI 兼容网关：

```bash
Copy-Item .env.example .env   # PowerShell；POSIX 用 cp .env.example .env
# 编辑 .env 填入 OPENAI_API_KEY（默认接智谱 GLM 网关，见 .env.example 注释）
pnpm chat                     # 聊天 REPL；/exit 退出、/new 新会话
```

密钥属个人资产：不进 git、不进日志、不进测试快照。没有密钥也能完成主线大部分学习（见下「离线 vs 真实」）。

## 离线 vs 真实路径

| 能力                           | 离线（无密钥）                                     | 真实（需密钥/基础设施）              |
| ------------------------------ | -------------------------------------------------- | ------------------------------------ |
| 工具循环、记忆、RAG 链路       | `pnpm selftest` + engine 单测（vitest，mock 模型） | `pnpm chat` / `pnpm kb`              |
| 评测 Tier 1（轨迹/路由）       | `pnpm eval`、`pnpm quality-gate --gate-policy ci`  | Tier 2/3（检索/评审，需 key）        |
| pgvector / Redis / MCP dogfood | 不运行（自动 skip）                                | `pnpm infra:up` 后 `pnpm test:infra` |
| 全栈 Web                       | 不适用                                             | `pnpm stack:up`（compose 四容器）    |

教程各站标注了当站命令属于哪类；CI 只跑离线路径。

## 常见故障（按症状）

**`pnpm install` 报 lockfile 不一致**
lockfile 与 package.json 不同步。不要手改 lockfile：在 `agent-app/` 下重跑 `pnpm install` 让 pnpm 报出具体包，确认是预期依赖变更后提交更新的 `pnpm-lock.yaml`。

**`pnpm build` 后 CLI 仍报找不到 `@agent-app/engine`**
`cli` 用 tsx 直跑源码，但 `api`/`web` 消费 `dist` 产物。先确认在 `agent-app/` 目录执行过 `pnpm build`（不是仓库根），再重试。

**`pnpm chat` 启动后首次对话报配置错误**
`.env` 缺失或字段不完整。默认网关是智谱 GLM（`OPENAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4`）；换其他 OpenAI 兼容网关时三件套（KEY/BASE_URL/MODEL）都要改。

**PowerShell 里 `cp` 不生效**
PowerShell 的 `cp` 是 `Copy-Item` 别名，行为一致；若用 cmd 则改用 `copy`。路径含空格时整体加引号。

**Docker 相关命令全部失败**
`infra:up`/`stack:up` 需要本机 Docker daemon 运行中。没装 Docker 不影响主线学习：所有离线测试与 REPL 均不依赖容器。

**中文乱码（Windows 终端）**
PowerShell 7+ 或 Windows Terminal 默认 UTF-8 无此问题；老版 conhost 执行 `chcp 65001` 后重开。

## 站点文档本地预览（可选）

```bash
cd ..            # 回到仓库根
pnpm docs:dev    # VitePress 开发服务器，默认 http://localhost:5173
```

## 下一步

环境就绪 → [学习路线图](/start/roadmap)了解全程 → [第 01 站](/guide/01-llm-basics)开始学习。
