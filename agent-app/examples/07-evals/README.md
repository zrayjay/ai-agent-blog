# 07 · 评估框架（离线版）

> 对应课：[learn/08 · 评估框架：跑分说话](../../../docs/learn/05-quality/evals-quality-gate.md) · 对应源码：`packages/engine/src/evals/`
> 本示例调 `runEvals()` 跑完整评测套件：**Tier 1（轨迹/路由）零密钥离线全跑**；Tier 2/3（检索/评审）无 key 时**显式跳过并记录原因**——跳过 ≠ 失败，也不装跑过。**零密钥、零网络**。

## 前置

无。完全离线；`pnpm install` 后即可运行（Tier 1 用版本化数据集 + 确定性打分器）。

## 命令与预期输出

```bash
pnpm examples:list
pnpm examples:check
pnpm exec tsx examples/07-evals/src/main.ts
```

`main.ts` 预期输出（无 key 环境，确定性结构；totals 数值以数据集版本为准）：

```text
[评测] 数据集版本 v? · 总耗时 ?ms
[评测] 总计：passed 76 / failed 0 / skipped 0（本机 .env 有 key 时 Tier 2/3 真跑；无 key 则 skipped N + 中文原因；vitest 进程按设计缺席）
[评测] 跳过原因：retrieval=…、judge=…
[评测] 全部 Tier 1 用例通过 → 退出码 0
```

## 学到什么

- **评估 ≠ 单测**：同一输入不同输出——断言换成「对数据集聚合打分 + 与基线比对」
- **三态门控**：`embeddingAvailable`/`judgeAvailable` 显式或自动探测；skipped 带中文原因（怎么修复）
- **Tier 1 门禁**：轨迹/路由确定性打分——CI 里 `pnpm eval` + `pnpm quality-gate --gate-policy ci` 就是这道闸
- **报告可追溯**：`evaluatorVersion` + `configId`（不含密钥的配置指纹）让基线比对知道「口径变没变」

## 真实路径（可选）

配 `.env` 后 `pnpm eval`（Tier 2 检索真跑 embedding、Tier 3 评审真打分）+ `pnpm quality-gate --gate-policy ci`。
