# P0-01 基线记录

- 基线：`8c8c0fc4789988973e16c8ed565223321634bd9c`；工作目录 `D:\JERRY\ai-agent-study\ai-agent-blog`。2026-10-28 执行 `git status --short --branch`、`git rev-parse HEAD main origin/main`，创建分支前 main 干净且三者相同。
- 所有 Git 跟踪 Markdown：基线 258；含本任务 4 个新增 Markdown 共 262。生成器 `scripts/p0-audit.mjs`：`--init <实施方案路径>` 为显式全量重建；`--update` 重新生成清单并按 taskId 保留追踪表人工字段；读取失败的输入会报路径与错误类别并不写任何输出。`node scripts/p0-check.mjs` 只读校验生成物、覆盖与追踪表一致性，不写文件。清单含内部文档；路径分类不等于内容审查，重复、过时、迁移及旧 URL 均待 P0-02。
- 跟踪文件树：`git ls-files`；包清单：根 `package.json`、`agent-app/package.json`、`agent-app/apps/{api,cli,web}/package.json`、`agent-app/packages/{engine,shared}/package.json`。详细依赖、exports、脚本以各文件为准，可执行 `node scripts/p0-package-baseline.mjs` 重现逐项快照。
- 独立 workspace 由 `agent-app/pnpm-workspace.yaml` 的 `apps/*`、`packages/*` 定义；`agent-app/turbo.json` 的 build/typecheck/test 依赖 `^build`，build 输出 `dist/**`、`.next/**`。安装版 turbo 2.11.5 文档 `docs/README.md` 与 `docs/core-concepts/package-and-task-graph.mdx` 已核对。
- 站点配置 `docs/.vitepress/config.mts`：顶部首页、学习路线、模块参考、扩展指南；侧栏并列开始、主线、参考、指南和旧版按周/Node/Python 归档；本任务未修改导航。

## CI 触发及保护

- `.github/workflows/deploy.yml`：push main、手动；build 执行根 `pnpm docs:build`，随后部署 Pages；不触发 PR。
- `.github/workflows/agent-app.yml`：main push 或 PR 且路径匹配 `agent-app/**` 或自身 workflow；test、evals、platform-store jobs。文档专用 PR 不触发。
- `.github/workflows/audit.yml`：main push、每周、手动；两个 workspace 的 `pnpm audit --audit-level high`；不触发 PR。
- 2026-10-28 `gh api repos/zrayjay/ai-agent-blog/branches/main/protection` 返回 404 `Branch not protected`；`gh api 'repos/zrayjay/ai-agent-blog/rulesets?includes_parents=true'` 返回空列表。以上是当时可见配置，非组织外部策略的保证；目前无可见必需状态检查。人工流程仍须要求 CI 与独立审查。
- 基线 Actions（仅该 SHA，非本 PR HEAD）：[agent-app](https://github.com/zrayjay/ai-agent-blog/actions/runs/40468196847)、[Pages](https://github.com/zrayjay/ai-agent-blog/actions/runs/40468196472)、[audit](https://github.com/zrayjay/ai-agent-blog/actions/runs/40468196530)，均 success。PR HEAD 的远程 docs 检查有缺口：建议协调者使用独立、只读的 PR HEAD 文档构建检查，保持部署 workflow 和已有门禁不变；本任务未改变 CI。

## 独立基线结果

Pi 在隔离快照的 tree `bed146bf186ad360c09a82ba6587071785c3cf80` 验证字节一致；Node v22.20.0、pnpm 11.17.0。报告及含 cwd、退出码的原始日志：`C:\Users\Administrator\OpenBot\Shared\p0-baseline\report\00-environment.md`、`C:\Users\Administrator\OpenBot\Shared\p0-baseline\logs\01…16`，报告 `C:\Users\Administrator\OpenBot\Shared\Transfers\807bf2d2-ae6e-48a8-a819-ace60efea705\01-baseline-report.md`。这些是基线而非本 PR 结果。

- 根 `pnpm docs:build` PASS；agent-app `pnpm -r build`、`pnpm typecheck`、`pnpm lint:deps`（0 违规）、`pnpm selftest`（13/13）、engine（436 pass、33 skip）、API（94 pass）、`pnpm eval`（18 pass、58 skip）、`pnpm quality-gate --gate-policy ci`、`pnpm verify` PASS。两 workspace high audit PASS；详细参数及工作目录见报告。
- 根 `pnpm format:check` 基线失败，506 文件；不在当前 workflow 中。P3/P5 应治理，不能用批量格式化或忽略目录掩盖。
- 基础设施集成、真实 Key 模型路径和手动浏览器验收 NOT RUN；跳过不等于通过。
- 本工作树曾误执行根 `pnpm exec vitepress build --help`，它实际启动未指定 docs 目录的构建并在 `docs/products/docintel.md:94` 解析失败。该非标准命令不是 `pnpm docs:build`，不证明正式构建失败；未更改原文件。

## 独立审查结论（P0-01）

2026-10-28 独立审查 `8c8c0fc..d3bf741`：**PASS**，0×P0/P1。4 个 P2 潜伏缺陷（当前数据不触发，须在引入含 `|` 的任务描述或含特殊字符的新路径前修复，移交 P0-02 前的审计脚本收口）：

1. `scripts/p0-audit-lib.mjs` `parseTrackerRows` 用 `split("|")` 不识别 `\|` 转义；若 tracker 出现转义管道符，`--update` round-trip 会错列。
2. `scripts/p0-check.mjs:78` 覆盖性检查用原始路径匹配，未经过 `cell()` HTML 实体转义；未来含 `_()[]*` 等字符的新路径会误报"清单缺少路径"。
3. `scripts/p0-package-baseline.mjs` 对缺失 package.json 无 try/catch，抛裸 ENOENT。
4. `describe()` 摘要过滤未排除 mermaid 围栏首行，`01-ARCHITECTURE.md` 摘录显示为 "flowchart TB"。

## 兼容与回滚

本任务只添加审计脚本和维护文档，不迁移旧 URL 或修改应用/配置。合并后按实际合并策略 revert 该任务的合并提交；不重写历史。P0-02 至 P0-05 均为待办，不能将计划视为已实现。
