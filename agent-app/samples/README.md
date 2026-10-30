# samples/ · 业务案例样本索引

完整业务案例的样本与夹具。每个样本标注消费方与运行命令；案例的正文文档在站点
`docs/learn/07-applications/`，验收在测试套件（engine `test/`、api `test/`）。

## 知识库问答案例（KB）

| 样本             | 用途                            | 消费方                                                                                                                                                   | 运行                                                                                                      |
| ---------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `company-faq.md` | 入库样例：演示用 mock 制度 FAQ  | `apps/api/src/kb/kb.controller.ts`（注释示例）、`apps/api/src/kb/dto.ts`（example）、`packages/engine/test/hardening.spec.ts`（良性入库对照）、根 README | `pnpm kb:ingest ./samples/company-faq.md` 或 `curl -F "file=@samples/company-faq.md" :3000/api/kb/ingest` |
| `dummy.pdf`      | PDF 入库样例（走 pdf 解析路径） | 根 README（命令示例）                                                                                                                                    | `pnpm kb:ingest ./samples/dummy.pdf`                                                                      |

## 编排案例（Orchestrator）

| 样本             | 用途                               | 消费方                                                         | 运行                                                  |
| ---------------- | ---------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| `team-plan.json` | 静态任务单：三角色编排的 plan 输入 | `apps/cli/src/apps/team/cli.ts`（`--plan` 输入与格式错误提示） | `pnpm cli team --plan samples/team-plan.json --trace` |

## 安全红队案例（Red Team）

> 全部为**编造的安全实验夹具**（复盘中保留源文件），详见 `SECURITY.md` 对应载荷节。
> 实验入库后须清理：`npx tsx scripts/redteam-cleanup.mjs`（默认按 poisoned-note/pii-note 关键字）。

| 样本                        | 用途                                              | 消费方                                                                                                                | 运行                                                        |
| --------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `red-team/poisoned-note.md` | 提示投毒载荷：验证入库闸整篇拒收                  | `packages/engine/test/hardening.spec.ts`（硬路径引用，H1 用例）                                                       | `pnpm --filter @agent-app/engine exec vitest run hardening` |
| `red-team/pii-note.md`      | 形状合法的假 PII 联系人卡片：验证 PII 出境脱敏    | `SECURITY.md` §PII 载荷、`scripts/redteam-cleanup.mjs`（默认清理关键字）、`test/kb-search.spec.ts`（同名 docId 断言） | 手工复现步骤见 SECURITY.md                                  |
| `red-team/evil-server.mjs`  | 零依赖 JSON-RPC MCP 服务器：工具投毒/注入攻击模拟 | `SECURITY.md` §MCP 红队节                                                                                             | `pnpm chat --mcp "node samples/red-team/evil-server.mjs"`   |

## 维护约定

- 新样本入列须同步本索引：样本名、用途、消费方（文件级）、运行命令四列齐全。
- 测试对样本的引用使用仓库根相对路径（`join(REPO_ROOT, "samples", ...)`）——移动样本会破坏测试，先改引用再动文件。
