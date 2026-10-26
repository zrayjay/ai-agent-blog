// verification/index.ts —— 结果验证子域 barrel：契约 / 运行器 / 注册表 / 三个内建验证器 / 集成接缝。
// 导出面刻意保持最小：不新增 package.json 的子路径出口，统一从包根出口走（同 guardrails）。
//
//   types.ts                  契约：Verifier / CheckResult / VerificationResult 三态结论
//   runner.ts                 聚合器：取证 → 落账 → passed/failed/inconclusive（never default-pass）
//   registry.ts               id → 工厂 注册表（register/get/create）
//   verifiers/schema.ts       SchemaVerifier：zod 校验产出结构
//   verifiers/tool-execution.ts ToolExecutionVerifier：轨迹核实工具真的跑成过（不信文本自述）
//   verifiers/artifact.ts     ArtifactVerifier：产物存在性 + contains 断言（fs 错误 fail-closed）
//   run-with-verification.ts  runWithVerification：runToolLoop 的验收接缝（循环内部零改动）
export * from "./types.js";
export * from "./runner.js";
export * from "./registry.js";
export * from "./verifiers/schema.js";
export * from "./verifiers/tool-execution.js";
export * from "./verifiers/artifact.js";
export * from "./run-with-verification.js";
