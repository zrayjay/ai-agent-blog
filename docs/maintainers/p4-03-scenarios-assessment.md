# P4-03 · scenarios 收敛评估（结论：目录重组不实施，以「samples 结构化 + README 索引」最小收敛完成）

- 状态：Accepted（2026-10-30）
- 关联任务：P4-03（本文件即其交付物）；上位依据：方案 §3.3（目标结构 scenarios/knowledge-base|customer-service|document-intelligence）、任务原文「保留旧应用入口」、ADR-0004（不为目录美观制造搬迁）

## 任务要求与现状

方案 P4-03：将业务案例的脚本/fixture/测试整理至 `scenarios`，**保留旧应用入口**。目标结构（§3.3）为 `scenarios/{knowledge-base,customer-service,document-intelligence}/` 三个业务案例目录。

现状实测（2026-10-30）：

- `agent-app/samples/`（4 项）已在事实上承担「业务案例样本」职责：`company-faq.md`（KB 入库样例，api/cli 文档与 controller 注释引用）、`dummy.pdf`（PDF 入库样例，README 引用）、`team-plan.json`（编排器静态任务单，team/cli.ts 错误提示引用）、`red-team/`（3 件安全夹具：poisoned-note 被 hardening.spec 硬引用、pii-note 被 SECURITY.md §负载 与 redteam-cleanup.mjs 引用、evil-server.mjs 被 SECURITY.md MCP 红队节引用）。
- 业务案例的「文档」在站点侧已就位：`docs/learn/07-applications/`（service-product-line 等）；「验收」在测试侧已就位：engine 445 条 + api e2e 5 套件。
- 仓库内尚无 `scenarios/` 目录；无人引用该路径。

## 评估：三种路线对比

### 路线 A：按 §3.3 建 scenarios/ 三目录并搬迁样本 —— 否决

- 搬迁必改引用：hardening.spec.ts 的 `REPO_ROOT/samples/red-team` 硬路径、team/cli.ts 错误提示、api dto/controller 注释、README×2、SECURITY.md×2、inventory.md 清单行——**纯目录搬迁触碰 8+ 处文件**，其中含测试硬路径与错误提示文案（用户可见面）。
- 收益为零：三个「业务案例」的文档/脚本/测试当前各归其位（站点文档、samples 夹具、测试套件），没有纠缠需要解开；「scenarios/」只是同一物质换了个目录名。
- 违反 ADR-0004 精神（不为完成任务制造文件搬迁）与方案红线（不得为目录美观破坏现有语义）。**samples/ 路径本身即「旧应用入口」的组成部分**——任务原文要求保留它。

### 路线 B：scenarios/ 目录只放 README 指针，实体不动 —— 否决

- 指针层无消费方：无人 `import`/读取 scenarios/ 路径；空壳目录违反「避免多余包/目录」（P4 验收：无额外多余包）。

### 路线 C（采纳）：最小收敛——samples/ 结构化 + README 索引节

1. `samples/README.md` 新建：按「业务案例 → 样本 → 消费方 → 运行命令」索引 4 项样本（KB 案例：company-faq/dummy.pdf；编排案例：team-plan.json；安全红队案例：red-team/ 三件），每个样本标注被谁引用、如何使用——把「散落文件」变成「有索引的案例包」，实质达成「业务案例的样本可发现」这一 P4-03 意图。
2. 零搬迁、零引用修改、零测试路径变更——旧应用入口（samples/ 路径及其全部消费方）原样保留。
3. `tests/integration/`（§3.3 另一日标目录）：现有 infra._/platform-store._ 套件已按环境门控分治（`RUN_INFRA_TESTS`/`RUN_PLATFORM_PG_TESTS`，compatibility-baseline §5），等价能力已在位，不另建平行目录。

## 结论

**scenarios/ 目录重组不实施**（路线 A/B 否决理由如上）；以路线 C 最小收敛完成 P4-03：新增 `samples/README.md` 案例索引，实体零搬迁。触发重评条件：出现第三个以上业务案例且样本确实跨目录纠缠 / 外部贡献者因找不到样本提交 issue。

## 后果

- 正面：案例样本获得单一发现入口（README 索引）；8+ 处既有引用零破坏；测试硬路径与用户可见文案零风险。
- 负面：与 §3.3 目标结构的目录名不一致——但 §3.3 本身是「执行开始需重新核对」的初步设计（方案 §1 前言），ADR-0004 已裁决不为美观搬迁；若未来重组，samples/→scenarios/ 属机械重命名+引用更新，一次性 PR 可完成。
