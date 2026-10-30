# P6-04 · 发布检查报告（冒烟 / 人工审阅口径 / 回滚预案）

- 状态：Current（2026-10-31 执行）
- 关联任务：P6-04（本文件即其交付物）；上位依据：方案 P6-04「完整冒烟测试、人工审阅截图/导航、发布检查、回滚预案」、§10 任务完成报告格式（rollback 列约定）

## 1. 完整冒烟测试（2026-10-31 @2eb4c92 全部实跑，14 项）

### agent-app 侧（零网络口径）

| 检查                                   | 结果                                                   |
| -------------------------------------- | ------------------------------------------------------ |
| `pnpm build`（shared→engine→api 拓扑） | ✅（turbo 缓存命中）                                   |
| `pnpm selftest` 引擎零件自检           | ✅ 13/13，零网络请求                                   |
| `pnpm --filter @agent-app/engine test` | ✅ 445 passed / 33 skipped（infra 无 Docker 自动跳过） |
| `pnpm --filter @agent-app/api test`    | ✅ 94 passed                                           |
| `pnpm examples:check`                  | ✅ 7 示例结构完整 + spec 全过                          |
| `pnpm matrix:check`                    | ✅ 12 课映射一致                                       |
| `pnpm lint:deps`                       | ✅ 124 modules 0 violations                            |
| `pnpm typecheck`                       | ✅ 全包通过                                            |

### 站点侧

| 检查                                | 结果                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `pnpm docs:check`                   | ✅ 12 learn 页 schema 合规、1451 正文 + 244 导航链接可达                    |
| `pnpm security:check`               | ✅ 598 文件无密钥样式、34/34 命令有效                                       |
| `pnpm assert:check`                 | ✅ 65 页面 6 断言段、0 警示                                                 |
| `pnpm docs:build`                   | ✅ 49.1s                                                                    |
| `node scripts/p5-05-site-check.mjs` | ✅ 275 md→html、249 导航、搜索工件、276 页 viewport/1653 资源抽样、404 兜底 |
| `node scripts/p0-check.mjs`         | ✅ 315 md 全覆盖、tracker 一致                                              |

## 2. 人工审阅口径（导航/搜索/深链接/样式）

方案 P6-04 要求人工审阅——本报告给出**机检已完成的部分**与**需真机浏览器完成的清单**，避免把机检冒充人工：

### 机检已覆盖（以上 §1 全部 + 线上深链接探测）

线上可达性（`rayjay.is-a.dev` 自定义域名，2026-10-31 实测 curl -L）：

| 路径                                               | HTTP | 覆盖面                                           |
| -------------------------------------------------- | ---- | ------------------------------------------------ |
| `/`（经 301 自 github.io）                         | 200  | 首页三入口                                       |
| `/learn/` `/start/`                                | 200  | 主线入口                                         |
| `/advanced/evolution` `/reference/README`          | 200  | 进阶/参考库                                      |
| `/archive/weeks/week01/` `/cases/customer-service` | 200  | 归档/案例                                        |
| `/guide/01-llm-basics` `/products/kb`              | 200  | **旧路径兼容跳转页**（P6-03 兼容提示的线上实证） |
| `/maintainers/migration-and-maintenance`           | 200  | 维护指南                                         |
| 首页 `<title>`                                     | —    | 「从模型调用到 Agent 工程」正确                  |
| viewport meta                                      | —    | 在位（响应式基础件）                             |

### 需真机浏览器完成的清单（人工审阅待办，不阻塞本报告）

1. 桌面 + 移动端各过一遍：首页 hero/统计/阶段卡片渲染、侧边栏折叠展开、当前页高亮定位（Layout.vue 双 rAF 滚动逻辑）
2. local search 弹窗：搜「工具循环」「RAG」「审批」各返回结果、点击跳转
3. 深色模式切换 + 代码块配色
4. 旧路径跳转页点击「现在的位置」实际落达新页
5. 移动端窄屏侧边栏抽屉与正文可读性

（此清单在浏览器会话中逐项打勾即完成人工审阅；机检面已保证结构性与链接性无回归。）

## 3. 发布检查

- **CI 三流水线**（main @2eb4c92 系列逐轮）：`agent-app`（test/evals/platform-store 三 job）success、`docs`（六步门禁）success、`Dependency audit` success——全部绿。
- **Pages 部署**：`Deploy VitePress site to Pages` success（P5 期与 P6 期多轮稳定）；线上 9 路径探测全 200（见 §2）。
- **发布物完整性**：dist 275 html = 274 md 页 + 404（site:check R1 精确闭环）；搜索索引 hashmap 274 entries 与页面数一致（P5-05 审查员实测）。
- **无 Secret 依赖**：全部 workflow 零 Secret（Pages OIDC、evals 无 key 跳过口径）。

## 4. 回滚预案

### 站点（Pages）

- 部署失败 = 旧版本继续在线（deploy-pages 只在 build+artifact 成功后替换），天然无损回滚位。
- 需要回退**内容**：`git revert <合并提交> && git push` → deploy.yml 自动重建旧版并发布（本项目全部任务为 PR 合并，逐 merge commit 可独立 revert，无交叉 revert 依赖）。
- 自定义域名故障：经 DNS/用户主站重定向页恢复（github.io 原地址已被重定向页接管，非仓库操作可切回）；主回滚路径（revert + Pages 自动重建）不受域名影响。

### agent-app（消费方）

- 回滚单位 = PR 合并提交（单模块单 PR 约定保证 revert 不牵连）：`git revert <merge>` 后 CI 全链重跑即验证。
- 导出面兼容由 compatibility-baseline §4 + lint:deps 守护：任何 revert 后跑 `pnpm lint:deps && pnpm matrix:check` 即确认契约未破坏。
- 数据层：默认存储均为进程内存/本地文件（`.data/` 不进 git）——回滚无持久化迁移负担；PG/pgvector 为可选基础设施，切换由 env 控制（compatibility-baseline §5）。

### 全项目回滚锚点

- 重构起点基线：`docs/maintainers/baseline.md`（P0-01 存档）。
- 逐任务 rollback 列：[implementation-tracker.md](./implementation-tracker.md) 每行含该任务合并提交号，35 任务全部 verified（2026-10-31；其中 P2-06 内容早已随 PR #32 交付、tracker 行在本 PR 内补闭——收官审查发现状态与内容交付脱节，如实记载）。

## 5. 结论

冒烟测试 14 项（agent-app 8 + 站点 6）全绿（已知遗留：api 套件偶发不稳定——P4-04 审查发现 3 跑 1 次 93/94 负载超时特征，本日 2 跑全绿，见 tracker P4-04 行）、线上 9 路径探测全 200、CI 三流水线稳定、回滚预案有明确单位与锚点——**发布条件成立**。人工审阅清单（5 项真机浏览器项）留待人工执行，机检面无已知阻断。
