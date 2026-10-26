// telemetry/index.ts —— 统一观测子域 barrel：事件模型 / 脱敏政策 / 记录器 / 指标聚合。
// 导出面刻意保持最小：不新增 package.json 的子路径出口，统一从包根出口走
// （同 guardrails / verification 的纪律）。
//
//   events.ts     AgentRunEvent 数据形状 + 事件类型目录（发射点接线图在目录注释里）
//   redact.ts     redactEvent：sink 出口脱敏政策（fail-safe 默认开）
//   recorder.ts   createRunEventRecorder：内存总账 + 脱敏分发 + stderr JSON 行 sink
//   metrics.ts    computeRunMetrics：事件流 → Run 看板指标（分母规则显式成文）
export * from "./events.js";
export * from "./redact.js";
export * from "./recorder.js";
export * from "./metrics.js";
