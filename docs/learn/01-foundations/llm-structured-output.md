---
type: lesson
lessonId: llm-structured-output
stage: 01-foundations
order: 10
status: partial
prerequisites: []
source:
  - agent-app/packages/engine/src/llm.ts
  - agent-app/packages/engine/src/json-utils.ts
  - agent-app/packages/engine/src/config.ts
tests:
  - agent-app/packages/engine/test/llm-policy.spec.ts
  - agent-app/packages/engine/test/config-env.spec.ts
lastVerifiedCommit: 5a2e947
---

# LLM API 与结构化输出

> 把模型当成「会接龙的文本函数」来用：原生 API 调用、流式、提示词工程、function calling 与 JSON 模式的可靠性差异、多网关切换。学完你能徒手调通任何 OpenAI 兼容网关。

::: info 章节状态（诚实声明）
**status: partial** —— 本课的**能力全部已实现**（模型工厂 / 宽松 JSON 抽取 / 配置白名单，均有源码与离线测试），代码片段已内嵌（下方「结构化输出可靠性」节）；「业务问题与最小场景」「自测题」两节仍待正文重组时补齐。这不影响后续课程——02 站起正文完整。
:::

## 核心结论先行（本章最重要的三句话）

1. **让模型输出结构化数据有两条路，可靠性天差地别**：JSON 文本指令（`response_format` / `generateObject`）是「提示词的劝」，弱模型会静默无视（实测 glm-4-flash 输出散文导致解析炸）；工具调用（function calling）是训练出来的「肌肉记忆」，一旦调用结构必对。
2. **可靠性排序**：function calling ＞ JSON 指令 + 宽松抽取 + 校验重试（工程兜底）＞ 裸 JSON 指令（赌人品）。能走前者绝不走后者。
3. **换网关 = 换三行环境变量**：OpenAI 兼容协议是选型核心（GLM / DeepSeek / Qwen 全兼容）——但注意 DeepSeek 无 embeddings 接口。

## 先决知识与运行环境

- 前置：TypeScript 基础、[运行环境](/start/environment)就绪（Node 22 + pnpm 11.17）
- 本课命令大多需要 `.env` 配置 API Key（见 [环境页 · 离线 vs 真实](/start/environment#离线-vs-真实路径)）；`pnpm selftest` 与类型检查零密钥可跑
- **可离线跟做**：下方「结构化输出可靠性」全部代码来自 `agent-app/examples/02-structured-output`（mock 模型驱动，`pnpm examples:check` 保证与仓库行为一致），无需 Key

## 核心原理：一张图看懂模型调用

```text
你的代码                    OpenAI 兼容网关                模型
────────                    ──────────────                ────
messages[] ──POST─────────▶ /chat/completions ──────▶  接龙下一个 token
                           ◀────────────── text/sse ──  (流式 chunk 或整段)
       ▲
       └── 要 JSON？两条路：
           A. function calling（训练过的结构化输出，可靠）
           B. response_format + 提示词求 JSON（弱模型会跑偏 → 需 extractJson 兜底）
```

三条工程事实：

- **模型无状态**：每次调用都要把全部历史塞回 `messages`——这是 [阶段 03 记忆](/learn/03-capabilities/memory-context) 存在的根本原因
- **网关兼容层很薄**：`createOpenAI({ apiKey, baseURL })` 指到哪就是哪家的模型（`engine/src/llm.ts:14`）
- **配置白名单**：`OPENAI_API_KEY/BASE_URL/MODEL` + `EMBEDDING_MODEL` 四件套走 `config.ts` 手动解析（不引 dotenv，启动即校验）

## 结构化输出可靠性：四场景逐段走（可离线复现）

要 JSON 时最容易踩的坑，用四段真实代码走一遍。全部摘自 `agent-app/examples/02-structured-output/src/main.ts`（离线 mock 驱动，可信复现）。

**第一步：定义你期望的结构**。用 zod 把「我要什么样的 JSON」写成可执行的契约，而不是写在提示词里求模型遵守：

```ts
// agent-app/examples/02-structured-output/src/main.ts（节选）
import { z } from "zod";

const verdictSchema = z.object({
  city: z.string().min(1),
  hotter: z.boolean(),
});
```

这段在做什么：`city` 必须是非空字符串、`hotter` 必须是布尔——任何缺失或类型不对，`.parse()` 会直接抛错。这个 schema 就是后面第 3 步的「最后一道闸」。

**第二步：裸 JSON 指令会怎样（可靠性排序第 3 档）**。把格式要求写进提示词，然后用严格的 `JSON.parse` 等结果：

```ts
// agent-app/examples/02-structured-output/src/main.ts（节选）
try {
  const raw = await ask(driftyModel(), '比较北京和上海，只输出 JSON：{"city":…,"hotter":…}');
  JSON.parse(raw);
} catch {
  // 跑偏文本不是合法 JSON——严格路径必炸（教学点本身）
}
```

这段在做什么：提示词里已经明确「只输出 JSON」，但弱模型（这里是 mock 的 `driftyModel`，复刻真实 glm-4-flash 的跑偏行为）会在 JSON 前后垫解释性散文——`JSON.parse` 遇到散文直接抛错。**这不是边缘案例，是裸 JSON 指令的常态**。

**第三步：宽松抽取兜底（第 2 档）**。同样的跑偏文本，换 `extractJson` 从散文里抠出 JSON：

```ts
// agent-app/examples/02-structured-output/src/main.ts（节选）
const driftedText = await ask(driftyModel(), "同上");
const extracted = extractJson(driftedText);
console.log(`[场景 2] 同样的跑偏文本 + extractJson 宽松抽取 —— 成功抠出 ${JSON.stringify(extracted)}`);
```

这段在做什么：`extractJson`（引擎 `json-utils.ts` 提供）会扫描文本找到 JSON 边界并提取——模型跑偏垫的散文被剥掉，`{"city":"上海","hotter":true}` 被成功抠出。这就是可靠性排序里「工程兜底」的含金量。

**第四步：zod 校验把关（最后一道闸）**。抽出来的 JSON 结构对不对，还得过 schema：

```ts
// agent-app/examples/02-structured-output/src/main.ts（节选）
const verdict = verdictSchema.parse(extracted);
console.log(`[场景 3] zod 校验把关 —— 通过 ${JSON.stringify(verdict)}`);
```

这段在做什么：即使抠出了合法 JSON，字段可能缺失或类型不对（模型幻觉）——`.parse()` 逐字段校验，不合规即抛。三步组合起来 = 排序第 2 档的完整工程链：**宽松抽取 + 校验，失败则重试**。

> 第 4 个场景（纯闲聊）连 `extractJson` 也救不了——文本里根本没有 JSON，会抛中文错误由上层决定重试。完整四场景可运行版：`cd agent-app && pnpm exec tsx examples/02-structured-output/src/main.ts`（mock 驱动，零密钥零网络即可跑全场景；把 `driftyModel()/chattyModel()` 换成 `getModel()` 才需要 Key）。

## 最小可执行实现

**1. 连上网关（真实路径，需 Key）**：

```bash
cd agent-app
cp .env.example .env   # 填 OPENAI_API_KEY（默认智谱 GLM 网关）
pnpm examples:minimal  # 38 行最小 Agent：模型自己决定查几次天气
```

预期输出（无 Key 时打印清晰配置错误而非崩溃——这也是预期行为）：

```text
[step 1] 调用 getWeather({"city":"北京"})
[step 2] 调用 getWeather({"city":"上海"})
最终回答（共 3 步）：上海更热……
```

**2. 零密钥离线路径**：`pnpm selftest`（13 项引擎自检）与 `pnpm typecheck` 验证的是同一套配置与抽取代码——`test/config-env.spec.ts` 覆盖白名单解析，`test/llm-policy.spec.ts` 覆盖重试/超时策略。

## 真实工程实现位置

| 概念           | 源码                                          | 说明                                                                   |
| -------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| 网关接入       | `agent-app/packages/engine/src/llm.ts`        | `createModel/getModel/getEmbeddingModel`，懒创建 + 单例                |
| 配置白名单     | `agent-app/packages/engine/src/config.ts`     | `.env` 手动解析、四件套 + 策略变量                                     |
| 宽松 JSON 抽取 | `agent-app/packages/engine/src/json-utils.ts` | `extractJson`：模型跑偏时的工程兜底（可靠性排序第 2 档的「宽松抽取」） |

## 异常与边界

- **缺 Key 不崩**：`createModel` 懒校验——provider 在真正发请求时才报错，CLI 才能做到「无 Key 启动、首次对话给清晰提示」
- **重试与超时**：`llmCallPolicy` 组装 `maxRetries`（指数退避）与 `AbortSignal.timeout`，环境变量 `AGENT_LLM_MAX_RETRIES`/`AGENT_LLM_TIMEOUT_MS` 可调
- **Embedding 与 Chat 不同源**：入库和检索必须用同一个 embedding 模型，混用 = 坐标空间错乱（[阶段 03 RAG](/learn/03-capabilities/rag-knowledge-base) 展开）

## 测试与验收

- 离线：`pnpm selftest`、`pnpm typecheck`、`cd agent-app && pnpm --filter @agent-app/engine test -- llm-policy config-env`、`pnpm examples:check`（含本课四场景 spec）
- 真实（可选，需 Key）：`pnpm examples:minimal` 走通三步天气查询

## 常见误区

- **「求模型输出 JSON」当唯一方案**——弱模型静默跑偏，必须 `extractJson` + 校验重试兜底，或直接用 function calling
- **把 Key 写进代码/日志**——Key 只进 `.env`（已 gitignore），报错信息里也不该出现
- **默认模型当万能**——`OPENAI_MODEL` 可被 `createModel(modelId)` 按场景覆盖（[09 站路由](/learn/07-applications/service-product-line)用到）

## 素材与延伸

- TS 前置自查不过时：回到[从这里开始](/start/index)的前置要求表
- 上一课：无（主线起点）· 下一课：[02 · 手写工具循环](/learn/02-runtime/agent-loop)
- [学习路线图](/start/roadmap) · 遇到环境问题查[运行环境](/start/environment)

---

::: info 章节结构说明
本课为 partial：十章结构中核心原理/最小实现/工程位置/异常边界/测试验收/常见误区已达标，**代码片段已内嵌**（四场景逐段讲解）；「业务问题与最小场景」「自测题」待正文重组时补齐——与开篇状态声明一致，不构成虚假完成。
:::

有疑问随时问 AI 老师（本项目的开发助手）。其他章节：[学习路线图](/start/roadmap)
