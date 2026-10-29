# examples · 渐进式示例系列

> 每个示例对应主线课程的一个学习目标：`src/` 尽可能小（不复制引擎内核）、离线测试确定可跑（CI 零密钥）、真实模型路径**显式可选**。
> 旧的引擎内置示例（`packages/engine/examples/` 的 minimal-agent / custom-tool）保留且命令不变（`pnpm examples:minimal` 等），本目录是它们的教学化扩展。

## 目录规范（新增示例必须遵守）

```text
examples/
└── NN-<slug>/                 # 序号即建议学习顺序
    ├── README.md              # 用途 / 前置 / 命令 / 预期输出 / 对应课 / 对应源码
    ├── src/main.ts            # 可运行核心（tsx 直跑；引擎走 dist 公开导出）
    └── src/main.spec.ts       # ≥1 条离线确定性测试（vitest，CI 必跑）
```

- **只用公开导出面**：`import … from "@agent-app/engine[/…]"`（子路径清单见 `docs/maintainers/compatibility-baseline.md` §4），不 import 引擎私有源码
- **离线优先**：默认路径零密钥可跑；需要真实模型的演示标 `REAL MODEL` 并在缺 Key 时跳过（打印原因，不算失败）
- **单一主示例**：每篇主线课最多指向一个主示例 + 少量补充

## 统一运行器

| 命令                  | 做什么                                                                   |
| --------------------- | ------------------------------------------------------------------------ |
| `pnpm examples:list`  | 列出全部示例及其对应课、离线/真实路径标记                                |
| `pnpm examples:check` | 校验每个示例目录结构完整（README/src/spec）且 spec 全部离线通过——CI 门禁 |

（`pnpm examples:minimal` / `examples:custom-tool` 语义不变，仍指向引擎内置示例。Windows PowerShell 用户：示例命令均为 `pnpm ...` / `pnpm exec tsx ...` 形态，两个 shell 通用；路径含空格时加引号——环境级差异见 [start/environment](../../docs/start/environment.md)。）

## 示例清单（随 P2 逐批落地）

| 示例                               | 对应课                                                                                                                          | 状态    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 01-tool-loop-offline               | [02 · 手写工具循环](../../docs/learn/02-runtime/agent-loop.md)                                                                  | ✅ 本批 |
| 02-structured-output               | [01 · LLM API 与结构化输出](../../docs/learn/01-foundations/llm-structured-output.md)                                           | ✅ 本批 |
| 03-memory / 04-rag / 05-mcp-skills | 阶段 03 各课                                                                                                                    | ✅ 本批 |
| 06-orchestration / 07-evals        | [09b](../../docs/learn/04-orchestration/multi-agent-orchestration.md) / [08](../../docs/learn/05-quality/evals-quality-gate.md) | ✅ 本批 |
