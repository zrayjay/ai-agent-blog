# 04 · RAG 知识库与检索（离线版）

> 对应课：[learn/04 · RAG 知识库与检索](../../../docs/learn/03-capabilities/rag-knowledge-base.md) · 对应源码：`packages/engine/src/rag/`
> 本示例绕开 embedding API（手造向量直插内存库），演示 RAG 的检索半场：入库 → 检索 → 引用拼装。**零密钥、零网络**。

## 前置

无。完全离线；在 `agent-app/` 完成 `pnpm install && pnpm build` 后即可运行（engine 公开导出走 dist 产物）。

## 命令与预期输出

```bash
pnpm examples:list
pnpm examples:check
pnpm exec tsx examples/04-rag/src/main.ts
```

`main.ts` 预期输出（手造向量，确定性）：

```text
[入库] 2 文档 4 块
[检索] 「出差住宿标准」top1：差旅制度 · score 1.000
[检索] 「发票」top1：财务制度 · score 1.000
[引用]
[1] 差旅制度
[2] 财务制度
```

## 学到什么

- **RagStore 接口**：upsert（入库）/ search（向量检索）——换 pgvector 不改检索代码
- **setRagStore 注入缝**：默认内存库，一行换实现（真实入库走 `ingestSource` = 切块+embedding+upsert）
- **手造向量的教学价值**：检索半场（余弦相似度、top-k、引用编号）与 embedding 无关——后者的正确性在 [learn/04](../../../docs/learn/03-capabilities/rag-knowledge-base.md) 课内讲
- **引用编号由代码生成**（`formatCitations`），不交给模型虚构

## 真实路径（可选）

`ingestSource(fileName, text)` 走真实 embedding API（需 `.env`）；`pnpm kb:ingest` + `pnpm kb` 是完整产品线形态。
