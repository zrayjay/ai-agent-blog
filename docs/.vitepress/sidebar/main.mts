// 主线侧边栏：开始 / 七阶段 / 主线正文 / 参考库 / 案例 / 进阶
import type { SidebarItem } from 'vitepress'

export const mainSidebar: SidebarItem[] = [
  {
      text: '开始',
      collapsed: false,
      items: [
        { text: '从这里开始', link: '/start/' },
        { text: '学习路线图 · 唯一正式路线', link: '/start/roadmap' },
        { text: '运行环境 · 版本与排错', link: '/start/environment' },
        { text: '旧版前言（历史）', link: '/preface' },
        { text: '学习指南 · 旧版双轨路径（历史）', link: '/guide/' },
        { text: '旧版路线图 · 23 周（历史）', link: '/roadmap' }
      ]
  },
  {
      text: '🚀 主线 · 七阶段',
      collapsed: false,
      items: [
        { text: '主线课程总览', link: '/learn/' },
        { text: '阶段 01 · 基础与模型交互', link: '/learn/01-foundations/' },
        { text: '阶段 02 · Agent Runtime', link: '/learn/02-runtime/' },
        { text: '阶段 03 · Agent 能力层', link: '/learn/03-capabilities/' },
        { text: '阶段 04 · 编排', link: '/learn/04-orchestration/' },
        { text: '阶段 05 · 质量与可靠', link: '/learn/05-quality/' },
        { text: '阶段 06 · 全栈交付', link: '/learn/06-fullstack/' },
        { text: '阶段 07 · 产品案例', link: '/learn/07-applications/' }
      ]
  },
  {
      text: '🚀 主线正文 · 13 站（原 guide，已落位 learn/）',
      collapsed: false,
      items: [
        { text: '总览（首页）', link: '/' },
        { text: '01 · LLM API 与结构化输出', link: '/learn/01-foundations/llm-structured-output' },
        { text: '02 · 手写工具循环（Agent 核心）', link: '/learn/02-runtime/agent-loop' },
        { text: '03 · 记忆与上下文压缩', link: '/learn/03-capabilities/memory-context' },
        { text: '04 · RAG 知识库与检索', link: '/learn/03-capabilities/rag-knowledge-base' },
        { text: '05 · 工具层加固与幂等', link: '/learn/03-capabilities/tools-hardening' },
        { text: '06 · 护栏与安全红队', link: '/learn/05-quality/guardrails-safety' },
        { text: '07 · MCP 标准插口', link: '/learn/03-capabilities/mcp-integration' },
        { text: '08 · 评估框架：跑分说话', link: '/learn/05-quality/evals-quality-gate' },
        { text: '09 · 产品线组装：客服系统', link: '/learn/07-applications/service-product-line' },
        { text: '09b · 多 Agent 编排（已迁至阶段 04）', link: '/learn/04-orchestration/multi-agent-orchestration' },
        { text: '10 · Web 前端与 SSE 流式', link: '/learn/06-fullstack/web-sse-frontend' },
        { text: '11 · 生产化与成熟度', link: '/learn/05-quality/production-maturity' },
        { text: '12 · 学完之后：演进方向（已迁至进阶）', link: '/advanced/evolution' },
        { text: '13 · 面试实战（已迁至进阶）', link: '/advanced/interview' }
      ]
  },
  {
      text: '📚 参考库 · 模块深讲',
      collapsed: false,
      items: [
        { text: '工具循环深读', link: '/reference/01-agent-loop' },
        { text: '内核三辅助（llm/config/trace）', link: '/reference/02-llm-config-trace' },
        { text: '工具箱', link: '/reference/03-tools' },
        { text: '三层记忆', link: '/reference/04-memory' },
        { text: 'RAG 零件', link: '/reference/05-rag' },
        { text: '护栏', link: '/reference/06-guardrails' },
        { text: 'MCP 集成', link: '/reference/07-mcp' },
        { text: '评估框架', link: '/reference/08-evals' },
        { text: '客服产品线', link: '/reference/09-service' },
        { text: '编排器：多 Agent 骨架', link: '/reference/10-orchestrator' }
      ]
  },
  {
      text: '🧩 案例 · 产品落地',
      collapsed: false,
      items: [
        { text: '知识库问答', link: '/cases/knowledge-base' },
        { text: '智能客服', link: '/cases/customer-service' },
        { text: '文档智能', link: '/cases/document-intelligence' }
      ]
  },
  {
      text: '🎓 进阶 · 演进与求职',
      collapsed: true,
      items: [
        { text: '进阶专题入口', link: '/advanced/' },
        { text: '扩展指南：加工具/加实现/换网关', link: '/advanced/extending' },
        { text: '成熟度矩阵：离生产还差几步', link: '/advanced/maturity' },
        { text: '学完之后：演进方向（原 12 站）', link: '/advanced/evolution' },
        { text: '面试实战：带着问题通关（原 13 站）', link: '/advanced/interview' }
      ]
  },
]
