// 归档 A · Node + TS 按天
import type { DefaultTheme } from 'vitepress'

export const archiveASidebar: DefaultTheme.SidebarItem[] = [
  {
      text: '📦 归档 A · Node + TS 按天',
      collapsed: true,
      items: [
        {
          text: '语言与类型进阶',
          collapsed: true,
          items: [
            { text: '泛型基础', link: '/archive/weeks/week01/day1' },
            { text: '条件类型与映射类型', link: '/archive/weeks/week01/day2' },
            { text: '类型守卫与类型窄化', link: '/archive/weeks/week01/day3' }
          ]
        },
        {
          text: '工程底座',
          collapsed: true,
          items: [
            { text: 'Monorepo 与 pnpm workspace', link: '/archive/weeks/week01/day4' },
            { text: 'Turborepo 任务管道', link: '/archive/weeks/week01/day5' },
            { text: '共享类型包与工具包', link: '/archive/weeks/week01/day6' },
            { text: '周复盘', link: '/archive/weeks/week01/day7' },
            { text: 'ESLint 与 Prettier', link: '/archive/weeks/week02/day1' },
            { text: 'Husky 与 Git 钩子', link: '/archive/weeks/week02/day2' },
            { text: 'Vitest 单元测试', link: '/archive/weeks/week02/day3' }
          ]
        },
        {
          text: 'Web 全栈',
          collapsed: true,
          items: [
            { text: 'Next.js 15 App Router', link: '/archive/weeks/week02/day4' },
            { text: 'Server 与 Client 组件', link: '/archive/weeks/week02/day5' },
            { text: 'Server Actions', link: '/archive/weeks/week02/day6' },
            { text: 'Node 事件循环', link: '/archive/weeks/week03/day1' },
            { text: '模块与环境变量', link: '/archive/weeks/week03/day2' },
            { text: 'NestJS 入门', link: '/archive/weeks/week03/day3' },
            { text: 'Controller 与 DTO', link: '/archive/weeks/week03/day4' },
            { text: 'Service 与依赖注入', link: '/archive/weeks/week03/day5' },
            { text: 'Pipe 参数校验', link: '/archive/weeks/week03/day6' },
            { text: '周复盘', link: '/archive/weeks/week03/day7' },
            { text: '第 2 周复盘', link: '/archive/weeks/week02/day7' }
          ]
        },
        {
          text: '数据与 API 整合',
          collapsed: true,
          items: [
            { text: 'PostgreSQL 基础', link: '/archive/weeks/week04/day1' },
            { text: 'Prisma 入门', link: '/archive/weeks/week04/day2' },
            { text: 'Prisma CRUD', link: '/archive/weeks/week04/day3' },
            { text: '事务与索引', link: '/archive/weeks/week04/day4' },
            { text: 'NestJS 整合 Prisma', link: '/archive/weeks/week04/day5' },
            { text: '前后端联调', link: '/archive/weeks/week04/day6' },
            { text: '阶段一里程碑', link: '/archive/weeks/week04/day7' },
            { text: 'JWT 签发', link: '/archive/weeks/week05/day1' },
            { text: 'JWT 守卫', link: '/archive/weeks/week05/day2' },
            { text: 'Refresh Token', link: '/archive/weeks/week05/day3' },
            { text: 'RBAC', link: '/archive/weeks/week05/day4' },
            { text: 'OAuth2', link: '/archive/weeks/week05/day5' },
            { text: 'Web 安全', link: '/archive/weeks/week05/day6' },
            { text: '周复盘', link: '/archive/weeks/week05/day7' }
          ]
        },
        {
          text: '生产基建',
          collapsed: true,
          items: [
            { text: 'Redis 基础', link: '/archive/weeks/week06/day1' },
            { text: '缓存策略', link: '/archive/weeks/week06/day2' },
            { text: '分布式锁', link: '/archive/weeks/week06/day3' },
            { text: 'BullMQ 队列', link: '/archive/weeks/week06/day4' },
            { text: '重试延迟与定时', link: '/archive/weeks/week06/day5' },
            { text: '幂等设计', link: '/archive/weeks/week06/day6' },
            { text: 'Dockerfile', link: '/archive/weeks/week07/day1' },
            { text: 'compose 编排', link: '/archive/weeks/week07/day2' },
            { text: '前端容器化与 Nginx', link: '/archive/weeks/week07/day3' },
            { text: 'GitHub Actions', link: '/archive/weeks/week07/day4' },
            { text: '镜像推送', link: '/archive/weeks/week07/day5' },
            { text: '密钥管理', link: '/archive/weeks/week07/day6' },
            { text: '云服务器', link: '/archive/weeks/week08/day1' },
            { text: 'Nginx 与 HTTPS', link: '/archive/weeks/week08/day2' },
            { text: '自动部署', link: '/archive/weeks/week08/day3' },
            { text: '结构化日志', link: '/archive/weeks/week08/day4' },
            { text: '监控入门', link: '/archive/weeks/week08/day5' },
            { text: '健康检查与优雅关闭', link: '/archive/weeks/week08/day6' },
            { text: '阶段二里程碑', link: '/archive/weeks/week08/day7' },
            { text: '周复盘（第 6 周）', link: '/archive/weeks/week06/day7' },
            { text: '周复盘（第 7 周）', link: '/archive/weeks/week07/day7' }
          ]
        },
        {
          text: 'LLM 与 Agent 核心',
          collapsed: true,
          items: [
            { text: 'LLM API 原生调用', link: '/archive/weeks/week11/day1' },
            { text: '流式与 Function Calling', link: '/archive/weeks/week11/day2' },
            { text: '结构化输出', link: '/archive/weeks/week11/day3' },
            { text: 'Vercel AI SDK 后端', link: '/archive/weeks/week11/day4' },
            { text: 'AI SDK 前端', link: '/archive/weeks/week11/day5' },
            { text: '多供应商切换', link: '/archive/weeks/week11/day6' },
            { text: 'Agent 循环深入（补篇）', link: '/archive/weeks/week11/agent-loop-ts' },
            { text: 'RAG TS 全链路（补篇）', link: '/archive/weeks/week11/rag-ts' },
            { text: 'MCP TypeScript SDK（补篇）', link: '/archive/weeks/week11/mcp-ts' },
            { text: '记忆 TS 版（补篇）', link: '/archive/weeks/week11/memory-ts' },
            { text: '周复盘', link: '/archive/weeks/week11/day7' }
          ]
        },
        {
          text: 'RAG 与知识库',
          collapsed: true,
          items: [
            { text: 'RAG 概念与流程', link: '/archive/weeks/week14/day1' },
            { text: '文档解析', link: '/archive/weeks/week14/day2' },
            { text: '文本切块', link: '/archive/weeks/week14/day3' },
            { text: 'Embedding', link: '/archive/weeks/week14/day4' },
            { text: 'pgvector 向量存储', link: '/archive/weeks/week14/day5' },
            { text: '相似度检索', link: '/archive/weeks/week14/day6' },
            { text: 'Hybrid 混合检索', link: '/archive/weeks/week15/day1' },
            { text: '重排序', link: '/archive/weeks/week15/day2' },
            { text: 'Adaptive RAG', link: '/archive/weeks/week15/day3' },
            { text: '引用溯源', link: '/archive/weeks/week15/day4' },
            { text: 'RAG 评估', link: '/archive/weeks/week15/day5' },
            { text: '知识库管理 UI', link: '/archive/weeks/week15/day6' },
            { text: '周复盘（第 14 周）', link: '/archive/weeks/week14/day7' },
            { text: '周复盘（第 15 周）', link: '/archive/weeks/week15/day7' }
          ]
        },
        {
          text: '评估与安全',
          collapsed: true,
          items: [
            { text: '评估方法论', link: '/archive/weeks/week16/day1' },
            { text: 'LLM-as-judge', link: '/archive/weeks/week16/day2' },
            { text: '轨迹评估', link: '/archive/weeks/week16/day3' },
            { text: 'promptfoo 实操', link: '/archive/weeks/week16/day4' },
            { text: 'DeepEval 实操', link: '/archive/weeks/week16/day5' },
            { text: '评估进 CI', link: '/archive/weeks/week16/day6' },
            { text: '自建评估框架 TS（补篇）', link: '/archive/weeks/week16/evals-ts' },
            { text: 'Prompt Injection 攻防', link: '/archive/weeks/week19/day1' },
            { text: 'OWASP 自查', link: '/archive/weeks/week19/day2' },
            { text: 'Guardrails', link: '/archive/weeks/week19/day3' },
            { text: 'A2A 协议', link: '/archive/weeks/week19/day4' },
            { text: 'Dify 上手', link: '/archive/weeks/week19/day5' },
            { text: 'Coze 与选型', link: '/archive/weeks/week19/day6' },
            { text: '红队实测记录（补篇）', link: '/archive/weeks/week19/redteam-notes' },
            { text: '周复盘', link: '/archive/weeks/week16/day7' }
          ]
        },
        {
          text: '三大产品落地',
          collapsed: true,
          items: [
            { text: '阶段四里程碑验收', link: '/archive/weeks/week19/day7' },
            { text: '全栈整合', link: '/archive/weeks/week20/day1' },
            { text: 'BFF 层', link: '/archive/weeks/week20/day2' },
            { text: '多租户 RBAC', link: '/archive/weeks/week20/day3' },
            { text: '统一认证', link: '/archive/weeks/week20/day4' },
            { text: '流式对话 UI', link: '/archive/weeks/week20/day5' },
            { text: '平台导航整合', link: '/archive/weeks/week20/day6' },
            { text: '客服流式化实战（补篇）', link: '/archive/weeks/week20/service-streaming' },
            { text: 'Tracing 与可观测', link: '/archive/weeks/week21/day1' },
            { text: '成本与模型路由', link: '/archive/weeks/week21/day2' },
            { text: '限流配额', link: '/archive/weeks/week21/day3' },
            { text: '死循环防御', link: '/archive/weeks/week21/day4' },
            { text: '日志指标告警', link: '/archive/weeks/week21/day5' },
            { text: '语义缓存', link: '/archive/weeks/week21/day6' },
            { text: '周复盘（第 20 周）', link: '/archive/weeks/week20/day7' },
            { text: '压测日与周复盘', link: '/archive/weeks/week21/day7' },
            { text: '知识库问答落地', link: '/cases/knowledge-base' },
            { text: '文档智能落地', link: '/cases/document-intelligence' },
            { text: '客服系统落地', link: '/cases/customer-service' }
          ]
        },
        {
          text: '精通与求职',
          collapsed: true,
          items: [
            { text: '系统设计方法论', link: '/archive/weeks/week22/day1' },
            { text: '缓存三件套', link: '/archive/weeks/week22/day2' },
            { text: '队列设计', link: '/archive/weeks/week22/day3' },
            { text: 'STAR 复盘', link: '/archive/weeks/week22/day4' },
            { text: '简历优化', link: '/archive/weeks/week22/day5' },
            { text: '模拟面试', link: '/archive/weeks/week22/day6' },
            { text: '周复盘', link: '/archive/weeks/week22/day7' },
            { text: 'Agent 八股', link: '/archive/weeks/week23/day1' },
            { text: '工程八股', link: '/archive/weeks/week23/day2' },
            { text: '系统设计模拟', link: '/archive/weeks/week23/day3' },
            { text: 'LeetCode', link: '/archive/weeks/week23/day4' },
            { text: '完整模拟面试', link: '/archive/weeks/week23/day5' },
            { text: '投递冲刺', link: '/archive/weeks/week23/day6' },
            { text: '面试速查卡', link: '/archive/weeks/week23/day7' },
            { text: 'LangChain 生态地图（加餐）', link: '/archive/weeks/week12/langchain' },
            { text: '场景题实战（加餐）', link: '/archive/weeks/week23/scenarios' }
          ]
        }
      ]
  },
]
