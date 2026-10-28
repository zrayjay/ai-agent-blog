export interface Lesson {
  no: string
  title: string
  href: string
  summary: string
  note?: string
}

export interface LearningStage {
  no: string
  title: string
  description: string
  outcome: string
  lessons: Lesson[]
}

// 首页路线与统计共用课程数据；保留正文编号，09b 是独立专题。
export const learningStages: LearningStage[] = [
  {
    no: '01',
    title: '搭起 Agent 内核',
    description: '先理解模型如何调用工具，再让它记住对话、查到知识。',
    outcome: '阶段产出：能调用工具、带记忆与引用的问答链路。',
    lessons: [
      {
        no: '01',
        title: 'LLM API 与结构化输出',
        href: '/learn/01-foundations/llm-structured-output',
        summary: '原生调用、流式响应与工具调用',
        note: '正文整理中 · 附原始教程'
      },
      {
        no: '02',
        title: '手写工具循环',
        href: '/learn/02-runtime/agent-loop',
        summary: '模型决策 → 执行工具 → 结果回填'
      },
      {
        no: '03',
        title: '记忆与上下文压缩',
        href: '/learn/03-capabilities/memory-context',
        summary: '会话、偏好、情景记忆与滚动摘要'
      },
      { no: '04', title: 'RAG 知识库与检索', href: '/learn/03-capabilities/rag-knowledge-base', summary: '切块、向量化、检索与引用溯源' }
    ]
  },
  {
    no: '02',
    title: '让执行可控、质量可测',
    description: '为工具加上边界，接入外部能力，用评估验证每一次改动。',
    outcome: '阶段产出：有审批、幂等、安全防线和评估基线的 Agent。',
    lessons: [
      {
        no: '05',
        title: '工具层加固与幂等',
        href: '/learn/03-capabilities/tools-hardening',
        summary: '工具注册、高危审批与重复执行防护'
      },
      {
        no: '06',
        title: '护栏与安全红队',
        href: '/learn/05-quality/guardrails-safety',
        summary: '脱敏、防注入、审计与攻击实验'
      },
      { no: '07', title: 'MCP 标准插口', href: '/learn/03-capabilities/mcp-integration', summary: 'Server、Client 与外部工具适配' },
      { no: '08', title: '评估框架', href: '/learn/05-quality/evals-quality-gate', summary: '分层判分、基线对比与质量门禁' }
    ]
  },
  {
    no: '03',
    title: '组装成可交互的产品',
    description: '把单个循环接成业务流程，再通过 Web 展示执行过程。',
    outcome: '阶段产出：客服分诊、多 Agent 协作与 SSE 对话界面。',
    lessons: [
      {
        no: '09',
        title: '产品线组装：客服系统',
        href: '/learn/07-applications/service-product-line',
        summary: '硬规则路由、业务 Worker 与转人工'
      },
      {
        no: '04',
        title: '多 Agent 编排',
        href: '/learn/04-orchestration/multi-agent-orchestration',
        summary: '任务拆分、DAG 调度与逐任务验收'
      },
      {
        no: '10',
        title: 'Web 前端与 SSE 流式',
        href: '/learn/06-fullstack/web-sse-frontend',
        summary: 'Next.js 页面、事件契约与对话状态'
      }
    ]
  },
  {
    no: '04',
    title: '走向交付，讲清取舍',
    description: '辨认演示与生产的距离，把实现、验证和设计决策连起来。',
    outcome: '阶段产出：部署与改进清单，以及有项目证据的面试表达。',
    lessons: [
      {
        no: '11',
        title: '生产化与成熟度',
        href: '/learn/05-quality/production-maturity',
        summary: '持久化、容器部署与能力边界'
      },
      {
        no: '12',
        title: '学完之后：演进方向',
        href: '/guide/12-roadmap',
        summary: '按需求选择下一步，理解框架与平台取舍'
      },
      { no: '13', title: '面试实战', href: '/guide/13-interview', summary: '知识自检、追问链与场景设计题' }
    ]
  }
]

export const lessonCount = learningStages.reduce((total, stage) => total + stage.lessons.length, 0)

export const products = [
  {
    no: '01',
    title: '知识库问答',
    label: '检索与引用',
    description: '把企业文档变成可检索知识，回答带出处，查不到时知道如何收尾。',
    prerequisite: '建议先学 02 → 04 → 08',
    href: '/cases/knowledge-base'
  },
  {
    no: '02',
    title: '智能客服',
    label: '路由与业务操作',
    description: '从问题分诊到工具执行，串起多轮对话、人工审批与转人工流程。',
    prerequisite: '建议先学 05 → 06 → 09',
    href: '/cases/customer-service'
  },
  {
    no: '03',
    title: '文档智能',
    label: '文档处理选修',
    description: '从 PDF 文本与 OCR 分诊，到字段抽取、结构化校验和文档问答。',
    prerequisite: '结合结构化输出与 RAG · 含 Python 示例',
    href: '/cases/document-intelligence'
  }
]
