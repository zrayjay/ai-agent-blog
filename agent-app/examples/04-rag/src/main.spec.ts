// main.spec.ts —— 04 示例的离线确定性测试（CI 必跑，零密钥）。
// 断言检索半场的三条工程事实：余弦排序、top-k 截断、引用编号由代码生成。
import { describe, expect, it } from "vitest";
import { setRagStore, getRagStore, formatCitations } from "@agent-app/engine/rag";
import { createInMemoryRagStore } from "@agent-app/engine/rag";
import type { Chunk } from "@agent-app/engine/rag";

const chunks: Chunk[] = [
  { id: "travel#0", docId: "travel", title: "差旅制度", index: 0, text: "住宿 500 上限", embedding: [1, 0] },
  {
    id: "travel#1",
    docId: "travel",
    title: "差旅制度",
    index: 1,
    text: "交通实报实销",
    embedding: [0.9, 0.1],
  },
  { id: "finance#0", docId: "finance", title: "财务制度", index: 0, text: "发票需税号", embedding: [0, 1] },
];

describe("04-rag", () => {
  it("余弦排序：查询向量与谁同向，谁排第一", async () => {
    const store = createInMemoryRagStore();
    setRagStore(store);
    await store.upsert(chunks);
    const hits = await store.search([1, 0], 3);
    expect(hits[0]?.title).toBe("差旅制度");
    expect(hits[0]?.score).toBeGreaterThan(hits[2]?.score ?? 0);
  });

  it("top-k 截断：k=1 只回一条，k 大于库容回全库", async () => {
    const store = createInMemoryRagStore();
    await store.upsert(chunks);
    expect(await store.search([1, 0], 1)).toHaveLength(1);
    expect((await store.search([1, 0], 10)).length).toBe(chunks.length);
  });

  it("引用拼装：编号由代码按命中顺序生成，不靠模型", () => {
    const fake = [
      { ...chunks[0], score: 0.99 },
      { ...chunks[2], score: 0.42 },
    ];
    const text = formatCitations(fake);
    expect(text).toContain("[1] 差旅制度");
    expect(text).toContain("[2] 财务制度");
  });

  it("setRagStore 注入缝：换库一行，getRagStore 全局生效", () => {
    const store = createInMemoryRagStore();
    setRagStore(store);
    expect(getRagStore()).toBe(store);
  });
});
