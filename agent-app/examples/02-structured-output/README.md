# 02 · 结构化输出（离线版）

> 对应课：[learn/01 · LLM API 与结构化输出](../../../docs/learn/01-foundations/llm-structured-output.md) · 对应源码：`packages/engine/src/json-utils.ts`
> 本示例用 **mock 模型**演示课内「可靠性排序」的三条路：裸 JSON 指令会跑偏、`extractJson` 宽松抽取兜底、zod 校验把关。**零密钥、零网络**，CI 直接跑。

## 前置

无。默认路径完全离线，不需要 API Key、`.env`、Docker 或网络；在 `agent-app/` 完成 `pnpm install && pnpm build` 后即可运行。

## 命令与预期输出

```bash
pnpm examples:list            # 看到本示例
pnpm examples:check           # 结构 + 离线测试全部通过（CI 门禁）
pnpm exec tsx examples/02-structured-output/src/main.ts
```

`main.ts` 预期输出（mock 模型脚本化返回，确定性）：

```text
[场景 1] 裸 JSON 指令 + 严格 parse —— 模型跑偏（输出散文），直接抛错
[场景 2] 同样的跑偏文本 + extractJson 宽松抽取 —— 成功抠出 {"city":"上海","hotter":true}
[场景 3] zod 校验把关 —— 通过 { city: '上海', hotter: true }
[场景 4] 抽取也救不了（纯闲聊无 JSON）—— 抛中文错误，上层决定重试
```

## 学到什么

- 可靠性排序的工程含义：**function calling ＞ JSON 指令 + 宽松抽取 + 校验重试 ＞ 裸 JSON 指令**
- `extractJson` 的括号配对扫描：容忍 ```json 围栏与前后废话，取第一个语法完整候选
- 解析全失败抛**带原文摘录的中文错误**——上层（调用方）决定重试还是降级
- zod 校验是最后一道闸：形状不对的数据不许进业务

## 真实模型路径（可选）

把 `src/main.ts` 里的 `scriptedModel()` 换成 `getModel()`（`@agent-app/engine/llm`）并配好 `.env`，即可对真实网关重放四个场景——弱模型跑偏是真实发生的（课内 glm-4-flash 实测）。
