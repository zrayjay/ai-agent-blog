# P0-02 内容冲突、错链与迁移分类审计

基线：`7600320`（P0-01 verified 后的 main）。本文记录 2026-10-28 的只读审计发现与处置分类；实施迁移在 P1 各任务执行，不在本任务内改动正文。

## 审计方法与可复现命令

- 内部链接扫描：遍历 `docs/**.md` 全部 markdown 链接，按 VitePress 规则解析根相对/文档相对路径（含 `.md` 后缀与 `index.md` 目录回退）。初版扫描计 1209 个链接中 0 个真实断链；独立复核扫描（含外链、行内代码排除口径不同）计 1210 条，"0 真断链"结论经两套扫描器交叉确认。
  - 唯二"断链"是误报：`docs/archive/weeks/week18/day5.md:183` 与 `docs/reference/06-guardrails.md:75` 代码块内的正则字面量 `(?<!\d)\d{17}[\dXx](?!\d)` 被当作链接语法。属扫描器已知局限，不修文档。
- 旧账号链接：`git grep -o "1648298170" 7600320 -- docs` → 17 个文件 34 处（基线口径；在含本审计文档的 HEAD 上为 18 文件 35 处）。均 301 重定向到 `zrayjay` 后 200 可达（已实测 2 个样本）。处置：P1 迁移触达各文件时统一替换为 `zrayjay` 相对路径或站内链接；不单独发 PR。
- 线上可达性抽查（2026-10-28，自定义域名 `rayjay.is-a.dev`，VitePress 清洁 URL 不带 `docs/` 前缀）：`/guide/01-llm-basics`、`/guide/09b-multi-agent`、`/preface`、`/roadmap`、`/reference/README`、`/how-to/EXTENDING`、`/products/kb`、`/archive/weeks/week01/` 均 200。
- 首页锚点：`/#learning-path` 在部署站渲染后存在（自定义主题 Home 渲染 `id="learning-path"`），非死锚。

## 发现清单

### F1 错链（阻断级）

无。VitePress `ignoreDeadLinks` 仅豁免 localhost；build 实测通过佐证。

### F2 事实滞后 / 旧实现断言

| 编号 | 位置                                | 断言                                                      | 实际                                                                                                                                                                  | 处置                                                                 |
| ---- | ----------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| F2-1 | `agent-app/README.md:88` 目录树注释 | `web/ # 占位：week20 Next.js 前端`                        | `apps/web` 已是完整 Next.js 应用（app/kb、app/service 页面 + 8 个组件（components/ 下 .tsx 共 12 个，另 4 个为页面/布局），含 ApprovalCard/HandoffCard/StepPanel 等） | P3-02 修正目录树注释；README 正文第 3 节已如实描述 Web，无冲突       |
| F2-2 | `docs/guide/01-llm-basics.md:5`     | "状态：迁移填充中"，正文仅素材链接                        | 该章为唯一未填充章；其余 12 章已是连贯叙述                                                                                                                            | P1-03 迁移时填充正文；填充前保留素材链接与状态声明（未虚假声明完成） |
| F2-3 | `docs/preface.md:29,31`             | —                                                         | 整段重复（"一项软性前置，比技术更硬：**时间**……"两段实质重复，仅引号字形差异）；开头引导从旧 Week 1 Day 1 开始                                                        | P1-01 重写前言，按新教学体系组织                                     |
| F2-4 | `docs/roadmap.md` 全篇              | 23 周路线图（阶段三含 Python/FastAPI/LangGraph 主线混排） | 与 TS 主线 13 站并存，构成 D02 双路线冲突                                                                                                                             | P1-01：归档为历史，新 `start/roadmap.md` 为唯一路线                  |
| F2-5 | `docs/guide/index.md`               | 双轨路径说明（已带"新主线已上线"提示）                    | 定位已过时但指向正确                                                                                                                                                  | P1-01 并入新路线图历史边界节                                         |

### F3 重复主题（同一内容多入口）

- **guide vs reference**：01/02 章（LLM、循环）等在 guide 已精简为教学叙事 + 指向 reference 深读，重复可控；reference 各篇是逐行走读，定位符合方案 §2.2（保持 KEEP）。
- **guide vs archive 补篇**：`week11/agent-loop-ts`、`week16/evals-ts` 等补篇与 guide 02/08 章存在同源内容；archive 保留原样，guide 为主入口（canonical），不双向同步。
- **products 三篇**：教学叙事完整，P1-05 迁为 cases 后原路径留兼容页。
- **orchestrator README ↔ reference/10**：`agent-app/packages/engine/src/orchestrator/README.md` 已是指向 reference/10 的摘要 + 链接，无大块重复。

### F4 编码与结构问题

- **F4-1** `guide/09b-multi-agent.md` 插入式编号（D04）。P1-03 重编为 04-orchestration 阶段章节，旧 slug `/guide/09b-multi-agent` 保留兼容页。
- **F4-2** 空目录：`docs/guide/{loop,memory,rag}`（git 不跟踪，本地残留）、`docs/technical`（已删）。无链接指向，无兼容负担。
- **F4-3** 侧边栏"开始"区（`config.mts:70-79`）指向旧双轨/23 周，与新主线并列构成 D01 多主路线。P1-06 分拆导航时收敛。

## 迁移分类汇总（权威表）

见 `route-migration.csv`（同目录）。原则：guide 13 章 → learn 7 阶段；products → cases；how-to → advanced；roadmap/preface/guide-index → start；reference 与 archive KEEP。每行含 planned 阶段标签，迁移完成后回填 verifiedAt。

## 未决事项

- VitePress 1.6.3 无内置重定向；旧路径兼容统一采用"原路径保留迁移说明页"策略（方案 §9.1），P1-03/05 逐篇落地。
- 外链健康检查（站外 URL 批量探测）不在本任务范围，P5-02 敏感信息与命令有效性检查一并抽样。
