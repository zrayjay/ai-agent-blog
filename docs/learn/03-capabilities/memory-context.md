---
type: lesson
lessonId: memory-context
stage: 03-capabilities
order: 30
status: implemented
prerequisites:
  - agent-loop
source:
  - agent-app/packages/engine/src/memory/
tests:
  - agent-app/packages/engine/test/memory.contract.spec.ts
  - agent-app/packages/engine/test/compression-watermark.spec.ts
  - agent-app/packages/engine/test/session-concurrency.spec.ts
lastVerifiedCommit: 5a2e947
---

# 记忆与上下文压缩

> **这一站解决两个约束**：模型无状态（上一轮说过什么，这一轮全忘）+ 上下文窗口有限（再大的窗口也会被长对话撑爆）。学完你将拥有三层记忆（会话 / 偏好 / 情景）、一套滚动摘要压缩机制，以及「换存储只改一个环境变量」的工程形态。

**前置**：[02 · 手写工具循环](/learn/02-runtime/agent-loop)（岔路 2 提过「会话历史只存问答文本」的记忆颗粒度问题——本章展开）
**配套跑起来**：`pnpm chat`（连聊几句看它记得你）+ `pnpm infra:up` 后切 Redis 体验跨进程持久化
**深读**：[参考库 · 三层记忆](/reference/04-memory)（11 个文件的逐行走读与接口契约）

---

## 一、为什么：两个绕不开的约束

**约束 1 · 模型无状态**。每次 API 调用都是独立的——上一轮用户说「我喜欢简洁回答」，这一轮模型完全不知道。所谓「Agent 记得你」，全部是**工程上把历史重新塞进上下文**。

**约束 2 · 上下文窗口有限且有成本**。把所有历史无脑塞进去：长对话撑爆窗口；即使塞得下，token 也是钱——每一轮都把全部历史重发一遍，成本随轮数线性上涨。

记忆系统的全部工作，就是在这两个约束之间做权衡：**什么该记、记多久、以什么形式塞回去**。

---

## 二、三层记忆：对应三种「记住」

人类记忆有短期/长期之分，Agent 一样。本项目的三层设计：

| 层                              | 回答的问题                       | 存储                          | 生命周期               |
| ------------------------------- | -------------------------------- | ----------------------------- | ---------------------- |
| **会话窗口**（SessionStore）    | 「我们刚才聊了什么？」           | 消息数组（按 sessionId 归档） | 会话内；跨进程可持久化 |
| **用户偏好**（PreferenceStore） | 「这个用户是谁、喜欢什么？」     | 键值对（按 userId）           | 长期                   |
| **情景记忆**（EpisodicStore）   | 「以前类似的问题是怎么处理的？」 | 会话摘要 + 向量               | 长期，按相关度召回     |

**接口先行**：三层各自是一个极小的接口（如 SessionStore 只有 `append / getWindow / clear / listSessions / getHistory` 五个方法）——先定契约，实现随便换。

下面的三个片段逐字摘自 `agent-app/examples/03-memory/src/main.ts`（三层工厂全部走内存实现，零密钥离线可跑），每层各看一个核心动作。

**会话窗口：追加两轮，再读回**。

```ts
// agent-app/examples/03-memory/src/main.ts（节选）
const sessionStore = createSessionStoreFromEnv({ SESSION_STORE: "memory" });
// ① 会话窗口：追加两轮再读回
await sessionStore.append("s_001", { role: "user", content: "我叫小张，查一下订单 A-1024" });
await sessionStore.append("s_001", { role: "assistant", content: "你好小张，A-1024 已发货。" });
const window = await sessionStore.getWindow("s_001");
console.log(
  `[会话窗口] ${window.length} 轮：${window[0]?.role}: ${window[0]?.content.slice(0, 10)}… / ${window[1]?.role}: ${window[1]?.content.slice(0, 8)}…`,
);
```

这段在做什么：`append(sessionId, 消息)` 只存问答文本、按 sessionId 归档——这正是坑 1「会话历史只存问答文本」的存法；`getWindow` 读回的就是 §三 压缩机制拼命保住的那个窗口（默认 limit 20，示例里两轮全在）。工厂函数 `createSessionStoreFromEnv` 读 env 装配实现：示例显式传 `{ SESSION_STORE: "memory" }`，真实应用不传就读 `.env`——「换存储只改一个环境变量」的接缝从装配的第一行就成立。

**用户偏好：跨会话的「认识你」**。

```ts
// agent-app/examples/03-memory/src/main.ts（节选）
import { createPreferenceStoreFromEnv } from "@agent-app/engine/memory/factory";
const preferenceStore = createPreferenceStoreFromEnv({ PREFERENCE_STORE: "memory" });
// ② 用户偏好：写入后读回（跨会话的"认识你"）
await preferenceStore.set("u_001", "回复风格", "简洁，别废话");
const style = await preferenceStore.get("u_001", "回复风格");
console.log(`[偏好] u_001 的回复风格 = ${style}`);
```

这段在做什么：偏好层按键值对组织（userId → 键 → 值），生命周期与「聊过什么」无关——`u_001` 的「回复风格=简洁」跨会话长期成立，下一场对话开场就该进 system prompt。注意键是 **userId 不是 sessionId**：这是三层表格里「会话窗口按 sessionId、用户偏好按 userId」的代码形态，也是坑 3「重要实体应进偏好/情景层」的落点。三个工厂同出 `memory/factory` 一个模块——三层各自的 env 开关都汇到这一处装配。

**情景记忆：归档摘要，按向量召回**。

```ts
// agent-app/examples/03-memory/src/main.ts（节选）
const episodicStore = createEpisodicStoreFromEnv({ EPISODIC_STORE: "memory" });
// ③ 情景记忆：归档两条历史会话摘要，再按当前问题向量召回最像的一条
await episodicStore.remember({
  sessionId: "s_old_1",
  summary: "用户咨询了订单 A-1024 的物流",
  embedding: [1, 0.1],
  createdAt: "2026-10-29T08:00:00Z",
});
await episodicStore.remember({
  sessionId: "s_old_2",
  summary: "用户咨询了发票开具流程",
  embedding: [0.1, 1],
  createdAt: "2026-10-29T09:00:00Z",
});
const recalled = await episodicStore.recall([1, 0.05], 1);
console.log(`[情景召回] top1：${recalled[0]?.summary}（score≈${recalled[0]?.score.toFixed(1)}）`);
```

这段在做什么：`remember` 归档的**不是原话，是摘要 + 向量**——为「以前聊过什么」建一条可检索的索引；`recall(向量, k)` 按余弦相似度召回最像的历史会话（查询向量 `[1, 0.05]` 与 s_old_1 的 `[1, 0.1]` 几乎同向，召回的正是物流那条，发票条被拉开）。示例的向量是手造的（绕开 embedding API）；真实实现里向量来自同一个 embedding 模型（RAG 的「同模型铁律」在此同样适用），切 pgvector 后召回下推给 PG 的向量索引，接口不变——`remember ≈ upsert、recall ≈ search`，情景记忆就是一张只加不改的微型知识库。

---

## 三、压缩机制：滚动摘要（本章的核心算法）

会话窗口默认只保留最近 **20 轮**塞给模型（`getWindow` 的 limit）。那第 21 轮之后的历史呢？**压缩**：

```text
触发：会话累计超过 40 条（COMPRESS_AFTER = 40）

> 📈 **演进**：条数不是 token 的合格代理变量——配置 MODEL_CONTEXT_TOKENS（或按模型自动查表）后，压缩改按 **token 水位**触发（窗口 ×75% 触发、压到 ×50% 水位），估算走 memory/token-estimate.ts。详见 memory/compression.ts 头注释与 BACKLOG ①。
        │
        ▼
拆分：旧消息（溢出部分） + 最近 20 条（KEEP_RECENT = 20，原样保留）
        │
        ▼
摘要：旧消息 + 「上一次的滚动摘要」一起交给模型，压成 ≤150 字新摘要
        │
        ▼
落位：[system 轮: "[会话摘要] ..."] + [最近 20 条]  ← 窗口重新变短，信息不归零
```

三个工程细节（都是踩坑后的产物）：

1. **滚动而非全量**：新摘要 = 旧摘要 + 新增旧消息 一起压缩——信息层层浓缩但不重复占空间；
2. **降级路径**：摘要模型不可用（没配 key / 网关挂了）→ 退化为纯窗口截断 + 🧠 轨迹注明——**降级要降得可用**，不阻塞对话；
3. **可注入**：压缩用的 Summarizer 是接口，测试时注入假实现即可离线验证两条路径。

---

## 四、跑起来（先有体感）

```powershell
cd agent-app
pnpm chat
# 连聊几句：「我叫小张，喜欢简洁回答」→ 几轮后问「我是谁？」看它记不记得
# /new      → 开新会话，验证隔离（旧会话内容不再出现）
# /exit     → 退出

# —— 默认存储是内存版：进程退出即失忆（刻意的零配置默认）——
# 切真实持久化（需 Docker）：
pnpm infra:up                                    # 起 postgres + redis
$env:SESSION_STORE = "redis"; pnpm chat          # 会话写进 Redis（TTL 24h，每次写入续期）
# 另开终端验证数据真的在：
docker compose exec redis redis-cli --scan --pattern "agent:sess:*"
```

注意 `pnpm chat` 每次启动生成**新 sessionId**——Redis 里数据虽在，CLI 不会自动接上旧会话；跨刷新恢复要靠 web 端的历史面板（sessionId 存在浏览器 localStorage）。这是「持久化」与「会话恢复」的区别——两者常被混为一谈。

---

## 五、多实现与 env 工厂：依赖倒置的实战

三层记忆 × 多种存储 = **同接口多实现**，由环境变量一键切换：

```env
SESSION_STORE=memory | redis        # 会话窗口
PREFERENCE_STORE=memory | pg        # 用户偏好
EPISODIC_STORE=memory | pgvector    # 情景记忆（向量召回）
```

工厂函数读 env 装配实现，**业务代码零改动**（`chat.service` 只认接口）；不认识的值 → 警告并回退内存默认（离线优先铁律）。行为一致性由**契约测试**背书：同一套断言跑所有实现（memory 常跑，redis/pgvector 在 `RUN_INFRA_TESTS=1` 时跑）——新增第四份实现时挂上契约即可，不用复制断言。

---

## 六、坑与取舍（真实案例）

**坑 1 · 记忆颗粒度（会话历史只存问答文本）**。工具结果不入会话历史 → 多轮追问时模型「手里没料」：实测「先查广东深圳订单、再追问买断订单数」→ 第二轮模型只能反问。解法是把工具结果扫描出的实体注入 system 动态段——**存什么比存多少更重要**。

**坑 2 · 压缩阈值为什么写死 40 而不是动态水位线**？简单、可测、可复现（测试注入假 Summarizer 就能覆盖两条路径）。按 token 数的水位线是更精细的演进方向——先跑通再加复杂度。

**坑 3 · 摘要是「有损压缩」**。被压缩掉的细节不可恢复——涉及关键事实（用户 ID、订单号）的对话不要依赖摘要兜底，重要实体应进偏好/情景层。

---

## 七、动手任务（做完才算通关）

1. `pnpm chat` 里聊满 41 条消息（或临时把 `COMPRESS_AFTER` 改成 6 加速触发），观察 🧠 轨迹事件与摘要内容。
2. 切 `SESSION_STORE=redis`，用 `redis-cli --ttl` 验证「每次写入续期 24h」。
3. **改造**：给 `PreferenceStore` 加一个「记住用户称呼」的小工具，并让 system prompt 消费它。

## 自测题（先凭记忆答，再展开）

1. 滚动摘要的触发条件与落位结构各是什么？
2. 摘要模型挂了会怎样？对话还能继续吗？
3. 「持久化」和「会话恢复」的区别是什么？CLI 重启后 Redis 里的数据还在，为什么接不上旧会话？

<details><summary>答案</summary>

1. 累计超 40 条触发；落位 = `[system: [会话摘要] 滚动摘要] + [最近 20 条原样]`——旧摘要并入新摘要一起压（滚动，非全量重压）。
2. 降级为纯窗口截断（保最近 20 条）+ 🧠 轨迹注明——对话照常，只是更早的历史真丢了。
3. 持久化 = 数据不在进程内存（Redis/pg 可跨进程）；会话恢复 = 客户端**带着同一个 sessionId** 回来。CLI 每次启动生成新 sessionId，数据虽在但没人引用它——所以接不上。

</details>

---

## 延伸

- [参考库 · 三层记忆](/reference/04-memory) —— 11 个文件逐行走读 + 接口契约 + 契约测试挂法
- 上一课：[02 · 手写工具循环](/learn/02-runtime/agent-loop)
- 下一课：[04 · RAG 知识库与检索](/learn/03-capabilities/rag-knowledge-base) —— 记忆管「聊过什么」，RAG 管「世界上有什么」

---

::: info 章节结构说明
本课由 guide 整体迁移而来（原 `/guide/03-memory`）。对照十章结构：核心原理/最小实现（§跑起来段）/工程位置/边界/自测已达标；「先决与环境」由前置行 + [运行环境](/start/environment) 承担；「常见误区」含于自测答案与[深读](/reference/04-memory)。属**整体迁移章例外**。
:::
