# P3-04 · service/RAG 解耦可行性评估（结论：不迁移）

- 状态：Accepted（2026-10-30）
- 关联任务：P3-04（本文件即其交付物）；上位依据：ADR-0004（先立规不拆包）、compatibility-baseline.md §4（导出面即契约）

## 评估问题

`packages/engine/src/service/`（客服领域：supervisor 路由 + 三工人 + handoff 转人工，3 文件 375 行）与 `src/rag/`（知识库检索零件）是否应从 engine 拆出为独立包？ADR-0004 的拆包门槛是三条**全部**满足并经新 ADR 批准：真实依赖循环 / 职责混杂导致构建成本可量化上升 / 存在独立复用方。

## 逐门槛评估（2026-10-30 实测）

### 门槛 1：真实依赖循环 —— 不满足

- `pnpm lint:deps`（124 modules，dependency-cruiser 循环规则）：0 violations——engine 内部无任何循环（「引擎-禁止循环依赖」规则自 2026-09 在位）。
- service 与 rag 的依赖方向：service → kernel（agent-loop/types）+ shared（2 处 type-only）；rag → kernel + guardrails 两纯函数模块（红队 H1 豁免）。单向、无环。

### 门槛 2：职责混杂导致构建成本可量化上升 —— 不满足

- engine 整包 `pnpm build`（tsc）在 turbo 缓存命中时为秒级（实测 CI test job 全链 49s–1m22s，含三包构建 + 全部测试）；无证据表明 service 子目录拖慢构建。
- service 与 rag 无相互 import（grep 实证 0 条）——「拆开减少耦合」的收益前提不存在。

### 门槛 3：存在独立复用方 —— 不满足（且预期未来也低）

- service 消费方仅 2 个：`apps/api/src/service/service.controller.ts`（HTTP 端点）与 `apps/cli/src/apps/service/cli.ts`（REPL）——都在本仓库、都是「客服产品线」的宿主。
- rag 消费方：api/cli/examples/examples spec 等 17 处 import——全是学习场景与本仓应用，无外部仓库复用方。
- 拆出后 api/cli/examples 三端都要改 workspace 依赖声明——纯迁移成本，无新增复用收益。

### 附带核对：兼容性红线

ADR-0004 要求任何迁移保持现有导出与调用方兼容（迁移需薄代理层）。实测导出面消费：api/cli 对 `@agent-app/engine/service` 共 6 处 import（supervise/runWorker/buildHandoffPack/formatHandoffPack/handoffReply/isUnresolvedSignal）——迁移将触碰全部 6 处 + 包 exports 变更（compatibility-baseline §4 红线），进一步支持不迁移。

## 结论

**不迁移。** 三门槛全部不满足；service 与 rag 留在 engine 内（层次：service=L3 产品层、rag=L1 最底层特性，与 dependency-cruiser 分层地图一致）。触发重评的条件（ADR-0004 同款）：出现仓库外复用方 / engine 构建耗时因规模增长不可接受 / dependency-cruiser 报出涉及 service 或 rag 的新循环。

## 后果

- 正面：零迁移成本、导出面契约（6 处 import + 包 exports）继续由 compatibility-baseline §4 与 lint:deps 守护；P4 的「有证据的模块提取」以同样门槛逐模块评估。
- 负面：若未来出现真实复用方，届时需补 ADR + 兼容层，迁移成本高于今日——但「无证据不迁移」优于「为拆而拆」。
