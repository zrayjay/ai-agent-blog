// index.ts —— @agent-app/engine 根出口：配置 / 模型工厂 / 手写工具循环 / 轨迹 / JSON 工具 / 安全护栏
// 子域（rag / memory / tools / service）走各自的子路径出口：
//   import { searchKnowledge } from "@agent-app/engine/rag"
//   import { supervise }       from "@agent-app/engine/service"
// 护栏（guardrails）、结果验证（verification）与统一观测（telemetry）不单开子路径出口
// （导出面保持最小），从包根走：
//   import { wrapToolWithGate }    from "@agent-app/engine"
//   import { runWithVerification } from "@agent-app/engine"
//   import { createRunEventRecorder } from "@agent-app/engine"
export * from "./config.js";
export * from "./llm.js";
export * from "./agent-loop.js";
export * from "./trace.js";
export * from "./json-utils.js";
export * from "./guardrails/index.js";
export * from "./run-contract.js";
export * from "./verification/index.js";
export * from "./telemetry/index.js";
