// 真实 PG 契约集成测试：只在 RUN_PLATFORM_PG_TESTS=1 时执行。
// GitHub Actions 的 platform-store job 负责提供隔离的 PostgreSQL 服务。
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPgPlatformStore,
  PlatformIdempotencyConflict,
} from "../src/platform/index.js";

const active = process.env.RUN_PLATFORM_PG_TESTS === "1";
const suite = active ? describe : describe.skip;
const prefix = randomUUID();
const owner = "test-owner-" + prefix;
const conversation = "conv-" + prefix;
const agentVersionId = "agent-v1";
const store = createPgPlatformStore({
  connectionString: process.env.PG_CONNECTION_STRING ?? "postgres://agent:agent@localhost:5433/agent",
});

suite("Personal Agent PostgreSQL atomic Task/Wake/Run contract", () => {
  beforeAll(async () => { await store.ensureSchema(); });
  afterAll(async () => { await store.close(); });

  it("同一 Task 幂等键返回相同 taskId/runId，只写一次 run.ready outbox", async () => {
    const input = {
      ownerId: owner, conversationId: conversation, agentVersionId,
      requestId: "request-1", title: "创建研究任务",
    };
    const first = await store.createTask(input);
    const repeated = await store.createTask(input);
    expect(first.created).toBe(true);
    expect(repeated).toEqual({ ...first, created: false });
    const events = (await store.pendingOutbox(500)).filter(e => e.aggregateId === first.runId);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("run.ready");
  });

  it("同一 requestId 但内容不同必须拒绝；与 ownerId 无关的作用域不串", async () => {
    const base = {
      ownerId: owner, conversationId: conversation, agentVersionId,
      requestId: "request-conflict", title: "原始目标",
    };
    await store.createTask(base);
    await expect(store.createTask({ ...base, title: "偷偷替换的目标" }))
      .rejects.toBeInstanceOf(PlatformIdempotencyConflict);
    const other = await store.createTask({ ...base, ownerId: "another-" + prefix });
    expect(other.created).toBe(true);
  });

  it("同会话连续 20 条并发消息 seq 有序，重复唤醒不丢正文不生成第二个 outbox", async () => {
    const inputs = Array.from({length:20}, (_,i) => ({
      ownerId: owner, conversationId: conversation,
      sourceMessageId: "msg-" + i, text: "用户消息 " + i,
    }));
    const messages = await Promise.all(inputs.map(x => store.enqueueMessage(x)));
    expect(messages.map(x => x.seq).sort((a,b) => a-b)).toEqual(
      Array.from({length:20},(_,i) => i+1)
    );
    expect(new Set(messages.map(x => x.messageId)).size).toBe(20);
    const replay = await Promise.all(inputs.map(x => store.enqueueMessage(x)));
    expect(replay.every(x => !x.created)).toBe(true);
    expect(replay.map(x => x.messageId)).toEqual(messages.map(x => x.messageId));
    const events = await store.pendingOutbox(500);
    expect(events.filter(x => messages.some(m => m.messageId === x.aggregateId)))
      .toHaveLength(20);
  });

  it("一个消息 ID 冲突时不接受不同正文/会话，重复 HTTP 不制造额外任务", async () => {
    const orig = {
      ownerId: owner, conversationId: conversation,
      sourceMessageId: "unique-content", text: "原消息",
    };
    const first = await store.enqueueMessage(orig);
    await expect(store.enqueueMessage({ ...orig, text: "替换消息" }))
      .rejects.toBeInstanceOf(PlatformIdempotencyConflict);
    const replay = await store.enqueueMessage(orig);
    expect(replay.messageId).toBe(first.messageId);
    expect(replay.seq).toBe(first.seq);
  });

  it("同会话只能一个 Run 执行；终态释放会话预约后另一个 Run 才能领取", async () => {
    const a = await store.createTask({
      ownerId: owner, conversationId: conversation, agentVersionId,
      requestId: "claim-a", title: "任务 A",
    });
    const b = await store.createTask({
      ownerId: owner, conversationId: conversation, agentVersionId,
      requestId: "claim-b", title: "任务 B",
    });
    const first = await store.claimRun({
      ownerId: owner, runId: a.runId, workerId:"worker-a", leaseMs:30000,
    });
    expect(first).not.toBeNull();
    const conflicting = await store.claimRun({
      ownerId: owner, runId: b.runId, workerId:"worker-b", leaseMs:30000,
    });
    expect(conflicting).toBeNull();
    expect(await store.claimRun({
      ownerId: owner, runId: a.runId, workerId:"worker-c", leaseMs:30000,
    })).toBeNull();
    expect(await store.heartbeat(first!,30000)).toBe(true);
    expect(await store.finishRun({ownerId:owner,claim:first!,state:"succeeded"})).toBe(true);
    expect(await store.finishRun({ownerId:owner,claim:first!,state:"succeeded"})).toBe(false);
    const second = await store.claimRun({
      ownerId:owner,runId:b.runId,workerId:"worker-b",leaseMs:30000,
    });
    expect(second).not.toBeNull();
    expect(await store.finishRun({ownerId:owner,claim:second!,state:"failed"})).toBe(true);
  });

  it("不同会话允许并发，owner 不匹配不能领取其他用户的 Run", async () => {
    const a = await store.createTask({
      ownerId:owner,conversationId:"new-conv-a-" + prefix,agentVersionId,
      requestId:"other-a",title:"独立 A",
    });
    const b = await store.createTask({
      ownerId:owner,conversationId:"new-conv-b-" + prefix,agentVersionId,
      requestId:"other-b",title:"独立 B",
    });
    expect(await store.claimRun({
      ownerId:"forbidden",runId:a.runId,workerId:"bad",leaseMs:30000,
    })).toBeNull();
    const claims = await Promise.all([a,b].map((task,i)=>store.claimRun({
      ownerId:owner,runId:task.runId,workerId:"parallel-"+i,leaseMs:30000,
    })));
    expect(claims.every(Boolean)).toBe(true);
    expect(await store.finishRun({ownerId:owner,claim:claims[0]!,state:"succeeded"})).toBe(true);
    expect(await store.finishRun({ownerId:owner,claim:claims[1]!,state:"succeeded"})).toBe(true);
  });

  it("旧 lease epoch/过期 lease 不能心跳或伪造成功，running 不会盲目重跑", async () => {
    const task = await store.createTask({
      ownerId:owner,conversationId:"lease-" + prefix,agentVersionId,
      requestId:"expired",title:"等待结果确认",
    });
    const claim = await store.claimRun({
      ownerId:owner,runId:task.runId,workerId:"worker-before-crash",leaseMs:5000,
    });
    expect(claim).not.toBeNull();
    expect(await store.heartbeat({ ...claim!, leaseEpoch:claim!.leaseEpoch+1 },5000)).toBe(false);
    const other = await store.claimRun({
      ownerId:owner,runId:task.runId,workerId:"worker-after-crash",leaseMs:30000,
    });
    expect(other).toBeNull();
    expect(await store.finishRun({
      ownerId:owner,claim:{...claim!,leaseEpoch:claim!.leaseEpoch+1},state:"succeeded",
    })).toBe(false);
    expect(await store.finishRun({ownerId:owner,claim:claim!,state:"cancelled"})).toBe(true);
  });
});
