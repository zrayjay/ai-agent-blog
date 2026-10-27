// Personal Agent P1/P2-A: PostgreSQL 业务事实源；不依赖 HTTP/SSE/BullMQ 生命周期。
// 新模块与历史教学 API 隔离。BullMQ 的投递与 Worker 恢复仍在下一阶段实施。
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";

export interface CreateTaskInput {
  ownerId: string;
  conversationId: string;
  agentVersionId: string;
  requestId: string;
  title: string;
}
export interface CreateTaskReceipt { taskId: string; runId: string; created: boolean }
export interface InboxInput {
  ownerId: string; conversationId: string; sourceMessageId: string; text: string;
}
export interface InboxReceipt { messageId: string; seq: number; created: boolean }
export interface RunClaim { runId: string; workerId: string; leaseEpoch: number }
export type TerminalState = "succeeded" | "failed" | "cancelled";
export interface OutboxItem { eventId: string; eventType: string; aggregateId: string; payload: unknown }

export class PlatformIdempotencyConflict extends Error {
  constructor() {
    super("同一幂等键对应不同内容：不能静默覆盖原始任务/消息");
    this.name = "PlatformIdempotencyConflict";
  }
}
function requireField(s: string, name: string, max = 255): string {
  if (typeof s !== "string" || !s.trim() || s.length > max) {
    throw new Error(name + " 必须是 1～" + max + " 字符的非空字符串");
  }
  return s.trim();
}
function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function numberFromPg(value: string | number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("PostgreSQL sequence/epoch 超出 JS 安全整数");
  return result;
}

/**
 * 不抢占会话、不直接派发模型或工具；所有持久事实写在 PostgreSQL 事务内。
 * 如果未知外部副作用已发生，绝不自动将 expired running 转回 queued。
 */
export function createPgPlatformStore(options: {
  connectionString?: string;
  client?: ReturnType<typeof postgres>;
} = {}) {
  const db = options.client ?? postgres(
    options.connectionString ?? process.env.PG_CONNECTION_STRING ??
      "postgres://agent:agent@localhost:5433/agent",
    { max: 5, connect_timeout: 5 },
  );
  const ownsClient = options.client === undefined;
  let ready: Promise<void> | undefined;

  function ensureSchema(): Promise<void> {
    // P1 首批沿用当前 engine 使用的 postgres.js；迁移版本化/Prisma 在后续 PR 完成。
    // 仅创建 pa_ 前缀的独立表，避免覆盖当前 Memory、RAG 和 Session 表。
    ready ??= (async () => {
      await db.unsafe("CREATE TABLE IF NOT EXISTS pa_conversations (" +
        "owner_id text NOT NULL, conversation_id text NOT NULL, next_seq bigint NOT NULL DEFAULT 0, " +
        "reserved_run_id text, PRIMARY KEY(owner_id,conversation_id))");
      await db.unsafe("CREATE TABLE IF NOT EXISTS pa_tasks (" +
        "task_id text PRIMARY KEY, owner_id text NOT NULL, conversation_id text NOT NULL, " +
        "agent_version_id text NOT NULL, request_id text NOT NULL, request_hash text NOT NULL, " +
        "title text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), " +
        "UNIQUE(owner_id,request_id), " +
        "FOREIGN KEY(owner_id,conversation_id) REFERENCES pa_conversations(owner_id,conversation_id))");
      await db.unsafe("CREATE TABLE IF NOT EXISTS pa_runs (" +
        "run_id text PRIMARY KEY, task_id text NOT NULL REFERENCES pa_tasks(task_id), " +
        "state text NOT NULL DEFAULT 'queued', worker_id text, lease_epoch bigint NOT NULL DEFAULT 0, " +
        "lease_expires_at timestamptz, finished_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), " +
        "CONSTRAINT pa_runs_state CHECK (state IN (" +
          "'queued','running','waiting_approval','unknown','succeeded','failed','cancelled')))");
      await db.unsafe("CREATE TABLE IF NOT EXISTS pa_conversation_inbox (" +
        "message_id text PRIMARY KEY, owner_id text NOT NULL, conversation_id text NOT NULL, " +
        "seq bigint NOT NULL, source_message_id text NOT NULL, request_hash text NOT NULL, " +
        "payload jsonb NOT NULL, state text NOT NULL DEFAULT 'pending', " +
        "created_at timestamptz NOT NULL DEFAULT now(), " +
        "UNIQUE(owner_id,conversation_id,seq), UNIQUE(owner_id,source_message_id), " +
        "FOREIGN KEY(owner_id,conversation_id) REFERENCES pa_conversations(owner_id,conversation_id))");
      await db.unsafe("CREATE TABLE IF NOT EXISTS pa_outbox (" +
        "event_id text PRIMARY KEY, event_type text NOT NULL, aggregate_id text NOT NULL, " +
        "payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), " +
        "dispatched_at timestamptz, attempts integer NOT NULL DEFAULT 0)");
      await db.unsafe("CREATE INDEX IF NOT EXISTS pa_outbox_pending_idx " +
        "ON pa_outbox(created_at,event_id) WHERE dispatched_at IS NULL");
      await db.unsafe("CREATE INDEX IF NOT EXISTS pa_runs_ready_idx " +
        "ON pa_runs(created_at) WHERE state='queued'");
    })().catch((error: unknown) => { ready = undefined; throw error; });
    return ready;
  }

  async function createTask(input: CreateTaskInput): Promise<CreateTaskReceipt> {
    const owner = requireField(input.ownerId,"ownerId");
    const conversation = requireField(input.conversationId,"conversationId");
    const agent = requireField(input.agentVersionId,"agentVersionId");
    const request = requireField(input.requestId,"requestId",128);
    const title = requireField(input.title,"title",2048);
    const hash = fingerprint({ conversation, agent, title });
    await ensureSchema();
    return db.begin(async (tx) => {
      await tx.unsafe("INSERT INTO pa_conversations(owner_id,conversation_id) VALUES($1,$2) " +
        "ON CONFLICT DO NOTHING",[owner,conversation]);
      const taskId=randomUUID(), runId=randomUUID();
      const rows=(await tx.unsafe("INSERT INTO pa_tasks " +
        "(task_id,owner_id,conversation_id,agent_version_id,request_id,request_hash,title) " +
        "VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,request_id) DO NOTHING RETURNING task_id",
        [taskId,owner,conversation,agent,request,hash,title])) as unknown as {task_id:string}[];
      if (rows.length===0) {
        const existing=(await tx.unsafe("SELECT t.task_id,t.request_hash,r.run_id FROM pa_tasks t " +
          "JOIN pa_runs r ON r.task_id=t.task_id WHERE t.owner_id=$1 AND t.request_id=$2",
          [owner,request])) as unknown as {task_id:string;request_hash:string;run_id:string}[];
        if (existing.length!==1 || existing[0]!.request_hash!==hash) throw new PlatformIdempotencyConflict();
        return { taskId:existing[0]!.task_id,runId:existing[0]!.run_id,created:false };
      }
      await tx.unsafe("INSERT INTO pa_runs(run_id,task_id) VALUES($1,$2)",[runId,taskId]);
      await tx.unsafe("INSERT INTO pa_outbox(event_id,event_type,aggregate_id,payload) " +
        "VALUES($1,'run.ready',$2,$3::jsonb)",
        [randomUUID(),runId,JSON.stringify({ownerId:owner,taskId,runId})]);
      return {taskId,runId,created:true};
    });
  }

  async function enqueueMessage(input: InboxInput): Promise<InboxReceipt> {
    const owner=requireField(input.ownerId,"ownerId");
    const conversation=requireField(input.conversationId,"conversationId");
    const source=requireField(input.sourceMessageId,"sourceMessageId",128);
    const text=requireField(input.text,"text",64000);
    const hash=fingerprint({conversation,text});
    await ensureSchema();
    return db.begin(async (tx) => {
      await tx.unsafe("INSERT INTO pa_conversations(owner_id,conversation_id) VALUES($1,$2) " +
        "ON CONFLICT DO NOTHING",[owner,conversation]);
      // 锁住会话计数器使同会话消息按真正落库顺序分配 seq。
      const cursor=(await tx.unsafe("SELECT next_seq FROM pa_conversations " +
        "WHERE owner_id=$1 AND conversation_id=$2 FOR UPDATE",
        [owner,conversation])) as unknown as {next_seq:string}[];
      const existing=(await tx.unsafe("SELECT message_id,seq,request_hash " +
        "FROM pa_conversation_inbox WHERE owner_id=$1 AND source_message_id=$2",
        [owner,source])) as unknown as {message_id:string;seq:string;request_hash:string}[];
      if (existing.length) {
        if(existing[0]!.request_hash!==hash) throw new PlatformIdempotencyConflict();
        return {messageId:existing[0]!.message_id,seq:numberFromPg(existing[0]!.seq),created:false};
      }
      const seq=numberFromPg(cursor[0]!.next_seq)+1;
      const messageId=randomUUID();
      const inserted=(await tx.unsafe("INSERT INTO pa_conversation_inbox " +
        "(message_id,owner_id,conversation_id,seq,source_message_id,request_hash,payload) " +
        "VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) " +
        "ON CONFLICT(owner_id,source_message_id) DO NOTHING RETURNING message_id",
        [messageId,owner,conversation,seq,source,hash,JSON.stringify({text})])) as unknown as {message_id:string}[];
      if (!inserted.length) {
        // 相同 sourceId 并发落在不同 conversation 的极端情况：
        // 不会双处理，可能有 seq 间隙，但不会丢消息。
        const other=(await tx.unsafe("SELECT message_id,seq,request_hash FROM pa_conversation_inbox " +
          "WHERE owner_id=$1 AND source_message_id=$2",[owner,source])) as unknown as
          {message_id:string;seq:string;request_hash:string}[];
        if(other.length!==1 || other[0]!.request_hash!==hash) throw new PlatformIdempotencyConflict();
        return {messageId:other[0]!.message_id,seq:numberFromPg(other[0]!.seq),created:false};
      }
      await tx.unsafe("UPDATE pa_conversations SET next_seq=$3 WHERE owner_id=$1 AND conversation_id=$2",
        [owner,conversation,seq]);
      await tx.unsafe("INSERT INTO pa_outbox(event_id,event_type,aggregate_id,payload) " +
        "VALUES($1,'wake.pending',$2,$3::jsonb)",
        [randomUUID(),messageId,JSON.stringify({ownerId:owner,conversationId:conversation,messageId,seq})]);
      return {messageId,seq,created:true};
    });
  }

  /** Outbox 是持久事实；P2-A 再实现多 Relay 抢占和 BullMQ 发信确认。 */
  async function pendingOutbox(limit=100): Promise<OutboxItem[]> {
    if(!Number.isInteger(limit)||limit<1||limit>500) throw new Error("limit 必须介于 1～500");
    await ensureSchema();
    const rows=(await db.unsafe("SELECT event_id,event_type,aggregate_id,payload " +
      "FROM pa_outbox WHERE dispatched_at IS NULL ORDER BY created_at,event_id LIMIT $1",
      [limit])) as unknown as {event_id:string;event_type:string;aggregate_id:string;payload:unknown}[];
    return rows.map(r=>({eventId:r.event_id,eventType:r.event_type,aggregateId:r.aggregate_id,payload:r.payload}));
  }

  /**
   * 同会话只能有一个有效预约；只能领取 queued（不会盲目重跑 crash 后的 running）。
   * 不使用 BullMQ 锁替代数据库会话独占与递增 epoch。
   */
  async function claimRun(input:{
    ownerId:string;runId:string;workerId:string;leaseMs:number;
  }):Promise<RunClaim|null> {
    const owner=requireField(input.ownerId,"ownerId");
    const runId=requireField(input.runId,"runId");
    const worker=requireField(input.workerId,"workerId");
    if(!Number.isInteger(input.leaseMs)||input.leaseMs<5000||input.leaseMs>3600000)
      throw new Error("leaseMs 必须在 5000～3600000 之间");
    await ensureSchema();
    return db.begin(async tx=>{
      const ownerRows=(await tx.unsafe("SELECT t.conversation_id FROM pa_runs r " +
        "JOIN pa_tasks t ON t.task_id=r.task_id WHERE r.run_id=$1 AND t.owner_id=$2",
        [runId,owner])) as unknown as {conversation_id:string}[];
      if(ownerRows.length!==1) return null;
      const conv=ownerRows[0]!.conversation_id;
      const reservation=(await tx.unsafe("SELECT reserved_run_id FROM pa_conversations " +
        "WHERE owner_id=$1 AND conversation_id=$2 FOR UPDATE",
        [owner,conv])) as unknown as {reserved_run_id:string|null}[];
      if(reservation.length!==1 || (reservation[0]!.reserved_run_id!==null &&
          reservation[0]!.reserved_run_id!==runId)) return null;
      const updated=(await tx.unsafe("UPDATE pa_runs SET state='running',worker_id=$2," +
        "lease_epoch=lease_epoch+1,lease_expires_at=now()+($3::integer * interval '1 millisecond') " +
        "WHERE run_id=$1 AND state='queued' RETURNING lease_epoch",
        [runId,worker,input.leaseMs])) as unknown as {lease_epoch:string}[];
      if(!updated.length) return null;
      await tx.unsafe("UPDATE pa_conversations SET reserved_run_id=$3 " +
        "WHERE owner_id=$1 AND conversation_id=$2",[owner,conv,runId]);
      return {runId,workerId:worker,leaseEpoch:numberFromPg(updated[0]!.lease_epoch)};
    });
  }

  async function heartbeat(claim:RunClaim,leaseMs:number):Promise<boolean> {
    if(!Number.isInteger(leaseMs)||leaseMs<5000||leaseMs>3600000)
      throw new Error("leaseMs 必须在 5000～3600000 之间");
    await ensureSchema();
    const rows=(await db.unsafe("UPDATE pa_runs SET " +
      "lease_expires_at=now()+($4::integer * interval '1 millisecond') " +
      "WHERE run_id=$1 AND worker_id=$2 AND lease_epoch=$3 " +
      "AND state='running' AND lease_expires_at>now() RETURNING run_id",
      [claim.runId,claim.workerId,claim.leaseEpoch,leaseMs])) as unknown as {run_id:string}[];
    return rows.length===1;
  }

  async function finishRun(input:{
    ownerId:string;claim:RunClaim;state:TerminalState;
  }):Promise<boolean> {
    const owner=requireField(input.ownerId,"ownerId");
    if(!["succeeded","failed","cancelled"].includes(input.state)) throw new Error("非法终态");
    await ensureSchema();
    return db.begin(async tx=>{
      const ownerRows=(await tx.unsafe("SELECT t.conversation_id FROM pa_runs r " +
        "JOIN pa_tasks t ON t.task_id=r.task_id WHERE r.run_id=$1 AND t.owner_id=$2",
        [input.claim.runId,owner])) as unknown as {conversation_id:string}[];
      if(ownerRows.length!==1) return false;
      const conv=ownerRows[0]!.conversation_id;
      const reservation=(await tx.unsafe("SELECT reserved_run_id FROM pa_conversations " +
        "WHERE owner_id=$1 AND conversation_id=$2 FOR UPDATE",
        [owner,conv])) as unknown as {reserved_run_id:string|null}[];
      if(reservation[0]?.reserved_run_id!==input.claim.runId) return false;
      const done=(await tx.unsafe("UPDATE pa_runs SET state=$4,finished_at=now()," +
        "worker_id=NULL,lease_expires_at=NULL WHERE run_id=$1 AND worker_id=$2 " +
        "AND lease_epoch=$3 AND state='running' AND lease_expires_at>now() RETURNING run_id",
        [input.claim.runId,input.claim.workerId,input.claim.leaseEpoch,input.state])) as unknown as {run_id:string}[];
      if(!done.length) return false;
      await tx.unsafe("UPDATE pa_conversations SET reserved_run_id=NULL " +
        "WHERE owner_id=$1 AND conversation_id=$2 AND reserved_run_id=$3",
        [owner,conv,input.claim.runId]);
      await tx.unsafe("INSERT INTO pa_outbox(event_id,event_type,aggregate_id,payload) " +
        "VALUES($1,'run.finished',$2,$3::jsonb)",
        [randomUUID(),input.claim.runId,JSON.stringify({runId:input.claim.runId,state:input.state})]);
      return true;
    });
  }

  async function close():Promise<void> { if(ownsClient) await db.end(); }
  return {ensureSchema,createTask,enqueueMessage,pendingOutbox,claimRun,heartbeat,finishRun,close};
}
