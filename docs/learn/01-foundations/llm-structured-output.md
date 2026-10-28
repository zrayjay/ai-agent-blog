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
**status: partial** —— 本课的**能力全部已实现**（模型工厂 / 宽松 JSON 抽取 / 配置白名单，均有源码与离线测试），但正文仍是**精简框架版**：01 站原本计划把归档周（week11 day1-3/6）的成熟叙述重组进本页，该工作排在批次 B 收尾。学习路径：先读本页核心结论与最小实现建立骨架，再按「素材」链接读归档周补细节。这不影响后续课程——02 站起正文完整。
:::

## 核心结论先行（本章最重要的三句话）

1. **让模型输出结构化数据有两条路，可靠性天差地别**：JSON 文本指令（`response_format` / `generateObject`）是「提示词的劝」，弱模型会静默无视（实测 glm-4-flash 输出散文导致解析炸）；工具调用（function calling）是训练出来的「肌肉记忆」，一旦调用结构必对。
2. **可靠性排序**：function calling ＞ JSON 指令 + 宽松抽取 + 校验重试（工程兜底）＞ 裸 JSON 指令（赌人品）。能走前者绝不走后者。
3. **换网关 = 换三行环境变量**：OpenAI 兼容协议是选型核心（GLM / DeepSeek / Qwen 全兼容）——但注意 DeepSeek 无 embeddings 接口。

## 先决知识与运行环境

- 前置：TypeScript 基础、[运行环境](/start/environment)就绪（Node 22 + pnpm 11.17）
- 本课命令大多需要 `.env` 配置 API Key（见 [环境页 · 离线 vs 真实](/start/environment#离线-vs-真实路径)）；`pnpm selftest` 与类型检查零密钥可跑

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

- 离线：`pnpm selftest`、`pnpm typecheck`、`cd agent-app && pnpm --filter @agent-app/engine test -- llm-policy config-env`
- 真实（可选，需 Key）：`pnpm examples:minimal` 走通三步天气查询

## 常见误区

- **「求模型输出 JSON」当唯一方案**——弱模型静默跑偏，必须 `extractJson` + 校验重试兜底，或直接用 function calling
- **把 Key 写进代码/日志**——Key 只进 `.env`（已 gitignore），报错信息里也不该出现
- **默认模型当万能**——`OPENAI_MODEL` 可被 `createModel(modelId)` 按场景覆盖（[09 站路由](/guide/09-product)用到）

## 素材与延伸

- 归档周教程（正文重组的原始材料，内容完整）：[week11 · LLM API 三天](/archive/weeks/week11/)（原生调用/流式/结构化输出/多供应商）
- 上一课：无（主线起点）· 下一课：[02 · 手写工具循环](/learn/02-runtime/agent-loop)
- [学习路线图](/start/roadmap) · 遇到环境问题查[运行环境](/start/environment)

---

::: info 章节结构说明
本课为**精简框架版**（partial）：十章结构中核心原理/最小实现/工程位置/异常边界/测试验收/常见误区已达标，「业务问题与最小场景」「自测题」待正文重组时补齐——与开篇状态声明一致，不构成虚假完成。
:::

有疑问随时问 AI 老师（本项目的开发助手）。其他章节：[学习路线图](/start/roadmap)
