# Verified Run Quality Gate · Personal Agent 代码实施第 1 批

> 状态：`feat/personal-agent-evaluation-bridge` 中的首批真实代码；本文件描述**已新增的严格评估入口**，不代表 Agent Factory、持久队列或发布 API 已经落地。后续整体计划见 `docs/personal-agent/05-EVALUATION-ARCHITECTURE.md`（位于规划 PR #1，合并后可直接访问）。

## 目标

现有 `VerificationRunner([])` 在没有配置验证器时可能返回 `passed`，同时现有 `QualityGateInput.checks` 是可选的。这些行为对于独立引擎/本地离线评测合理，但如果未来直接用作用户创建 Agent 的**发布许可**，就会有空验收导致误放的风险。

新增 `packages/engine/src/evals/verified-run-gate.ts`，通过桶出口 `@agent-app/engine/evals` 暴露：

- `toRequiredVerificationCheck(...)`：Run 身份与必需 Verifier Evidence 显式核验，输出 `passed/failed/inconclusive`。
- `evaluateVerifiedRunGate(...)`：与现有 `evaluateQualityGate` 的 R1–R6 规则并用，以 `R6-check:verification:required-run-evidence` 输出独立可解释规则。默认 FULL 策略。
- `RUN_VERIFICATION_GATE_CHECK_ID`：不可由传入 `checks` 伪装的专用检查 ID。

## 接口范例

```ts
import {
  evaluateVerifiedRunGate,
  QUALITY_GATE_POLICY_FULL,
} from "@agent-app/engine/evals";

const outcome = evaluateVerifiedRunGate({
  report: offlineEvalReport,
  baselineViolations: baselineIssues,
  criticalViolations: criticalIssues,
  expectedRunId: trustedRun.id,
  requiredVerifierIds: ["schema", "tool-execution"],
  verification: trustedRun.verificationResult,
}, QUALITY_GATE_POLICY_FULL);

// 只有 passed 才可能进入发布审批；failed/inconclusive 必须阻断并补证据。
if (outcome.status !== "passed") {
  throw new Error("评估未满足要求，不允许发布 AgentVersion");
}
```

上例是**上层 Factory/Backend 后续调用方式示意**，不是一个已经存在的 API；`trustedRun` 数据必须由鉴权后的服务端从持久化存储加载，不能信任浏览器提交或 Agent 自述。

## 实现契约

| 场景 | 结论 |
| --- | --- |
| 没有 VerificationResult 或必需 verifier 配置 | `inconclusive` |
| 运行 ID 与可信目标不匹配 | `failed` |
| VerificationRunner 空 checks 但 status=passed | `inconclusive` |
| 必需 verifier 未执行或被跳过 | `inconclusive` |
| 必需 verifier 中任一 failed | `failed` |
| 验收真实通过 + 所有要求的 Eval 套件通过 | `passed` |
| FULL 要求的 retrieval/judge 缺席 | `inconclusive`，CI_TIER1 的绿灯不能当发布结论 |

**重要**：这一步仅完成评估数据的接缝和组合裁决，**没有**实现 AgentVersion/Run 授权绑定、报告签名、工厂发布事务、Evals 数据集 per-Agent 隔离，也未修改既有 CLI 默认路径。未来 P2/P3 落地后，需要服务器加载身份绑定的报告并将 Gate 接到发布 API，执行前再检查授权；否则不能视为产品级发布安全保证。

## 本 PR 验证范围

新增 `test/verified-run-gate.spec.ts` 覆盖真实 VerificationRunner 接入、缺证据、身份不一致、空结果、错配、必需失败/跳过、伪造可选检查、既有 Eval 失败优先级与 FULL/Tier1 差异。

执行（从 `agent-app` 目录）：

```bash
pnpm install --frozen-lockfile
pnpm --filter @agent-app/engine typecheck
pnpm --filter @agent-app/engine exec vitest run test/verified-run-gate.spec.ts
pnpm test:engine
```

**测试事实必须以 PR 的实际 CI / 命令执行输出为准**。若自动测试环境不可用，不得将新增测试用例数等同于“已通过”。
