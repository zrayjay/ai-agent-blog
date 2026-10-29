// main.spec.ts —— 03 示例的离线确定性测试（CI 必跑，零密钥）。
// 断言三层记忆的接口契约：窗口保序、偏好覆盖即改口、情景召回按相似度降序。
import { describe, expect, it } from "vitest";
import {
  createSessionStoreFromEnv,
  createPreferenceStoreFromEnv,
  createEpisodicStoreFromEnv,
} from "@agent-app/engine/memory/factory";

describe("03-memory", () => {
  it("会话窗口：append 保序，getWindow 返回最近 N 轮", async () => {
    const store = createSessionStoreFromEnv({ SESSION_STORE: "memory" });
    for (let i = 1; i <= 5; i++) {
      await store.append("s", { role: "user", content: `第 ${i} 轮` });
    }
    const window = await store.getWindow("s", 2);
    expect(window.map((t) => t.content)).toEqual(["第 4 轮", "第 5 轮"]);
    const all = await store.getHistory("s");
    expect(all).toHaveLength(5);
    await store.clear("s");
    expect(await store.getWindow("s")).toEqual([]);
  });

  it("偏好：set 覆盖即改口，all 返回全表", async () => {
    const store = createPreferenceStoreFromEnv({ PREFERENCE_STORE: "memory" });
    await store.set("u", "风格", "详细");
    await store.set("u", "风格", "简洁"); // 改口 = 同键再写
    expect(await store.get("u", "风格")).toBe("简洁");
    expect(await store.all("u")).toEqual({ 风格: "简洁" });
    expect(await store.get("u", "不存在")).toBeNull();
  });

  it("情景召回：按余弦相似度降序，top-k 数量正确", async () => {
    const store = createEpisodicStoreFromEnv({ EPISODIC_STORE: "memory" });
    await store.remember({
      sessionId: "a",
      summary: "订单物流",
      embedding: [1, 0],
      createdAt: "2026-10-29T08:00:00Z",
    });
    await store.remember({
      sessionId: "b",
      summary: "发票流程",
      embedding: [0, 1],
      createdAt: "2026-10-29T09:00:00Z",
    });
    const hits = await store.recall([0.9, 0.1], 2);
    expect(hits[0]?.sessionId).toBe("a"); // 与 [1,0] 更像
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0);
  });
});
