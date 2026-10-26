# Personal Agent 场景驱动可靠性设计与验收矩阵（V1）

> **文档状态：待实施架构规范** · 2026-10-26。配合 [队列设计](./03-QUEUE-SCHEDULING.md)、[目标架构](./01-ARCHITECTURE.md)、[路线图](./02-ROADMAP.md) 使用。
>
> 本文将 Muse / Dots 风格的 Personal Agent 当作**持续运行、允许用户创建和委派 Agent、支持异步外部操作**的产品来设计。只参考公开的产品目标，不声称掌握其内部实现。所有“必须”是未来代码验收要求，不代表当前仓库已实现。

## A. 先固定系统边界与不可违反的不变量

### A1. 七类实体必须分开

| 实体 | 持续时间与职责 | 唯一身份 |
| --- | --- | --- |
| Agent / AgentVersion | 用户定义的能力、权限、工作流；版本不可变 | agentId / agentVersionId |
| Goal / TriggerOccurrence | 用户长期目标、某次触发事实，需独立记录跳过、合并和失败 | goalId / occurrenceId |
| Task | 一条业务意图；可以挂多次 Run，支持父子任务依赖 | taskId |
| Run / RunAttempt | 本次 Agent 执行与恢复；重新尝试要记录 attempt/epoch | runId / attemptId / leaseEpoch |
| Conversation / InboxMessage | 有顺序的用户输入；不等同于任务、也不依赖前端在线 | conversationId / inboxId / seq |
| ToolOperation / Approval | 外部动作意图、参数摘要、执行状态、审批授权与真实回执 | operationId / approvalId |
| NotificationDelivery | 发给用户的通知事实和各次发送尝试 | deliveryId / deliveryAttemptId |

**不可违反的 12 条不变量：**

- I01：所有影响执行的入口（Web、API、消息渠道、触发器、Agent 委派）先鉴权、生成稳定去重键，并在 PostgreSQL 事务里记录业务事实及 Outbox。
- I02：Redis/BullMQ 可丢连接、重复派发或延迟；不作为唯一业务真相。不能依赖 BullMQ jobId 实现外部动作 exactly-once。
- I03：同一 conversation 同时最多一个**持有状态修改权的 Run**。等待用户审批时，可以释放计算/执行租约，但未完成会话的**恢复权/会话预约权**仍存在；后续用户输入不得偷偷启动平行修改会话的 Run。
- I04：一个 Run 同时只能有一个合法执行持有者（lease + 单调递增 fencing epoch）；过期持有者的数据库写回必须 CAS 拒绝。
- I05：共享资源（browser profile、相同文件工作区等）需独立资源租约。会话锁不能代替浏览器独占锁，浏览器独占锁也不能代替会话锁。
- I06：外部副作用先记录 ToolOperation 和权限判定，再执行；超时后结果可能 unknown，不能“超时 = 未执行”直接重放。对不能提供幂等/查询回执的服务，只能人工核对或保守停止。
- I07：Approve = 批准**指定用户、AgentVersion、tool、目标、参数 hash、操作、有效期的一次动作**；参数变化、版本变化、超时或撤权必须失效。
- I08：取消是持久的 **cancel intent**，不等于删除队列 job；取消和成功竞争时遵守 CAS 终态和实际外部结果，不能伪造“撤回已经发生的副作用”。
- I09：通知的发送失败不能触发业务任务再执行；通知状态独立且可能 unknown。
- I10：InboxMessage 的文本、附件与顺序绝不因 wake 信号合并而被覆盖；同一用户会话按 seq 消费。
- I11：用户/Agent 的工具授权与知识范围，随子任务委派只能**缩小或保持**，不能在子 Agent 中自动升级权限。
- I12：SSE 仅负责观察；任务状态、审批和控制都通过可审计持久化 API；浏览器断连不主动取消后台 Run。

### A2. 三层所有权/锁模型

| 层 | 用途 | 生存期 | 释放原则 |
| --- | --- | --- | --- |
| conversation reservation | 一条尚未完结的 Run 享有会话续写权 | 可跨 waiting_approval / paused 状态 | Run 终结或明确安全移交后释放；保留版本 |
| run execution lease | Worker 暂时拥有执行计算权 | 短 TTL，定时续期，epoch 单调递增 | yield / 崩溃 / 任务终结时释放或过期 |
| resource lease | Browser Profile / 写文件等排他资源 | 单次资源操作的窗口 | 等待人工审批应尽量释放；人工接管另需状态交接 |

如果会话被审批挂起，后续新消息留在 Inbox；调度器可以继续处理其他会话和 Agent，但**不能夺走被挂起 Run 的会话恢复权**。用户主动“终止旧 Run 并开始新任务”须先检查工具副作用，进行显式替换。

## B. 六条逻辑队列及派发规则

| 逻辑 Lane | 业务主存储 | 派发机制 | 不允许 |
| --- | --- | --- | --- |
| Task / Run | tasks/runs/run_attempts/outbox | BullMQ agent-runs + Scheduler | 同会话并行 Run；无审计重试 |
| Wake / Inbox | conversation_inbox + conversation_state | DB Inbox + 合并 wake signal + Scheduler | 合并/覆盖用户正文；直接向忙碌 Run 发第二个 prompt |
| Approval | approvals + tool_operations | DB 待办 + 审批通知 + Resume signal | Worker 长时间挂起；旧批准重用 |
| Tool / Resource | tool_operations + resource_leases | ToolGateway + 资源等待/独立 worker | 独占 Profile 双控制；盲重放写操作 |
| Trigger | trigger_occurrences + goals | 按 timezone 计算 nextRunAt + Outbox | 漏记到期、重复执行、无重叠策略 |
| Notification | notification_deliveries | 独立 BullMQ notifications / 发送回执 | 消息失败重新运行原业务 |

不要求六条 BullMQ 物理 Queue。首版可采用 agent-runs、notifications（后续加 browser-operations）与一个 PostgreSQL Outbox Relay。**BullMQ Pro Groups 不是免费 BullMQ 的默认基础能力**，跨用户公平性由 Scheduler/DB 显式实现；不要把 BullMQ 的 dedup(keepLastIfActive) 用在用户消息正文上，因为它只保留最新载荷。

### B1. Scheduler 调度顺序

1. **硬控制先处理**：取消、撤权、期限失效、安全暂停；它们是状态变更，不与普通任务一样等待低优先 FIFO。
2. **入口持久化**：消息/Task/TriggerOccurrence 和 Outbox 事务提交，再发 dispatch hint。
3. **可执行性**：检查主体权限、AgentVersion 状态、依赖、最大尝试次数、预算、deadline、Goal pause/overlap policy、全局/owner 限额。
4. **会话与资源**：首先获取 conversation reservation 或确认自己正是旧 Run 的恢复者，接着 claim execution lease（CAS+epoch）；实际使用某资源前获取 resource lease。
5. **短步运行**：模型调用/工具边界写检查点、事件、费用；Runtime 不支持安全 steering 时绝不注入并发 prompt。
6. **yield 和后续唤醒**：等待审批/外部回执时落 waiting 状态、释放执行槽；唤醒信号仅让 Scheduler 重新判断，不直接执行副作用。
7. **终态与后处理**：业务 RunOutcome、Verification、通知送达、触发器 nextRunAt 分别处理和记录。

在资源受限的个人 VPS，初始建议 owner 并发 = 2、同 conversation = 1、同 browserProfile writer = 1；这些是配置初值，部署后根据 RAM/限流测量调整，不能当固定性能保证。

## C. 端到端状态图：忙碌用户消息、审批与取消

~~~mermaid
flowchart TD
  In["用户消息 / 新任务 / 定时事件"] --> Tx["PG 事务：Inbox/Task + Outbox"]
  Tx --> Q["Scheduler 获取待调度信号"]
  Q --> Check{"会话是否被未完结 Run 预约"}
  Check -->|否| Claim["创建 Run + claim lease"]
  Check -->|是| Mode{"现 Run 状态"}
  Mode -->|running| Pending["按 seq 入 Inbox pending"]
  Mode -->|waiting_approval| Hold["待审批期间保留消息和恢复权"]
  Mode -->|paused/waiting_user| Hold
  Pending --> Boundary{"到安全边界且 Runtime 支持 ACK-steering"}
  Boundary -->|是| Steer["有凭据地注入并 ack applied"]
  Boundary -->|否| Later["当前 Run 结束或显式 yield 后 continuation"]
  Hold --> Decision{"用户选择"}
  Decision -->|补充信息| Hold
  Decision -->|批准原动作| Resume["重校验授权和参数，resume 原 Run"]
  Decision -->|取消/替换| Cancel["持久 cancel intent + 核对外部操作"]
  Cancel --> Later
  Resume --> Claim
  Later --> Claim
  Steer --> Process["继续执行"]
  Claim --> Process
  Process --> Tool["受控工具 / Verification"]
  Tool --> Next{"是否仍有待处理消息"}
  Next -->|是| Q
  Next -->|否| Done["终态 / 通知 / 释放所有权"]
~~~

注意：Resume 原 Run 必须复用其 agentVersion、checkpoint 和审批上下文，不是重新创建无关联的新 Run；如果引擎缺少安全的步骤级持久 checkpoint，恢复不能伪装为从中断点无副作用重放，应标记 requires_review 或使用有证据可恢复的 continuation。

## D. 全场景决策矩阵（54 个场景）

场景中的“验收”既包括业务断言，也包括**故障时必须拒绝不安全操作**。阶段记号 P0–P7 对应 Roadmap。

### D1. 创建、对话和唤醒（SC01–SC10）

| ID / 阶段 | 场景 | 稳妥行为与失败兜底 | 关键验收 |
| --- | --- | --- | --- |
| SC01 P2 | 用户发一条普通消息且会话空闲 | Inbox 事务入库、创建/绑定一个 Task/Run、处理后标记 applied；超时可查询状态 | 消息可重放、单 Run |
| SC02 P2 | Agent 正在回复时用户再发消息 | 记录 pending；仅安全边界 steering 或结束后 continuation；保留 seq | 无双 Run、原消息不丢 |
| SC03 P2 | 1 秒连续 20 条消息 | 去重不同 sourceId；Wake signal 可合并但消息逐条保留，按 seq 消费，可批量传模型 | 20 条均可查，顺序正确 |
| SC04 P2 | 同一请求因网络重试重复提交 | clientRequestId/sourceMessageId 唯一约束，返同一处理 ID；无第二次工具动作 | 幂等请求与真实重复消息区分 |
| SC05 P2 | 用户修改上一条消息/撤回 | 作为新的 edit/retract command，原始消息留审计；仅对未执行动作按语义修订 | 已发生操作不会假装撤回 |
| SC06 P2 | 会话正等待审批，用户追加要求 | pending 存库；若新要求改变待批参数，原审批失效并重新评估，不能直接复用 | 新旧参数 hash 不串用 |
| SC07 P2 | 用户说“取消当前任务” | 先转换经鉴权的 cancel intent 控制命令，而不是仅写普通聊天 prompt | 无二次 Run，终态正确 |
| SC08 P2 | 用户要求切换 Agent | 明确新会话或授权移交，旧 Run 状态清晰；不可隐式共享私有记忆与工具凭据 | 原 Agent 状态不串 |
| SC09 P2 | 同用户两个 Agent 收到任务 | 无共享资源冲突且 quota 许可时并发；否则可视化排队 | 不强制用户全局串行 |
| SC10 P2 | 消息抵达时 Worker/Redis 故障 | Postgres 已提交则 Outbox 可补发，Pending 可见；数据库提交失败直接向用户报错 | 无成功回执但消息未落库 |

### D2. 调度、并发和队列积压（SC11–SC19）

| ID / 阶段 | 场景 | 稳妥行为与失败兜底 | 关键验收 |
| --- | --- | --- | --- |
| SC11 P2 | 同 Agent 不同 conversation 并行 | 每会话独立预约；受 owner / agent 并发配额约束 | 不串上下文 |
| SC12 P2 | 用户同时创建大量任务 | 入站配额 + pending backlog，负载保护，不能无限创建 Worker | 清晰排队/限额响应 |
| SC13 P2 | 高优任务到来 | 可优先待执行队列，但不抢占不可中断操作；配额与 aging 防饿死 | 高优先不致低优永远不跑 |
| SC14 P2 | 队列顺序与重试冲突 | 会话 seq 有序；失败消息保留可操作状态，后续消息需明确 skip/review 策略 | 无静默越序 |
| SC15 P2 | 长任务占用多个模型请求 | 单 Run checkpoint 分段续跑，限时限 token，yield 还给 Scheduler | 超预算可确定失败/待用户 |
| SC16 P2 | CPU 密集任务阻塞 EventLoop | 独立 worker thread/进程，Bull lock lost 触发排查和恢复 | 不因阻塞反复 stalled 执行 |
| SC17 P2 | 同一任务 BullMQ 重复交付 | DB claim/CAS + epoch/attempt 只允许一个有效 owner | 重复 job 不产生重复副作用 |
| SC18 P2 | Redis 的 job 完成而 PG 更新失败 | 由 Reconciler 扫描 PG 未闭合状态/outbox，补调度；不能仅依赖 job completed | 最终可恢复或标人工核对 |
| SC19 P7 | 多用户混合任务、强占负载 | 按 owner 配额及加权轮转公平；不要求 BullMQ Pro Groups | 无租户饿死和权限穿透 |

### D3. 执行、审批和工具副作用（SC20–SC31）

| ID / 阶段 | 场景 | 稳妥行为与失败兜底 | 关键验收 |
| --- | --- | --- | --- |
| SC20 P2 | 普通只读工具暂时超时 | 限次数/退避/抖动重试，可缓存有时效结果 | 实际请求次数与费用可追溯 |
| SC21 P2 | 发邮件已提交但响应超时 | operation=unknown；按邮件提供方回执/唯一 ID 对账；无查询能力则待人工 | 不盲发第二封 |
| SC22 P4 | 下单、付款、删文件等写操作 | ToolGateway 必须检查权限/审批/风险；发前写操作记录和参数摘要 | 未批准无外部副作用 |
| SC23 P2 | 等待用户审批数小时 | Run waiting_approval 持久化、释放执行槽，继续保留会话恢复权 | Worker 容量不会耗尽 |
| SC24 P2 | 用户重复点击批准 | 审批记录原子 CAS，只接受一次；再次请求返回已裁决 | 外部动作至多一次有效授权 |
| SC25 P2 | 审批到期/用户撤权 | fail-closed；挂起或拒绝动作，重新授权前不放行 | 旧批准不可复用 |
| SC26 P2 | 批准后工具参数改变 | 参数 hash 不匹配拒绝并生成新审批 | 不扩大已批操作 |
| SC27 P4 | 工具返回恶意“系统提示” | 外部内容视为不可信数据，策略/授权不能由工具输出修改 | Prompt injection 不越权 |
| SC28 P4 | MCP 工具同名/动态更新 schema | 冲突拒绝、工具 capability 固定版本或快照；运行中不静默换工具 | Tool call 与授予权限匹配 |
| SC29 P4 | 两 Agent 抢同一浏览器 profile | resource lease 单 owner；第二个排队或换隔离 profile | 无双 writer |
| SC30 P4 | 用户在 Agent 浏览器操作中接管 | 安全中断 + 人工控制租约，交回后重新观察页面 | 无双写；旧 DOM 不复用 |
| SC31 P4 | Browser/Tool Worker 崩溃 | 操作 unknown、资源租约过期防 ABA、确认外部状态后续跑 | 不因重投重复表单提交 |

### D4. 取消、暂停、恢复与基础设施故障（SC32–SC40）

| ID / 阶段 | 场景 | 稳妥行为与失败兜底 | 关键验收 |
| --- | --- | --- | --- |
| SC32 P2 | 用户暂停运行 | durable pause intent，安全点停止/释放执行 lease，会话预约按策略保留 | 任务暂停后不继续自动执行 |
| SC33 P2 | 用户取消时恰好完成 | PG CAS 只有一个终态，记录取消请求及外部动作实际结果 | 不伪造取消已产生的副作用 |
| SC34 P2 | 重复取消 / 取消父任务 | 幂等 cancel command，子任务终止信号传播；外部写操作需先核对 | 无悬挂子 Run |
| SC35 P2 | 服务器重启时模型调用进行中 | 模型请求视为可中断；依 checkpoint 恢复新 attempt，不当作工具已完成 | 进程重启可人工或自动安全续跑 |
| SC36 P2 | 服务器重启时外部写入进行中 | state=dispatching/unknown，恢复流程先查回执，不存在证据时阻止自动重发 | 不重复付款、邮件等 |
| SC37 P2 | Worker lease 超时，旧 Worker 又回来 | epoch tombstone、CAS 拒绝旧者更新，并尽可能取消旧执行 | 旧者无权写新结果 |
| SC38 P2 | PostgreSQL 短暂不可用 | 停止新业务状态分配和副作用执行；恢复后对 Outbox/Run 做 reconciliation | DB 故障时不会“盲执行” |
| SC39 P2 | Redis 完全不可用 | API 只承诺 PG 落盘的 pending，投递待补发；必要时限流/熔断 | Redis 恢复后不会丢任务 |
| SC40 P2 | Outbox Relay 中途 crash | 未确认投递可再次发送稳定 jobId，消费者以 DB 去重 | 最终派发、无双执行 |

### D5. Goal、触发器、主动通知（SC41–SC47）

| ID / 阶段 | 场景 | 稳妥行为与失败兜底 | 关键验收 |
| --- | --- | --- | --- |
| SC41 P6 | 每日 9 点执行新闻研究 | timezone + nextRunAt + occurrenceId，落触发事实、只建一次任务 | 重启/多副本不重复派发 |
| SC42 P6 | 旧一轮尚未结束又到时间 | 默认由 Goal 配置 QUEUE/SKIP/COALESCE/REPLACE，按情况保留/跳过/合并/安全替换 | 各种 overlap 有可测语义 |
| SC43 P6 | 暂停期间定时器到期 | 记录 skipped/suppressed 或根据策略留存；不得暗中唤醒执行 | 暂停行为可追溯 |
| SC44 P6 | 停机期间错过多个 cron | misfirePolicy：SKIP/LATEST/CATCH_UP_LIMITED，限补跑次数与过期时间 | 不发生积压风暴 |
| SC45 P6 | 夏令时和时区变更 | 存 IANA timezone，定义不存在/重复当地时刻的处理规则 | DST 用例明确 |
| SC46 P6 | 同一 Webhook 重投数次 | signed webhook/鉴权 + eventId/occurrenceKey 去重 | 只生成一次业务触发 |
| SC47 P6 | 主动通知超时 / 渠道窗口过期 | NotificationDelivery 标 delivered/failed/unknown；通知重试独立、遵循渠道限制 | 业务 Run 状态不变 |

### D6. Agent Factory、知识、协作和成本（SC48–SC54）

| ID / 阶段 | 场景 | 稳妥行为与失败兜底 | 关键验收 |
| --- | --- | --- | --- |
| SC48 P3 | 同用户同时创建两个专业 Agent | Factory job 独立版本、模板/工具绑定明确，互不覆盖 | 两个 AgentSpec 都能回溯 |
| SC49 P3 | 创建 Agent 中途离开网页 | Draft + 测试进度持久化，恢复查看，不依赖浏览器连接 | 页面关闭后状态可查询 |
| SC50 P3 | Agent 发布后立即修改配置 | 新 AgentVersion；现有 Run 固定旧版本与权限快照，撤权须实时强制生效 | 不能中途偷换工具 |
| SC51 P5 | Agent 共享/私有记忆冲突 | user/agent/goal scope+ACL，读写授权显式控制，冲突可纠错 | A 不能读 B 的私有记忆 |
| SC52 P7 | 父 Agent 分派子任务给多个子 Agent | DAG 子 Run、权限下沉、Budget 总账、父 wait 不占计算槽 | 无循环委派和超额授权 |
| SC53 P7 | 某子 Agent 失败但另几个成功 | 原有 Effect 重试/降级/补偿/人工升级策略；保留已证实成果 | 部分成功可解释、不重复成功任务 |
| SC54 P2/P7 | 模型额度耗尽/预算触顶 | Provider 限流/退避 + owner/goal/run 预算，进入 waiting_budget 或 failed，不无限调用 | 费用可查、越限不继续 |

### D7. 额外必须扩展的真实使用场景

以下五项不占上述编号但**一样作为专项测试**：

- **文件/附件**：上传重复、扫描失败、超限、进度丢失、RAG 处理异步；附件存储和 Inbox 引用必须原子可追溯。
- **凭据/授权变化**：任务排队期间令牌被撤销、外部 OAuth 过期、MCP 服务器被替换；执行前与每次工具使用时重新做权限检查。
- **Agent 下线/删除**：已有 Run 改为停止/等待人工，不允许物理删除使审计不可追溯；保留软删和版本快照。
- **隐私/删除**：删除历史/记忆的请求必须阻止后续检索、清理索引与文件引用；法律要求的审计保留单独声明。
- **饥饿与拥塞**：长时任务和无限 wake 不能占尽配额；结合 backlog depth、oldest pending age、lease expiry、retry count 告警和背压。

## E. 数据库模型、状态和唯一约束建议

P1/P2 所需重点表：

- conversations：ownerId、activeReservationRunId、version、state；reservation 与 execution lease 分开，activeReservationRunId 可以在 wait 时持有。
- conversation_inbox：ownerId、conversationId、seq、sourceMessageId、payloadRef、kind、state、claimedByRunId、appliedAt；唯一 (ownerId, conversationId, seq) 与按来源的去重键。
- tasks / runs / run_attempts：ownerId、agentVersionId、taskId、runId、state、attempt、leaseEpoch、checkpointRef、deadline、priority、budget；取消标志独立持久字段。
- execution_leases：scopeKey、ownerRunId、epoch、expiresAt，**epoch 保留 tombstone**，不能因 release 删除后从 0 重新计数。
- resource_leases：resourceKey、holderKind、holderId、epoch、expiresAt、takeoverState。
- tool_operations：operationId、runId、argsHash、approvalId、providerIdempotencyKey、state、receiptRef、lastReconciledAt。
- approvals：operationId、agentVersionId、toolName、argumentHash、expiresAt、decision、decisionVersion、actorId。
- outbox_events：eventId、aggregateId、eventType、payloadRef、availableAt、dispatchAttempt、deliveredAt。
- goal / trigger_occurrences：timezone、overlapPolicy、misfirePolicy、occurrenceKey、sourceEventId、scheduledFor、state。
- notification_deliveries：channel、recipientRef、idempotencyKey、state、lastAttemptAt。
- run_events：runId、seq、eventId、eventType、redactedPayload，支持 SSE 依据 runId + seq 回放与 gap 检测。

**原子性要求**：\`POST message\` 仅在 Inbox + Outbox 提交成功后返回 accepted；创建 Task 与初始 Run、出站信号在一个 PG transaction。Worker 获取租约与 Run state 更新必须互斥（CAS/唯一活跃槽），ToolOperation 进入“可能发送”状态必须在实际请求前 durable commit。数据库不可用时绝不进入外部副作用窗口。

## F. 实现优先级与测试门禁

### P0：契约和故障地图

- 编写全部场景的 Vitest fixtures / 故障剧本骨架，明确 Pending/Unknown 对应的不可重放行为。
- 冻结 Task/Run/Inbox/Approval/Operation/Notification/Trigger 的状态机与错误枚举，核对现有 Effect Orchestrator 的状态不是 Run 状态。
- 把旧即时 SSE“断线 Abort”和新后台任务“断线不断执行”区分为明确的 API 契约。

### P1：最小数据与授权

- 创建用户、会话、Task、Run、Inbox、Outbox、Lease、Approval、ToolOperation 模型，以及唯一约束、迁移、scope ACL 测试。
- 单机多进程跑 DB Claim/Lease 并发测试，证明旧者写入失败。

### P2：可靠任务、唤醒与审批（硬性出口）

- 实现 Task + Wake + Approval 三条逻辑 lane，BullMQ Relay，Scheduler，必要的 quotas/lease/fencing/reconciliation。
- CI 必跑 SC01–SC04、SC06–SC07、SC09–SC10、SC11–SC18、SC20–SC26（使用模拟 provider）、SC32–SC40、SC54 的确定性与关键集成测试。
- 接入队列可观测 UI：待处理长度、最长等待时间、运行数、deferred、waiting_approval、unknown、副作用对账数、dead-letter 重试入口；仅显示用户有权查看的记录。
- 禁止无证据“自动恢复成功”与对付费、发信、外部写入的盲目重试。

### P3–P7：逐步补齐

- P3 SC48–SC50 创建/发布/版本与 Factory 作业并发。
- P4 SC22、SC27–SC31 的实际浏览器/MCP 与资源竞争测试。
- P5 SC51 和记忆、文件删除与 provenance。
- P6 SC41–SC47 定时触发、DST、错过运行与通知。
- P7 SC19、SC52、SC53 和跨 Agent 性能/压测。

### 核验策略

1. 单元：纯状态机、排序、去重、权限与策略，使用虚拟时钟。
2. 集成：真实 PostgreSQL + Redis + 2 Worker，故意 kill worker / relay / DB 连接 / Redis，确认租约 fencing 和补偿。
3. E2E：Web 刷新/关闭、SSE event replay、approval、wake pending → applied、dashboard backlog。
4. 故障注入：一旦结果 unknown，不允许基于 Redis 重试直接重新发送外部请求。
5. 验证不是靠“通过百分比”替代：每个 SC 必须有 test id、PR、执行环境、结果、失败证据；第三方账号未联调标“未验证”。

## G. 需要被显式承认的限制

- 不保证通用的 exactly-once 外部动作；只能做到内部幂等、受控重试、可用时对账和无法确认时安全停止。
- Runtime 原始 \`runToolLoop\` 不一定支持真正的 mid-step steering 和任意工具中断精确恢复；首版优先 safe-boundary continuation，不得为了“实时打断”破坏状态。
- 用户对任务的“取消”不能撤销外部已完成的付款/邮件/站点变更；必须在 UI 显示事实。
- 没有合法第三方授权的主动消息/网站操作不能当作已接通功能。
- 最初使用单用户自托管环境也要在数据模型中声明 ownerId，避免未来升级时数据库无法隔离。
