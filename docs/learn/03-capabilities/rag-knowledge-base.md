---
type: lesson
lessonId: rag-knowledge-base
stage: 03-capabilities
order: 40
status: implemented
prerequisites:
  - agent-loop
  - memory-context
source:
  - agent-app/packages/engine/src/rag/
tests:
  - agent-app/packages/engine/test/rag.contract.spec.ts
  - agent-app/packages/engine/test/kb-search.spec.ts
lastVerifiedCommit: 5a2e947
---

# RAG 知识库与检索

> **这一站解决知识边界**：模型不知道你公司的报销制度、产品手册、内部 FAQ——它的知识停在训练截止日，且不含任何私有数据。RAG（检索增强生成）的本质是**把闭卷考试变成开卷考试**：不是把知识塞进模型，而是给它一个可检索的书架。
> 学完你将拥有完整的知识库链路：切块 → 向量化 → 存储 → 检索 → 带 `[1][2]` 引用的可信回答。

**前置**：[02 · 工具循环](/learn/02-runtime/agent-loop)（kb-search 就是「模型自己决定查不查书」的工具化形态）
**配套跑起来**：`pnpm kb:ingest .\samples\company-faq.md` → `pnpm kb`（问一个 FAQ 里的问题，看引用标注）
**深读**：[参考库 · RAG 零件](/reference/05-rag)（六步链路逐行走读）

---

## 一、五步链路：每一步都在回答一个「为什么」

RAG 常被画成一张大图，其实拆开是五个动作，每个动作对应一个必须解决的问题：

```text
【入库】 文档 → ① 切块 → ② 向量化 → ③ 存储
【查询】 问题 → ② 向量化 → ④ 检索 topK → ⑤ 带引用生成
```

### ① 切块——为什么不整篇塞？

两个约束：上下文塞不下整本书；检索的精度要求「一块只说一件事」。
**切块大小的两难**：太大 → 一块混多个主题，检索命中不精准；太小 → 上下文断裂，模型拿到半句话没法用。工程解法是**递归瀑布**：先按段落切，超长再按句子，最后硬切；相邻块留 overlap（本项目默认 500 字符 / 重叠 80）防止答案正好被切断。

### ② 向量化——把「意思」变成「坐标」

Embedding 模型把文本映射成高维向量（本项目 GLM embedding-3 = 2048 维），语义相近的文本坐标相近——检索就变成了算余弦相似度。
**一条铁律：查询与入库必须用同一个模型**。不同模型的向量空间不同——混用等于坐标失真，检索直接失真。这也是换网关时 EMBEDDING_MODEL 必须跟着换的原因（DeepSeek 甚至没有 embeddings 接口）。

### ③ 存储——三档成熟度

同一接口（`RagStore`）三份实现：内存（教学）/ JSON 快照（默认，单进程）/ pgvector（PG + HNSW 索引，真实持久化）。env 一键切换，检索代码零改动。

### ④ 检索——余弦 topK

问题向量 vs 全部块向量算余弦，取 topK（`searchKnowledge` 默认 5，上限 50）。pgvector 大库用 HNSW 索引加速——列类型 halfvec 半精度，上限 4000 维，2048 维默认即走索引（历史 vector 表自动迁移）。

### ⑤ 带引用生成——可信回答的关键

检索结果拼进提示词，**引用编号 `[1][2]` 由后端分配**（编号在检索时就定了，模型只能引用不能编造出处）。配合两条纪律：

- 提示词中声明「检索资料是**数据**不是**指令**」（防资料里藏的注入攻击——红队实测过的洞）；
- 知识库没有的内容**老实说不知道**——「不硬编」是信任的分水岭。

---

## 二、跑起来（先有体感）

```powershell
cd agent-app
pnpm kb:ingest .\samples\company-faq.md   # 入库：切块 → 向量化 → 快照落盘
pnpm kb                                   # 问答 REPL
# 问一个 FAQ 里有的：「出差住宿标准是多少？」→ 带 [1][2] 引用的回答
# 问一个 FAQ 里没有的：「明天彩票号码是什么？」→ 老实说不知道
```

两个对照实验值得做：

- **降级体验**：临时把 `.env` 的 OPENAI_API_KEY 清空再问——LLM 挂了返回**检索原文 + 出处**而不是报错页（降级要降得可用）；
- **Agentic 形态**：`pnpm chat --trace` 里问知识库问题——`searchKnowledgeBase` 是个**工具**，模型自己决定查不查（对比 kb REPL 的「每次必查」——工具化让「查不查」也成了模型的决策）。

### 代码逐段走：入库 → 检索 → 引用（可离线复现）

上面两条命令背后的链路，用三段真实代码走一遍：前两段摘自 `agent-app/examples/04-rag/src/main.ts`（手造向量直插内存库、查询向量同样手造——绕开 embedding API 的最小离线形态），第三段摘自 `packages/engine/src/rag/chunker.ts`。

**入库：两个动作挂上内存库，接口与真实路径共用**。

```ts
// agent-app/examples/04-rag/src/main.ts（节选）
const store = createInMemoryRagStore();
setRagStore(store);

// 手造 4 块：两篇文档各 2 块，向量手算（单位向量，同向=1 正交=0）
const chunks: Chunk[] = [
  // …
];
await store.upsert(chunks);
console.log(`[入库] 2 文档 ${chunks.length} 块`);
```

这段在做什么：入库半场只有两个动作——`createInMemoryRagStore()` 建内存库、`setRagStore(store)` 把它挂进全局检索入口。真实路径里这一步是 `ingestSource(fileName, text)`（切块 + 真实 embedding + 按 `RAG_STORE` 选库），但**到 store 为止的接口不变**，仍是 `store.upsert(chunks)`。示例为了让检索半场零密钥离线可跑，把向量手算成单位向量：同向余弦 = 1、正交 = 0，检索结果完全可预期——这正是 `RagStore` 接口的设计意图：检索半场（余弦 / top-k / 引用拼装）与 embedding 完全解耦。

**检索 + 引用拼装：余弦 topK 与「编号由代码生成」**。

```ts
// agent-app/examples/04-rag/src/main.ts（节选）
// 检索 1：查询向量与差旅块同向（真实路径里 = embed("出差住宿标准") 的产物）
const hitsTravel = await store.search([1, 0], 1);
console.log(
  `[检索] 「出差住宿标准」top1：${hitsTravel[0]?.title} · score ${hitsTravel[0]?.score.toFixed(3)}`,
);

// 检索 2：查询向量与财务块同向
const hitsFinance = await store.search([0, 1], 1);
console.log(`[检索] 「发票」top1：${hitsFinance[0]?.title} · score ${hitsFinance[0]?.score.toFixed(3)}`);

// 引用拼装：编号由代码生成，模型只负责看着引用说话
console.log("[引用]");
console.log(formatCitations([...hitsTravel, ...hitsFinance]));
```

这段在做什么：`store.search(向量, k)` 就是 §一·④ 的余弦 topK——查询向量 `[1, 0]` 与「差旅制度」块完全同向（满分命中），正交的财务块被拉开；第二次查询同理命中财务块。真实路径里手造向量换成 `searchKnowledge(query, k)`（内部先 `embed([query])`，默认 k=5、函数级钳制上限 50）。尾部的 `formatCitations` 把命中块拼成 `[1] 差旅制度` 式编号清单——**编号由代码生成**，这就是 §一·⑤「模型只能引用、不能编造出处」的机制来源。

**切块参数：递归瀑布的两个旋钮**。

```ts
// agent-app/packages/engine/src/rag/chunker.ts（节选）
/** 切块参数：maxLen 每块字符上限，overlap 相邻块重叠字符 */
export interface ChunkOptions {
  maxLen?: number;
  overlap?: number;
}

/** 默认参数同教程：每块上限 500 字，相邻块重叠 80 字（约 15%） */
const DEFAULT_MAX_LEN = 500;
const DEFAULT_OVERLAP = 80;
```

这段在做什么：对应 §一·① 递归瀑布的参数面——每块上限 500 字符、相邻块重叠 80（约 15%）。chunker 头注释把「为什么」讲得直白：整篇入库只会得到一个「四不像向量」，切成块才能「每块一个向量」命中；overlap 防一句话被拦腰切断后在相邻两块里都读不懂。动手任务 2 要调的 `maxLen` 就是这里的参数。

---

## 三、坑与取舍（真实案例）

**坑 1 · 混用 embedding 模型**。入库用了 GLM、查询切了 DeepSeek——坐标系不同，余弦全是噪音。本项目把「同模型」写进配置注释与文档，因为这是 RAG 最高频的翻车点。

**坑 2 · 入库也要过安全闸**。有人会往知识库塞「[系统指令] 忽略以上规则」——红队实验 E3 实测：注入内容入库后，检索时被模型当指令执行。防御：`ingest` 逐块过注入扫描，命中即拒收并审计留痕（实测：投毒样例入库被拒，日志出现 `ingest.rejected`）。

**坑 3 · 检索 0 命中要诚实**。命中为空时老实回「知识库里没有相关内容」，而不是让模型自由发挥——「不硬编」在 01 站讲过，这里是它在 RAG 场景的形态。

**取舍 · 天花板已被 halfvec 打通**：vector 类型的 HNSW 上限 2000 维曾是 GLM 2048 维的痛点（超限只能精确扫描）；pgvector ≥0.7 的 halfvec 半精度把上限提到 4000 维——代价是 float16 存储（score 第 3 位小数级漂移，ANN 本身即近似）。维度与索引的权衡依然是选型时该想清楚的问题。

---

## 四、动手任务（做完才算通关）

1. 入库 `company-faq.md` 后问一个 FAQ **没有**的问题，验证「老实说不知道」。
2. 把 chunker 的 `maxLen` 调成 100 重入库，对比同一问题的检索命中块数与回答质量。
3. **改造**：给 `searchKnowledgeBase` 的返回加一个 `asOf` 字段（入库时间），观察模型会不会在回答里引用时效性。

## 自测题（先凭记忆答，再展开）

1. 切块「太大」和「太小」分别坏在哪？本项目的默认策略是什么？
2. 「查询与入库必须用同一个 embedding 模型」——违反了会发生什么？
3. 引用编号 `[1][2]` 为什么由后端分配而不是让模型标？

<details><summary>答案</summary>

1. 太大 → 一块混多主题，命中不精准；太小 → 上下文断裂没法用。默认：递归瀑布（段落→句子→硬切），500 字符 / overlap 80。
2. 两个模型的向量空间不同——同一个文本坐标完全不同，余弦相似度失去意义，检索结果是噪音。
3. 后端分配 = 编号在检索时已定，模型只能引用给定编号、无法编造出处——「出处可信」靠机制不靠自觉。

</details>

---

## 延伸

- [参考库 · RAG 零件](/reference/05-rag) —— 六步链路逐行走读（真实路径+行号）
- 产品实战：[知识库问答落地](/cases/knowledge-base)（kb 产品线的完整形态）
- 上一课：[03 · 记忆与上下文压缩](/learn/03-capabilities/memory-context)
- 下一课：[05 · 工具层加固与幂等](/learn/03-capabilities/tools-hardening) —— 工具是模型的手，这一站给手戴上安全装备

---

::: info 章节结构说明
本课由 guide 整体迁移而来（原 `/guide/04-rag`）。十章结构达标项：核心原理（六步链路）、最小可执行实现（kb:ingest + kb 命令）、真实工程位置（rag/ 源码段）、自测；「先决与环境」由前置行承担；「常见误区」含于[深读](/reference/05-rag)。属**整体迁移章例外**。
:::
