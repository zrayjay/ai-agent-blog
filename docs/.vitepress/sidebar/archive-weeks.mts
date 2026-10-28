// 归档 · 按周索引（旧版课程）
import type { DefaultTheme } from 'vitepress'

export const archiveWeeksSidebar: DefaultTheme.SidebarItem[] = [
  {
      text: '📦 归档 · 按周索引（旧版课程）',
      collapsed: true,
      items: [
        { text: '归档索引与说明', link: '/archive/weeks/' },
        { text: '第 1 周 · TypeScript 进阶 + Monorepo 工程化', link: '/archive/weeks/week01/' },
        { text: '第 2 周 · 代码质量门禁 + 测试 + Next.js 全栈路由', link: '/archive/weeks/week02/' },
        { text: '第 3 周 · Node.js 核心 + NestJS 入门', link: '/archive/weeks/week03/' },
        { text: '第 4 周 · PostgreSQL + Prisma + 全栈整合', link: '/archive/weeks/week04/' },
        { text: '第 5 周 · 认证授权 + 安全基础', link: '/archive/weeks/week05/' },
        { text: '第 6 周 · Redis + 缓存 + 队列 + 并发控制', link: '/archive/weeks/week06/' },
        { text: '第 7 周 · Docker + CI/CD', link: '/archive/weeks/week07/' },
        { text: '第 8 周 · 云部署 + Nginx + 可观测性入门', link: '/archive/weeks/week08/' },
        { text: '第 9 周 · Python 核心 + Pydantic', link: '/archive/weeks/week09/' },
        { text: '第 10 周 · FastAPI + SSE 流式响应', link: '/archive/weeks/week10/' },
        { text: '第 11 周 · LLM API 基础 + 结构化输出 + Vercel AI SDK', link: '/archive/weeks/week11/' },
        { text: '第 12 周 · LangGraph + ReAct + 工具调用', link: '/archive/weeks/week12/' },
        { text: '第 13 周 · 多 Agent 协作 + Human-in-the-Loop', link: '/archive/weeks/week13/' },
        { text: '第 14 周 · RAG Pipeline 基础', link: '/archive/weeks/week14/' },
        { text: '第 15 周 · RAG 进阶 + 引用溯源', link: '/archive/weeks/week15/' },
        { text: '第 16 周 · Agent 评估工程', link: '/archive/weeks/week16/' },
        { text: '第 17 周 · 记忆架构 + 上下文工程', link: '/archive/weeks/week17/' },
        { text: '第 18 周 · MCP 协议 + 工具生态', link: '/archive/weeks/week18/' },
        { text: '第 19 周 · Agent 安全 + A2A + 国产生态', link: '/archive/weeks/week19/' },
        { text: '第 20 周 · 全栈整合 + 平台主链路', link: '/archive/weeks/week20/' },
        { text: '第 21 周 · 生产化 + 可观测性 + 成本控制', link: '/archive/weeks/week21/' },
        { text: '第 22 周 · 系统设计 + 项目复盘 + 简历', link: '/archive/weeks/week22/' },
        { text: '第 23 周 · 面试冲刺', link: '/archive/weeks/week23/' }
      ]
  },
]
