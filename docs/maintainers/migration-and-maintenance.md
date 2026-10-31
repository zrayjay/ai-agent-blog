# 迁移索引与维护指南（P6-03 + 二期清理）

- 状态：Current（2026-11-01 二期清理后）
- 关联任务：P6-03 交付物；2026-11-01 二期清理（旧体系整体下线）后重写 §1/§3
- 上位依据：方案 P6-03、ADR-0001（唯一主线；「原样归档」策略已被用户二期裁决取代——彻底删除，git 历史即存档）、ADR-0002（TS 主线）

## 1. 旧体系现状声明（二期清理后）

**旧体系已整体下线（2026-11-01）。** 以下内容已从仓库删除，旧 URL 访问返回 404（git 历史可考，任何旧内容可通过历史 commit 找回）：

| 已删除                               | 原内容                      | 正文去向                                                                         |
| ------------------------------------ | --------------------------- | -------------------------------------------------------------------------------- |
| `docs/archive/weeks/`（194 篇）      | 23 周按天课程 161 篇 + 加餐 | 概念与实现已融入 `learn/` 各站与 `reference/`                                    |
| `docs/guide/`（15 篇）               | 旧 13 站主线 + 双轨指南     | `learn/` 七阶段 12 课                                                            |
| `docs/products/`（3 篇跳板）         | kb/service/docintel 产品页  | `cases/`（kb/service）与阶段 07；docintel 为 Python 叙事，无 TS 实现背书，未保留 |
| `docs/how-to/`（2 篇跳板）           | EXTENDING/MATURITY          | `advanced/extending.md`、`advanced/maturity.md`                                  |
| `docs/preface.md`、`docs/roadmap.md` | 旧前言、旧 23 周路线图      | `start/index.md`、`start/roadmap.md`（唯一正式路线）                             |

当前站点只含干净的重构内容：`start/` 入口、`learn/` 七阶段主线、`reference/` 模块深讲、`advanced/` 进阶、`cases/` 案例、`maintainers/` 维护文档。守护链不变：`docs:check`（P5-01）全站链接校验 + `site:check`（P5-05）导航可达性——任何指向已删页面的残留链接会被 CI 拦截。

## 2. 变更说明（重构改了什么）

### 一期重构（P0→P6，2026-10-28 ~ 10-31）

把多套并行体系收敛为唯一主线的工程化教学体系：

| 变更       | 旧                                          | 新                                                                                           |
| ---------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 学习入口   | guide 13 站 + 23 周课程 + products 多轨并行 | `start/` 唯一入口 → `learn/` 七阶段能力主线                                                  |
| 课程元数据 | 无契约                                      | lesson frontmatter（lessonId/status/source/tests/lastVerifiedCommit），`docs:check` 强制校验 |
| 教学示例   | engine/examples 2 个旧示例                  | `agent-app/examples/` 01~07 渐进系列（每例离线 spec，`examples:check`）                      |
| 课↔码追踪  | 无                                          | 映射矩阵（`matrix:check`）+ capability-matrix（能力↔证据↔CI）                                |
| 依赖治理   | engine 单包无分层规则                       | dependency-cruiser 8 条规则（124 modules 0 violations），ADR-0004 不拆包裁决                 |
| 文档门禁   | 仅 docs:build                               | docs CI workflow：p0-check/docs:check/security:check/assert:check/site:check 五道            |
| 根 README  | 「23 周通关」叙事 + 逐命令 CI 教程          | TypeScript 主线定位 + 快速入口 + 四 CI 流水线表（P6-01）                                     |

### 二期清理（2026-11-01）

| 变更     | 旧（一期态）                        | 新（二期态）                                      |
| -------- | ----------------------------------- | ------------------------------------------------- |
| 旧课程   | archive/weeks 161 篇原样归档        | **彻底删除**（git 历史即存档），旧 URL 404        |
| 旧页面   | guide/products/how-to 跳转页兼容    | **删除**，不再保留兼容层                          |
| 首页     | 主 CTA 指向 guide 跳转页            | Hero 主 CTA 指 `/start/`，全部组件指向 learn 新址 |
| 侧边栏   | 归档 197 links vs 主线 47 links     | 仅主线（main.mts 单文件）                         |
| 搜索     | local search 索引含全部旧日课       | 仅索引重构内容                                    |
| 课文表述 | 「第 N 周」「归档周教程」等历史指称 | 「0N 站」式站内指称，全部正文自足不依赖旧内容     |

完整决策链见 [architecture-decisions/](./architecture-decisions/ADR-001-learning-architecture.md)（ADR-0001~0006；其中「原样归档」策略已被二期用户裁决取代）；逐任务证据见 [implementation-tracker.md](./implementation-tracker.md)。

## 3. 迁移索引

- **路线迁移表**：[route-migration.csv](./route-migration.csv)（一期 39 行 MIGRATE/MERGE/KEEP/DELETE + 二期 6 行 DELETE，全部 done）。二期行记录旧体系整体删除；一期迁入的新位置（learn/reference/cases/advanced/start）即当前唯一内容。
- **路由兼容**：二期起不再提供跳转兼容层——旧 URL 直接 404。若外部引用需要溯源，使用 GitHub 历史 URL 形式：`github.com/zrayjay/ai-agent-blog/blob/<commit-sha>/docs/archive/...`。

## 4. 维护指南

### 日常改动

| 改什么                           | 走哪                                                                                                                   | 校验                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 学习内容（learn/advanced/cases） | 对应目录新建/编辑 md；lesson 需含 frontmatter 契约；**正文代码片段逐字摘自 examples/src**（见 lesson-schema 片段规范） | `docs:check`（断链/元数据）+ `assert:check`（断言证据）              |
| 导航/侧边栏                      | `docs/.vitepress/sidebar/main.mts` 与 config.mts                                                                       | `docs:check` + `site:check`（构建后导航可达）                        |
| 新增 md 文件                     | 同 PR 内从仓库根跑 `node scripts/p0-audit.mjs --update` 入册                                                           | `p0-check`（**已知坑**：漏跑即 CI FAIL——本项目三次踩坑后固化此协议） |
| agent-app 代码                   | 单模块单 PR；导出面变更先读 [compatibility-baseline §4](./compatibility-baseline.md)                                   | `matrix:check` + `lint:deps` + vitest（agent-app CI 全链）           |
| 依赖变更                         | 更新 lockfile                                                                                                          | audit workflow PR 级自动审计                                         |

### 本地校验命令

```bash
# 站点侧（仓库根）
pnpm docs:check      # 结构 + 断链 + 导航（P5-01，含根 README）
pnpm security:check  # 密钥扫描 + 命令有效性（P5-02）
pnpm assert:check    # 能力断言证据（P5-04）
pnpm site:check      # 构建产物回归（P5-05，含 build）
node scripts/p0-check.mjs  # 审计清单一致性（改 md 必跑）

# agent-app 侧（agent-app/ 内）
pnpm matrix:check    # 课↔示例↔源码↔测试映射（P2-05）
pnpm lint:deps       # 依赖分层规则（P3-01）
pnpm examples:check  # 示例结构 + 离线 spec（P2-01）
```

### 已知边界与备忘

- **tracker 人工字段**：`--update` 从磁盘现状解析并保留人工列；`<name>` 类裸 HTML 标记写入 tracker 需转义（`&lt;`），否则 docs:build 的 Vue 编译失败（P5-02/P6 期实测）。
- **跨文档锚点**：agent-app 与站点分属不同构建体系，手工锚点 slug 可能与 VitePress 渲染不一致（P6-02 复审 NOTE-3）——锚点仅作辅助，正文链接一律指向页面。
- **CRLF**：仓库 `core.autocrlf=true`，工作树 EOL 噪声为已知假象（blob 相同即无变更）；格式以 HEAD blob + prettier 为准。
- **根 README**：已纳入 docs.yml paths 与 p5-01 C3 链接扫描（2026-11-01，P6-01 NOTE-1 闭合）。
- **触发重评**：拆包/迁移类决策的触发条件见 [p4-01 评估](./p4-01-module-extraction-assessment.md)（仓库外复用方/构建耗时/lint:deps 新循环）。

### PR 流程（本项目约定）

新分支 → 交付 + `--update` 入册 → 全部相关门禁 → PR → 独立代码审查（范围固定 baseSHA..HEAD）→ 修复 → 复审 PASS → 合并 → 主干复验（本地门禁 + CI 三流水线 + Pages）→ chore 分支回填 verified → 删除已合并分支。
