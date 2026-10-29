// main.ts —— 04 示例：RAG 检索半场的最小离线形态。
// 手造向量直插内存库、查询向量同样手造（绕开 embedding API）：
// 检索半场（余弦/top-k/引用拼装）与 embedding 完全解耦——RagStore 接口的设计意图。
// REAL 路径：入库走 ingestSource(fileName, text)（切块+真实 embedding，需 .env），
// 查询走 searchKnowledge(query, k)（内部 embed([query])）。
import { setRagStore, formatCitations } from "@agent-app/engine/rag";
import { createInMemoryRagStore } from "@agent-app/engine/rag";
import type { Chunk } from "@agent-app/engine/rag";

const store = createInMemoryRagStore();
setRagStore(store);

// 手造 4 块：两篇文档各 2 块，向量手算（单位向量，同向=1 正交=0）
const chunks: Chunk[] = [
  {
    id: "travel#0",
    docId: "travel",
    title: "差旅制度",
    index: 0,
    text: "出差住宿标准：一线城市每晚上限 500 元。",
    embedding: [1, 0],
  },
  {
    id: "travel#1",
    docId: "travel",
    title: "差旅制度",
    index: 1,
    text: "交通费凭发票实报实销。",
    embedding: [0.9, 0.1],
  },
  {
    id: "finance#0",
    docId: "finance",
    title: "财务制度",
    index: 0,
    text: "发票开具：需提供税号与开票抬头。",
    embedding: [0, 1],
  },
  {
    id: "finance#1",
    docId: "finance",
    title: "财务制度",
    index: 1,
    text: "报销周期为每月 1-10 日。",
    embedding: [0.1, 0.9],
  },
];
await store.upsert(chunks);
console.log(`[入库] 2 文档 ${chunks.length} 块`);

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
