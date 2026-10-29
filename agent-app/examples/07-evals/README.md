# 07 · 评估框架（离线 Tier 1 + 可选 Tier 2/3）

> 对应课：[learn/08 · 评估框架：跑分说话](../../../docs/learn/05-quality/evals-quality-gate.md) · 对应源码：`packages/engine/src/evals/`
> 本示例调 `runEvals()` 跑完整评测套件。**Tier 1（轨迹 10 例 + 路由 8 例）零密钥离线全跑**；**Tier 2/3（检索 50 + 评审 8）按环境三态门控**：有 key 真跑（消耗少量配额）/ 无 key skipped + 中文原因（跳过 ≠ 失败，也不装跑过）/ vitest 进程按设计缺席。

## 前置

无。Tier 1 完全离线；`pnpm install` 后即可运行。
**配额提示**：若 `agent-app/.env` 已配 `OPENAI_API_KEY`，本示例会真跑 Tier 2/3（少量 embedding + judge 调用，实测定级十几秒）；需纯离线可临时移走 `.env`。

## 命令与预期输出

```bash
pnpm examples:list
pnpm examples:check
pnpm exec tsx examples/07-evals/src/main.ts
```

**有 key 环境**（.env 已配，实跑实测）：

```text
[评测] 数据集版本 3 · 总耗时 13650ms
[评测] 总计：passed 76 / failed 0 / skipped 0（skipped 数取决于环境：有 key 为 0，无 key 为 N + 中文原因，vitest 进程缺席）
[评测] 全部 Tier 1 用例通过 → 退出码 0
```

**无 key 环境**（结构性输出，18 例 Tier 1 + 58 skipped）：

```text
[评测] 数据集版本 3 · 总耗时 ?ms
[评测] 总计：passed 18 / failed 0 / skipped 58（skipped 数取决于环境：…）
[评测] 跳过原因：retrieval=…、judge=…
[评测] 全部 Tier 1 用例通过 → 退出码 0
```

## 学到什么

- **评估 ≠ 单测**：同一输入不同输出——断言换成「对数据集聚合打分 + 与基线比对」
- **三态门控**：`embeddingAvailable`/`judgeAvailable` 显式或自动探测；skipped 带中文原因（怎么修复）；vitest 进程缺席语义（离线回归与 P1 同形报告）
- **Tier 1 门禁**：轨迹/路由确定性打分——CI 里 `pnpm eval` + `pnpm quality-gate --gate-policy ci` 就是这道闸
- **报告可追溯**：`evaluatorVersion` + `configId`（不含密钥的配置指纹）让基线比对知道「口径变没变」

## 真实路径（可选）

配 `.env` 后 `pnpm eval`（同本示例）+ `pnpm quality-gate --gate-policy ci`（质量门禁裁决退出码）。
