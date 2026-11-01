---
type: lesson
lessonId: multi-agent-orchestration
stage: 04-orchestration
order: 95
status: implemented
prerequisites:
  - tools-hardening
source:
  - agent-app/packages/engine/src/orchestrator/
tests:
  - agent-app/packages/engine/test/orchestrator.spec.ts
  - agent-app/packages/engine/test/failure-cases.spec.ts
lastVerifiedCommit: 4ba8887
---

# 多 Agent 编排：拆 · 派 · 跑

> **这一站解决「单 Agent 什么时候不够用、不够用了怎么办」**。上一站客服系统的 Supervisor 已经是多 Agent 的第一形态（路由 Agent + 三个专家工人）——本站把它泛化成可配置的编排器：LLM 把目标拆成子任务单、按依赖 DAG 并行派发、逐任务验收，失败有四分支退路，全程预算受控。配套代码 `packages/engine/src/orchestrator/`，一条命令体验：`pnpm cli team "目标"`。

**前置**：[05 · 工具层加固](/learn/03-capabilities/tools-hardening)（幂等壳/审批壳在编排里继续复用）· 建议先读 [09 · 产品线组装](/learn/07-applications/service-product-line)（Supervisor 是本站的第一形态）
**深讲**：[参考库 · 编排器](/reference/10-orchestrator)（代码走读 / 设计取舍 / 面试级追问）

---

## 一、为什么：单 Agent 的四个「超过」信号

单 Agent 够用时**不要拆**（[02 站岔路 3](/learn/02-runtime/agent-loop)）。出现以下信号且全部满足时，拆分才是可管理的工程：

| 信号           | 症状                                                       |
| -------------- | ---------------------------------------------------------- |
| 工具表超载     | 单 Agent 塞 20+ 工具，选错率飙升                           |
| 上下文需要隔离 | 不同子任务的 system prompt 互相打架                        |
| 职责冲突       | 同一 prompt 同时要求「严谨查询」和「灵活创作」，行为不稳定 |
| 并行机会       | 子任务互不依赖，拆开能并行提速                             |

**何时不拆**——能 Workflow 别 Agent，能单 Agent 别多 Agent。拆分是代价高昂的重构（跨 Agent 传状态、失败传播、调试复杂度全部翻倍）。

递进关系一句话：**09 站的 Supervisor 是「按业务域」切的第一形态；编排器是「任意切法」的通用形态**。

---

## 二、核心框架：拆 · 派 · 跑

编排的全生命周期就是三个字，每个字对应一组工程问题：

| 字                 | 问题               | 编排器的回应                                                                                                      |
| ------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **拆**（Split）    | 大任务怎么变小任务 | `Planner` 接口：LLM 动态拆单，或调用方给静态任务单；产物 = `TaskSpec[]`（id / goal / dependsOn / **acceptance**） |
| **派**（Dispatch） | 小任务分配给谁执行 | 依赖图分波：入度 0 的任务**同波并行**，完成后解锁下游；每任务最小权限工具表                                       |
| **跑**（Run）      | 协作不打架         | 显式状态机 + 逐任务验收 + 失败四分支 + 预算 + 事件流                                                              |

### 三条生产级语义（玩具没有的分水岭）

1. **验收闭环**——「完成」必须有显式定义。每个子任务带 `acceptance` 标准（`contains` 关键词 / `llm-judge` 对照 rubric / `manual` 人工），产出先过 Critic：不达标**打回重做**，`manual` 直接升级人工。全部子任务完成后还有编排级终审。
2. **失败四分支**——子任务失败不是只有「报错」一条路：`retry`（退避重试，耗尽降级）/ `degrade`（占位产出续链）/ `compensate`（回滚已完成副作用）/ `escalate`（升级人工）。失败终态落盘后，同 id 重入从断点续跑。
3. **预算是控制信号**——全局 token 池跨子任务共享扣减，波次之间判超支；超支不是监控告警，是「立即停下来」的命令。

---

## 三、跑起来（先体感）

```powershell
cd agent-app

# 动态模式：LLM 把目标拆成子任务单（演示规划/执行/验收三分工）
pnpm cli team "查订单A-1024的物流状态，如果还没签收就建一个催发工单" --trace

# 静态模式：跳过规划按任务单执行（拆单结果可预期，适合演示与回归）
pnpm cli team --plan samples/team-plan.json --trace --id demo-run-1

# 断点续跑：同 --id 重入，已完成子任务自动跳过
pnpm cli team --plan samples/team-plan.json --id demo-run-1
```

真实跑一次动态模式，轨迹长这样（节选）：

```text
🧩 编排目标：查订单A-1024的物流状态，如果还没签收就建一个催发工单
🧭 编排 team-x 状态：pending → planning     ← 拆：LLM 生成 3 个子任务
🧭 编排 team-x 状态：planning → executing   ← 派：入度 0 的任务并行开跑
✓ 子任务 1 完成（查订单，getOrderStatus 真调）
✗ 子任务 2 失败：未通过验收（产出与订单实际状态冲突）
⚠ 子任务 2 降级跳过（重试耗尽，占位产出续链）  ← 跑：验收拒绝→打回→降级
✓ 子任务 3 完成（基于前置产出正确判断无需建单）
🧭 编排 team-x 状态：reviewing → done       ← 终审通过
◆ 编排完成：3 个子任务，共消耗 1429 tokens
```

注意子任务 2 的故事线：**验收拒绝了它 → 打回重做 → 重做仍不达标 → 降级跳过 → 编排继续**。这条链就是「质量闭环 + 失败退路」的实战形态——降级不阻塞主线，占位产出让后续子任务知道上游缺失。

### 代码逐段走：拆什么 · 怎么装配 · 轨迹从哪来

上面三条命令背后的语义，用三段真实代码走一遍：第一段是「拆」的产物契约，摘自 `packages/engine/src/orchestrator/types.ts`；后两段分别来自 `examples/06-orchestration` 的编排器装配与引擎的事件→轨迹映射（离线桩驱动，`pnpm examples:check` 保证与仓库行为一致）。

**拆：子任务规格的显式验收字段**。

```ts
// agent-app/packages/engine/src/orchestrator/types.ts（节选）
/** 验收标准：critic 判定「完成」的显式依据（生产级分水岭：完成必须有定义） */
export type Acceptance =
  | { type: "llm-judge"; rubric: string } // LLM 对照 rubric 二元判定
  | { type: "contains"; anyOf: string[] } // 产出包含任一关键词（快速校验）
  | { type: "manual" } // 必须人工验收 → 走 escalate
  | { type: "none" }; // 无验收（纯执行，产出即结果）

/** 子任务规格：编排器调度的最小单元 */
export interface TaskSpec {
  /** 稳定 id（结果引用 / 重试定位 / 幂等键的组成部分） */
  readonly id: string;
  /** 人读标题（事件与日志用） */
  readonly title: string;
  /** 目标描述：拼进 worker 的 prompt */
  readonly goal: string;
  /** 依赖的子任务 id（DAG 并行派发按依赖解锁；循环依赖在执行前拒绝） */
  readonly dependsOn?: readonly string[];
  /** 验收标准（缺省 = none） */
  readonly acceptance?: Acceptance;
  // …（tools / maxTokens / maxDurationMs 三个覆盖字段从略）
}
```

这段在做什么：Planner 的产物就是 `TaskSpec[]`——§二 表格里「拆」的一行，落到代码是这九个字段。三个最值得盯的：`dependsOn` 声明依赖边，派发按它分波并行、循环依赖在执行前拒绝（动手任务 4 验证的就是这句注释）；`acceptance` 是三条生产级语义第一条「验收闭环」的类型形态——`contains` 快速校验、`llm-judge` 对照 rubric、`manual` 直接升级人工；`id` 必须稳定，因为断点续跑、重试定位、幂等键都引用它。

**装配并触发：桩三件套跑通编排协议**。

```ts
// agent-app/examples/06-orchestration/src/main.ts（节选）
const orch1 = new Orchestrator({
  stateStore: new MemoryStateStore(),
  planner: happyPlanner(),
  executor: happyExecutor(),
  critic: passCritic,
});
const r1 = await orch1.runAsync({
  id: "orch-demo-1",
  goal: "查订单并汇总",
  tasks: [
    { id: "t1", title: "查订单", goal: "查订单 A-1024 状态" },
    { id: "t2", title: "写摘要", goal: "汇总查询结果", dependsOn: ["t1"] },
  ],
});
console.log(`[编排 1] 两任务 DAG：状态 ${r1.state}，产出 ${r1.outputs.length} 条`);
```

这段在做什么：`Orchestrator` 构造参数就是「拆 · 派 · 跑」的三角色位（planner / executor / critic）加上状态存储——示例注入确定性桩（roles.ts 的剧本：t1 查订单 → t2 汇总，产出含「完成」，验收直接过），所以零模型、零网络也能跑通完整编排协议。`runAsync` 是引擎留给「不会 Effect 的调用方」的 Promise 出口（§四 第三问），传 `OrchestrationSpec`（静态任务单）触发一次编排。真实路径不手动 new：`assembleTeamOrchestrator()` 装配 LLM 默认三件套（LlmPlanner / LoopExecutor / AcceptanceCritic）+ 过幂等壳的工具表——`pnpm cli team "目标" --trace` 走的就是它；测试同样从这些角色位注入桩，离线验证编排语义。

**事件流：编排器只发事件，轨迹展示是映射**。

```ts
// agent-app/packages/engine/src/orchestrator/team-assembly.ts（节选）
/** 编排事件 → [图标, 文本]（cli/api 共用的展示映射；返回 null = 不展示） */
export function mapEventToTrace(event: OrchestrationEvent): [string, string] | null {
  switch (event.type) {
    case "state-changed":
      return ["🧭", `编排 ${event.id} 状态：${event.from} → ${event.to}`];
    case "task-completed":
      // 降级占位（「（降级跳过）」）不是真完成——用 ⚠ 而非 ✓，避免观察者误读
      if (event.text.includes("（降级跳过）")) {
        return ["⚠", `子任务 ${event.taskId} 降级跳过（重试耗尽或验收未过，占位产出续链）`];
      }
      return [
        "✓",
        `子任务 ${event.taskId} 完成（产出 ${event.text.length} 字，消耗 ${event.tokensUsed} tokens）`,
      ];
    case "task-failed":
      return ["✗", `子任务 ${event.taskId} 失败：${event.message}`];
    // …（escalated / interrupted / default 分支从略）
  }
}
```

这段在做什么：编排器内部只负责发结构化事件（`onEvent` 回调），`--trace` 看到的 🧭/✓/✗/⚠ 轨迹全部由这个纯函数映射——CLI 与 API 的 `/api/team/stream` 消费同一份映射（这也是「装配逻辑放 engine 而不是各端」防漂移的同一设计）。最值得学的是 `task-completed` 里的分支：降级占位产出也走 `task-completed` 事件，展示层刻意把它标成 ⚠ 而非 ✓——「降级跳过」不是真完成，观察者不该被图标骗了。§三 轨迹图里子任务 2 的 ⚠ 行，来源就是这里。

---

## 四、设计取舍（三问三答）

| 追问                                   | 回答                                                                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 拆出的子任务怎么验收？                 | 显式标准进 `TaskSpec.acceptance`，Critic 对照判定——不靠感觉。「被拒绝的调用不污染缓存」：验收壳在外、幂等壳在内的叠加顺序保证这点                                                |
| 失败了为什么还能续跑？                 | 失败终态（`failed`/`escalated`）落盘后，`failed → executing` 是合法迁移——同 id 重入自动跳过已完成子任务；动态规划的任务单也进快照，重入不重新拆                                  |
| 为什么编排器用 Effect 而其他模块没有？ | 编排是多任务并发/取消/超时的主场——结构化并发的收益在这里兑现；其他模块是顺序流水线，async/await 已是完整体。且编排器留了 Promise 出口 `runAsync()`，**不会 Effect 也能完整使用** |

---

## 五、动手任务（做完才算通关）

1. 跑通静态模式：`pnpm cli team --plan samples/team-plan.json --trace`，对照轨迹说出「拆/派/跑」各发生在哪一行
2. 打开 `samples/team-plan.json`：给任务 2 换一种验收（`llm-judge` + rubric），重跑观察打回行为
3. 用 `--id demo-run-1` 跑两次，第二次观察「已完成子任务自动跳过」（断点续跑）
4. 造一个循环依赖（任务 A 依赖 B、B 依赖 A）的任务单，确认编排器在派发前拒绝

---

## 自测题（先凭记忆答，再展开）

1. 多 Agent 相对单 Agent 只多出哪三个新问题？编排器里 Planner / Executor / Critic 分别对应哪个？
2. 条件性子任务（「若 X 则建单，否则说明原因」）的验收标准该怎么写？为什么 `contains: ["TK-"]` 会出事？
3. 失败终态落盘解决什么问题？没有它，失败后同 id 重入会发生什么？

<details><summary>答案</summary>

1. 分工（谁干什么）、共享状态（互相知道什么）、质量闭环（谁验收）；Planner 对应分工、StateStore 快照对应共享状态、Critic 对照 Acceptance 对应质量闭环（Executor 是干活的工人）。
2. `anyOf` 必须覆盖**全部分支**：`["TK-", "无需", "不需要"]`——只写 `["TK-"]` 时「无需建单」的正确产出会被验收误杀，打回重做也产不出工单号，最后降级。示例任务单的初版就踩了这个坑。
3. 失败后把 `failed`/`escalated` 终态写进 StateStore——迁移表里 `failed → executing` 合法，重入即从断点续跑。没有终态落盘，快照停在 `executing`，重入触发「executing → executing」非法迁移直接抛错（真实踩过的坑）。

</details>

---

## 延伸

- 上一课：[05 · 工具层加固与幂等](/learn/03-capabilities/tools-hardening) —— 幂等壳与审批壳（编排器的两个「壳」）
- 下一课：[06 · 护栏与安全红队](/learn/05-quality/guardrails-safety) —— 编排过的系统更需要防线
- [参考库 · 编排器](/reference/10-orchestrator) —— 代码走读 / 拆分方法论 / 面试级取舍
- `packages/engine/src/orchestrator/README.md` —— 模块地图与关键语义速查
- [09 · 产品线组装](/learn/07-applications/service-product-line) —— Supervisor 星型：编排器的第一形态前身
- `agent-app/BACKLOG.md` ② —— A2A 对等 / 编排 SSE 在线观测等后续批次

---

::: tip 旧链接兼容
本课原地址为 `/guide/09b-multi-agent`，已迁移至 `learn/04-orchestration`（课程 ID `multi-agent-orchestration`，原 09b 插入式编号停用）。旧链接请更新；本页由 [阶段 04 索引](/learn/04-orchestration/) 收录。
:::

::: info 章节结构说明
本课由 guide 整体迁移而来。对照课程元数据 Schema 的十章结构：核心原理（§一/二）、最小可执行实现（§三）、真实工程实现位置（§四）、自测及下一课（自测题/延伸）已达标；「学完会什么」由开篇引语承担；「先决知识与运行环境」见[运行环境](/start/environment)；「测试与验收」见 frontmatter `tests` 与[阶段 04 验收清单](/learn/04-orchestration/)；「常见误区与排错」内容含于自测题答案。属**整体迁移章例外**，缺失小节随批次 B 统一补齐。
:::
