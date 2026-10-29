# 01 · 工具循环（离线版）

> 对应课：[learn/02 · 手写工具循环](../../../docs/learn/02-runtime/agent-loop.md) · 对应源码：`packages/engine/src/agent-loop.ts`
> 本示例用 **mock 模型**演示 `runToolLoop` 的核心机制（点名 → 执行 → 回灌 → 终答），**零密钥、零网络**，CI 直接跑。

## 前置

无。默认路径完全离线，不需要 API Key、`.env`、Docker 或网络；在 `agent-app/` 完成 `pnpm install && pnpm build` 后即可运行。

## 命令与预期输出

```bash
pnpm examples:list            # 看到本示例：offline 标记
pnpm examples:check           # 结构 + 离线测试全部通过（CI 门禁）
pnpm exec tsx examples/01-tool-loop-offline/src/main.ts
```

`main.ts` 预期输出（mock 模型脚本化返回，确定性）：

```text
[step 1] 调用 getWeather({"city":"北京"})
[step 2] 调用 getWeather({"city":"上海"})
最终回答（共 3 步）：
上海今天更热：28°C 对 23°C。
```

## 学到什么

- 工具三件套（description / inputSchema / execute）如何进模型视野
- 循环出口条件：模型不再发起工具调用即终答；`maxSteps` 是保险丝
- `onStep` 钩子如何把每步变成可观测事件（评测/轨迹采集的出口，见 08 站）

## 真实模型路径（可选）

把 `src/main.ts` 里的 `mockModel` 换成 `getModel()`（`@agent-app/engine/llm`）并配好 `.env`，即得到真实 LLM 版——行为与引擎内置 `examples:minimal` 等价。
