// main.ts —— 03 示例：三层记忆的最小离线形态。
// 三层各演示一个核心动作：窗口追加/读取、偏好写入/读取、情景归档/召回。
// 存储全部来自工厂的内存实现（零密钥）；切 Redis/pgvector 只改 env。
import { createSessionStoreFromEnv } from "@agent-app/engine/memory/factory";
import { createPreferenceStoreFromEnv } from "@agent-app/engine/memory/factory";
import { createEpisodicStoreFromEnv } from "@agent-app/engine/memory/factory";

const sessionStore = createSessionStoreFromEnv({ SESSION_STORE: "memory" });
const preferenceStore = createPreferenceStoreFromEnv({ PREFERENCE_STORE: "memory" });
const episodicStore = createEpisodicStoreFromEnv({ EPISODIC_STORE: "memory" });

// ① 会话窗口：追加两轮再读回
await sessionStore.append("s_001", { role: "user", content: "我叫小张，查一下订单 A-1024" });
await sessionStore.append("s_001", { role: "assistant", content: "你好小张，A-1024 已发货。" });
const window = await sessionStore.getWindow("s_001");
console.log(
  `[会话窗口] ${window.length} 轮：${window[0]?.role}: ${window[0]?.content.slice(0, 10)}… / ${window[1]?.role}: ${window[1]?.content.slice(0, 8)}…`,
);

// ② 用户偏好：写入后读回（跨会话的"认识你"）
await preferenceStore.set("u_001", "回复风格", "简洁，别废话");
const style = await preferenceStore.get("u_001", "回复风格");
console.log(`[偏好] u_001 的回复风格 = ${style}`);

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
