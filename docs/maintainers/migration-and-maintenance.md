# 迁移索引与维护指南（P6-03）

- 状态：Current（2026-10-31 收敛）
- 关联任务：P6-03（本文件即其交付物之一）；上位依据：方案 P6-03「旧课程兼容提示、变更说明、迁移索引和维护指南」、ADR-0001（唯一主线与归档）、ADR-0002（TS 主线）

## 1. 旧课程兼容提示（现状声明）

- **23 周历史课程**：`docs/archive/weeks/`（161 篇 + 加餐）原貌保留、不再更新；归档索引页含范围/定位/与主线关系表；ArchiveBanner 提示条已按用户裁决下线（2026-10-30，索引页声明足够）。
- **旧 guide 13 站**：`docs/guide/` 全部文件为迁移兼容跳转页（「已迁移」+ 新位置表 + 旧链接兼容），正文在 `docs/learn/`。
- **旧 preface / roadmap / how-to**：同为跳转页或迁移说明页；`docs/roadmap.md` 标注「历史，已归档」并指向新路线图。
- **`docs/products/`**：kb/service/docintel 三页为跳板页，正文在 `docs/cases/`（kb/service）与阶段 07（service-product-line）；docintel 为 Python 教学叙事，无 TS 实现背书、不设状态（lesson-schema §案例行）。
- 旧路径兼容由 VitePress 构建这些跳转页保证；`docs:check`（P5-01）全站链接校验 + `site:check`（P5-05）导航可达性持续守护。

## 2. 变更说明（重构改了什么）

一期重构（P0→P6）把多套并行体系收敛为唯一主线的工程化教学体系：

| 变更       | 旧                                          | 新                                                                                           |
| ---------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 学习入口   | guide 13 站 + 23 周课程 + products 多轨并行 | `start/` 唯一入口 → `learn/` 七阶段能力主线                                                  |
| 课程元数据 | 无契约                                      | lesson frontmatter（lessonId/status/source/tests/lastVerifiedCommit），`docs:check` 强制校验 |
| 教学示例   | engine/examples 2 个旧示例                  | `agent-app/examples/` 01~07 渐进系列（每例离线 spec，`examples:check`）                      |
| 课↔码追踪  | 无                                          | 映射矩阵（`matrix:check`）+ capability-matrix（能力↔证据↔CI）                                |
| 依赖治理   | engine 单包无分层规则                       | dependency-cruiser 10 条规则（124 modules 0 violations），ADR-0004 不拆包裁决                |
| 文档门禁   | 仅 docs:build                               | docs CI workflow：p0-check/docs:check/security:check/assert:check/site:check 五道            |
| 根 README  | 「23 周通关」叙事 + 逐命令 CI 教程          | TypeScript 主线定位 + 快速入口 + 四 CI 流水线表（P6-01）                                     |

完整决策链见 [architecture-decisions/](./architecture-decisions/ADR-001-learning-architecture.md)（ADR-0001~0006）；逐任务证据见 [implementation-tracker.md](./implementation-tracker.md)。

## 3. 迁移索引

- **路线迁移表**：[route-migration.csv](./route-migration.csv)（39 行：MIGRATE/MERGE/KEEP/DELETE-empty 逐路径旧→新映射与状态）。2026-10-31 已按实际完成态校准——全部 MIGRATE/MERGE 行的旧路径现均为兼容跳转页（逐行实证），空目录清理完成；12 条 decided 行为「原样保留」类决策（archive/weeks 分批、engine 内置示例保留等）。
- **路由兼容机制**：旧 URL 经跳转页 HTML meta/正文链接到新位置（VitePress 1.6.3 无内置重定向，ADR-0001 已核实）；`docs/guide/`、`docs/preface.md`、`docs/roadmap.md`、`docs/products/` 四组跳转页由 `site:check` 的导航可达性持续验证。

## 4. 维护指南

### 日常改动

| 改什么                           | 走哪                                                                                 | 校验                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 学习内容（learn/advanced/cases） | 对应目录新建/编辑 md；lesson 需含 frontmatter 契约                                   | `docs:check`（断链/元数据）+ `assert:check`（断言证据）              |
| 导航/侧边栏                      | `docs/.vitepress/sidebar/*.mts` 与 config.mts                                        | `docs:check` + `site:check`（构建后导航可达）                        |
| 新增 md 文件                     | 同 PR 内从仓库根跑 `node scripts/p0-audit.mjs --update` 入册                         | `p0-check`（**已知坑**：漏跑即 CI FAIL——本项目三次踩坑后固化此协议） |
| agent-app 代码                   | 单模块单 PR；导出面变更先读 [compatibility-baseline §4](./compatibility-baseline.md) | `matrix:check` + `lint:deps` + vitest（agent-app CI 全链）           |
| 依赖变更                         | 更新 lockfile                                                                        | audit workflow PR 级自动审计                                         |

### 本地校验命令

```bash
# 站点侧（仓库根）
pnpm docs:check      # 结构 + 断链 + 导航（P5-01）
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
- **根 README**：当前不在 docs 门禁扫描内（P6-01 审查 NOTE-1），链接准确性靠人工——后续可考虑纳入 docs.yml paths。
- **触发重评**：拆包/迁移类决策的触发条件见 [p4-01 评估](./p4-01-module-extraction-assessment.md)（仓库外复用方/构建耗时/lint:deps 新循环）。

### PR 流程（本项目约定）

新分支 → 交付 + `--update` 入册 → 全部相关门禁 → PR → 独立代码审查（范围固定 baseSHA..HEAD）→ 修复 → 复审 PASS → 合并 → 主干复验（本地门禁 + CI 三流水线 + Pages）→ chore 分支回填 verified → 删除已合并分支。
