# 课程元数据 Schema（lesson frontmatter 契约）

来源：实施方案 §2.4。适用于 `docs/learn/**` 全部页面（P1-02 建立，P1-03 起逐课应用；P5-01 落地自动校验）。目标：让「课程声明 ↔ 源码/示例/测试 ↔ 验证证据」机器可查，杜绝把计划写成已交付。

## 页面类型

| type          | 位置                                                                                               | 必填字段                       |
| ------------- | -------------------------------------------------------------------------------------------------- | ------------------------------ |
| `lesson`      | `docs/learn/<stage>/<lessonId>.md`（P1-03 起文件名省略站号前缀；已存在的带前缀文件名不强制重命名） | 全部下述字段（除 optional 外） |
| `stage-index` | `docs/learn/<stage>/index.md`                                                                      | `type`、`stage`、`title`       |
| 框架总览      | `docs/learn/index.md`                                                                              | `type: learn-index`、`title`   |

## lesson 必填 frontmatter

```yaml
---
type: lesson
lessonId: agent-loop # 全站唯一 kebab-case；决定 slug 与交叉引用
stage: 02-runtime # 七阶段之一（见下）
order: 20 # 全局学习顺序（站号 ×10），阶段内排序依据
status: implemented # implemented | partial | planned
prerequisites: # 前置 lessonId 列表（可为空数组）
  - llm-structured-output
example: agent-app/examples/03-agent-loop # optional；无示例时省略
source: # 本课能力的真实源码路径（≥1 条）
  - agent-app/packages/engine/src/agent-loop.ts
tests: # 离线测试路径（≥1 条）
  - agent-app/packages/engine/test/agent-loop.spec.ts
lastVerifiedCommit: 2aed7bf # 已验证时的短 SHA
---
```

## 七阶段取值

`01-foundations` · `02-runtime` · `03-capabilities` · `04-orchestration` · `05-quality` · `06-fullstack` · `07-applications`

## 状态语义与证据规则

| status        | 含义                                                                | 强制约束                                                                                       |
| ------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `implemented` | 本课交付的能力已实现且有离线测试证据                                | `source` 与 `tests` 非空；`lastVerifiedCommit` 必填；正文可含可运行命令                        |
| `partial`     | 能力部分实现，或正文仍在迁移填充                                    | 必须在正文首屏说明缺什么；不得声称「生产可用」                                                 |
| `planned`     | 本课尚不可学：代码不存在/未接入，**或能力已实现但教程正文尚未撰写** | 不得给出暗示可运行的命令；须说明缺口在代码还是正文（如「代码已实现，教程待写」并链接模块源码） |

**红线**：`planned` 页面出现「跑起来」「已实现」表述 = 校验失败；`implemented` 缺证据路径 = 校验失败。

## 站号 ↔ 阶段分配（权威映射）

以 `route-migration.csv`（P0-02 审查版）为准：

| 站    | lessonId                    | stage             | status 基线（源自 capability-matrix.md）                                          |
| ----- | --------------------------- | ----------------- | --------------------------------------------------------------------------------- |
| 01    | `llm-structured-output`     | 01-foundations    | partial（正文迁移填充中；能力已实现）                                             |
| 02    | `agent-loop`                | 02-runtime        | implemented                                                                       |
| 03    | `memory-context`            | 03-capabilities   | implemented                                                                       |
| 04    | `rag-knowledge-base`        | 03-capabilities   | implemented                                                                       |
| 05    | `tools-hardening`           | 03-capabilities   | implemented                                                                       |
| 06    | `guardrails-safety`         | 05-quality        | implemented                                                                       |
| 07    | `mcp-integration`           | 03-capabilities   | implemented                                                                       |
| 08    | `evals-quality-gate`        | 05-quality        | implemented                                                                       |
| 09    | `service-product-line`      | 07-applications   | implemented                                                                       |
| 09b   | `multi-agent-orchestration` | 04-orchestration  | implemented                                                                       |
| 10    | `web-sse-frontend`          | 06-fullstack      | implemented                                                                       |
| 11    | `production-maturity`       | 05-quality        | implemented                                                                       |
| —     | （skills 专题）             | 03-capabilities   | planned（代码已实现：`engine/src/skills/` + `test/skills.spec.ts`；教程正文待写） |
| 12/13 | 不进入 learn                | advanced（P1-05） | —                                                                                 |

**案例行（非 lesson）**：阶段 07 索引中的知识库问答（`products/kb`，P1-05 迁为 cases）同样成立——kb 产品线有源码与 API e2e 测试背书（capability-matrix D 节）。文档智能（`products/docintel`）**不设 status**：其正文为 Python 教学叙事，`agent-app`（TS）无对应实现，矩阵亦无背书行；该案例行只给链接、不标状态，待 P1-05 归位 cases 时按实际能力重估。

`order` 取站号 ×10（09b 用 95）；后续新增课取相邻空档，不重排既有编号。

## 正文标准章节（§2.4，校验为「存在性」检查）

1. 学完会什么 2. 先决知识与运行环境 3. 业务问题与最小场景 4. 核心原理（流程图） 5. 最小可执行实现 6. 真实工程实现位置 7. 异常/并发/安全/性能边界 8. 测试与验收 9. 常见误区与排错 10. 自测及下一课

既有 guide 章节迁移（P1-03）时按此结构核对：已达标项保留，缺项在迁移 PR 中补齐或在正文标注「本课为纯概念章/例外」并说明理由。

## 代码片段内嵌规范（二期新增，2026-11-01）

每门课正文必须内嵌代码片段结合讲解——不能只指路（「详见 xxx.ts」式指路链接保留为「完整版」，正文片段是「教学切片」，两者互补不互替）：

1. **长度**：每块 ≤30 行；超过拆多块，块间夹讲解。
2. **溯源头注释**：块首行标真实来源，如 `// agent-app/examples/04-rag/src/main.ts（节选）`。
3. **讲解配比**：每块后必须跟 ≥1 段「这段在做什么 / 为什么这么写」。
4. **语言标注**：一律 `ts`（终端输出用 `text`，命令用 `powershell/bash`）。
5. **防漂移铁律**：片段必须**逐字摘自** `examples/` 或 `src/`（允许删行，以 `// …` 标注；行尾注释不得自拟改写），**禁止为课文新写演示代码**——examples 的离线 spec 保证片段与仓库真实行为一致。

存量豁免：存量课（tools-hardening / guardrails-safety / mcp-integration / evals-quality-gate / service-product-line 等）写作时的行尾注释改写、删行概括与字符串缩写属风格档，不回溯执法；事实性错误（如函数名与源不符）发现即改。

## 校验归属

本 Schema 的自动校验（字段完整性、lessonId 唯一性、状态-证据一致性、链接存在性）在 **P5-01** 落地为 CI 脚本；P1-03 起人工按本表执行。
