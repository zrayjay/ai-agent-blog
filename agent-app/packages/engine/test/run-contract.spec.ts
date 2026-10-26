// run-contract.spec.ts —— Run 数据契约的行为测试（离线、确定性，无基础设施门控）
// 覆盖四个面：终态守卫（终态不可被改写 / 同终态幂等）、迁移表完整性（全键覆盖 +
// 表项合法性）、isTerminalRunStatus 纯函数判定、RunOutcome/RunIdentifiers 形状消费。
import { describe, expect, it } from "vitest";
import {
  RUN_TERMINAL_STATUSES,
  RUN_TRANSITIONS,
  RunStatusTransitionError,
  assertRunStatusTransition,
  isTerminalRunStatus,
} from "../src/run-contract.js";
import type { RunIdentifiers, RunOutcome, RunStatus } from "../src/run-contract.js";

const ALL_STATUSES: readonly RunStatus[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
];

describe("终态守卫 assertRunStatusTransition", () => {
  it("succeeded → running 拒绝：终态不可被非终态改写", () => {
    expect(() => assertRunStatusTransition("succeeded", "running")).toThrow(RunStatusTransitionError);
  });

  it("failed → failed 幂等放行：同终态重落盘不炸", () => {
    expect(() => assertRunStatusTransition("failed", "failed")).not.toThrow();
  });

  it("timed_out 不可被改写：换别的终态、回活动态都拒绝，自转发放行", () => {
    expect(() => assertRunStatusTransition("timed_out", "running")).toThrow(RunStatusTransitionError);
    expect(() => assertRunStatusTransition("timed_out", "succeeded")).toThrow(RunStatusTransitionError);
    expect(() => assertRunStatusTransition("timed_out", "timed_out")).not.toThrow();
  });

  it("其余终态同理：cancelled 只认自身，succeeded/failed 拒绝一切其它状态", () => {
    for (const terminal of RUN_TERMINAL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (to === terminal) {
          expect(() => assertRunStatusTransition(terminal, to)).not.toThrow();
        } else {
          expect(() => assertRunStatusTransition(terminal, to)).toThrow(RunStatusTransitionError);
        }
      }
    }
  });

  it("活动态前向迁移合法：queued → running、running → 四终态", () => {
    expect(() => assertRunStatusTransition("queued", "running")).not.toThrow();
    for (const terminal of RUN_TERMINAL_STATUSES) {
      expect(() => assertRunStatusTransition("running", terminal)).not.toThrow();
    }
  });

  it("非法错误携带中文指引（错误礼仪：文案给人读）", () => {
    expect(() => assertRunStatusTransition("succeeded", "running")).toThrow(/RUN_TRANSITIONS/);
  });
});

describe("迁移表 RUN_TRANSITIONS 完整性", () => {
  it("每个 RunStatus 都有表项（键无遗漏）", () => {
    for (const status of ALL_STATUSES) {
      expect(RUN_TRANSITIONS[status]).toBeDefined();
    }
  });

  it("每个表项的出边都是合法 RunStatus（无幽灵状态）", () => {
    for (const targets of Object.values(RUN_TRANSITIONS)) {
      for (const to of targets) {
        expect(ALL_STATUSES).toContain(to);
      }
    }
  });

  it("终态行只含自身（幂等重放是唯一出边）", () => {
    for (const terminal of RUN_TERMINAL_STATUSES) {
      expect(RUN_TRANSITIONS[terminal]).toEqual([terminal]);
    }
  });

  it("活动态行不含自身重入，且与守护函数口径一致（表即唯一依据）", () => {
    expect(RUN_TRANSITIONS.queued).not.toContain("queued");
    expect(RUN_TRANSITIONS.running).not.toContain("running");
    for (const from of ALL_STATUSES) {
      for (const to of RUN_TRANSITIONS[from]) {
        expect(() => assertRunStatusTransition(from, to)).not.toThrow();
      }
    }
  });
});

describe("isTerminalRunStatus 纯函数判定", () => {
  it("四个终态 → true；queued/running → false", () => {
    for (const terminal of RUN_TERMINAL_STATUSES) {
      expect(isTerminalRunStatus(terminal)).toBe(true);
    }
    expect(isTerminalRunStatus("queued")).toBe(false);
    expect(isTerminalRunStatus("running")).toBe(false);
  });

  it("类型守卫收窄：true 分支里 status 可赋给 TerminalRunStatus", () => {
    const status: RunStatus = "failed";
    if (isTerminalRunStatus(status)) {
      const terminal: (typeof RUN_TERMINAL_STATUSES)[number] = status;
      expect(terminal).toBe("failed");
    } else {
      throw new Error("failed 应被判定为终态");
    }
  });
});

describe("契约形状消费（RunIdentifiers / RunOutcome）", () => {
  it("RunIdentifiers：attempt 从 1 起，编排/评测关联字段可缺省", () => {
    const ids: RunIdentifiers = {
      runId: "run-1",
      taskId: "task-1",
      agentId: "order-worker",
      attempt: 1,
      traceId: "trace-1",
      datasetId: "eval-v3",
      caseId: "traj-01",
    };
    expect(ids.attempt).toBeGreaterThanOrEqual(1);
    expect(ids.parentRunId).toBeUndefined();
  });

  it("RunOutcome：status 只收终态字面量，error 记录裁决原因", () => {
    const outcome: RunOutcome = {
      runId: "run-1",
      status: "failed",
      startedAt: "2026-10-26T00:00:00.000Z",
      finishedAt: "2026-10-26T00:00:01.000Z",
      error: { code: "STEP_BUDGET_EXHAUSTED", message: "步数用完（5），模型仍在要工具", retryable: true },
    };
    expect(RUN_TERMINAL_STATUSES).toContain(outcome.status);
  });

  it("succeeded 的 RunOutcome 不必带 error（流程正常结束 ≠ 验收通过，验收归 verification）", () => {
    const outcome: RunOutcome = {
      runId: "run-2",
      status: "succeeded",
      startedAt: "2026-10-26T00:00:00.000Z",
      finishedAt: "2026-10-26T00:00:01.000Z",
      output: "已完成",
    };
    expect(outcome.error).toBeUndefined();
  });
});
