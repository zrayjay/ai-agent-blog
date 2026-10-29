# 03 · 三层记忆（离线版）

> 对应课：[learn/03 · 记忆与上下文压缩](../../../docs/learn/03-capabilities/memory-context.md) · 对应源码：`packages/engine/src/memory/`
> 本示例用内存实现演示三层记忆的接口行为：会话窗口、用户偏好、情景召回。**零密钥、零网络**。

## 前置

无。完全离线；在 `agent-app/` 完成 `pnpm install && pnpm build` 后即可运行（engine 公开导出走 dist 产物）。

## 命令与预期输出

```bash
pnpm examples:list            # 看到本示例
pnpm examples:check           # 结构 + 离线测试全部通过（CI 门禁）
pnpm exec tsx examples/03-memory/src/main.ts
```

`main.ts` 预期输出（内存实现，确定性；首行为 factory 的日志行，走 engine logger 的 stdout；默认 env 下 glm-4-flash 命中水位查表——设了 `OPENAI_MODEL`/`MODEL_CONTEXT_TOKENS` 则该行会变或消失）：

```text
[memory] 压缩水位线已启用：窗口 128000 tokens（触发 = 窗口 × 75%）
[会话窗口] 2 轮：user: 我叫小张，查一下订单… / assistant: 你好小张，A-1…
[偏好] u_001 的回复风格 = 简洁，别废话
[情景召回] top1：用户咨询了订单 A-1024 的物流（score≈1.0）
```

## 学到什么

- **会话窗口**（SessionStore）：append/getWindow/clear——模型无状态，历史是调用方喂回去的
- **偏好**（PreferenceStore）：跨会话「这个用户是谁」，同 (userId, key) 再 set 即改口
- **情景记忆**（EpisodicStore）：summary + embedding 归档，recall() 按余弦相似度找「上次那个问题」
- **换存储不改代码**：`createSessionStoreFromEnv()` 按 `SESSION_STORE=memory|redis` 切换——接口不变，实现可换

## 真实存储路径（可选）

`SESSION_STORE=redis` + `pnpm infra:up` 起 Redis 后，同一份代码切到 Redis 实现（见 `packages/engine/src/memory/factory.ts`）；pgvector 情景存储同理。
