// 归档 B · Python 按天
import type { SidebarItem } from 'vitepress'

export const archiveBSidebar: SidebarItem[] = [
  {
      text: '📦 归档 B · Python 按天',
      collapsed: true,
      items: [
        {
          text: 'Python 快速上手',
          collapsed: true,
          items: [
            { text: 'Python 工程环境', link: '/archive/weeks/week09/day1' },
            { text: 'Python 类型注解', link: '/archive/weeks/week09/day2' },
            { text: 'asyncio 基础', link: '/archive/weeks/week09/day3' },
            { text: 'Pydantic v2 基础', link: '/archive/weeks/week09/day4' },
            { text: 'pydantic-settings', link: '/archive/weeks/week09/day5' },
            { text: 'Python 装饰器与上下文管理器', link: '/archive/weeks/week09/day6' },
            { text: '周复盘', link: '/archive/weeks/week09/day7' }
          ]
        },
        {
          text: 'FastAPI 服务',
          collapsed: true,
          items: [
            { text: 'FastAPI 起步', link: '/archive/weeks/week10/day1' },
            { text: 'Pydantic 请求体与响应模型', link: '/archive/weeks/week10/day2' },
            { text: 'FastAPI 分层架构', link: '/archive/weeks/week10/day3' },
            { text: 'SQLAlchemy 2.0 与 Depends', link: '/archive/weeks/week10/day4' },
            { text: 'SSE 流式响应', link: '/archive/weeks/week10/day5' },
            { text: '前端消费 SSE', link: '/archive/weeks/week10/day6' },
            { text: '周复盘', link: '/archive/weeks/week10/day7' }
          ]
        },
        {
          text: 'LangGraph Agent',
          collapsed: true,
          items: [
            { text: 'LangGraph 核心概念', link: '/archive/weeks/week12/day1' },
            { text: '构建第一个 Graph', link: '/archive/weeks/week12/day2' },
            { text: '条件边与路由', link: '/archive/weeks/week12/day3' },
            { text: '手写 ReAct 循环', link: '/archive/weeks/week12/day4' },
            { text: 'Function Calling 定义 Tool Schema', link: '/archive/weeks/week12/day5' },
            { text: 'Checkpointer 状态持久化', link: '/archive/weeks/week12/day6' },
            { text: '周复盘', link: '/archive/weeks/week12/day7' }
          ]
        },
        {
          text: '多 Agent 与 HITL',
          collapsed: true,
          items: [
            { text: '多 Agent 架构设计', link: '/archive/weeks/week13/day1' },
            { text: 'Supervisor 实现', link: '/archive/weeks/week13/day2' },
            { text: 'Worker Agent 实现与工具集成', link: '/archive/weeks/week13/day3' },
            { text: 'Human-in-the-Loop', link: '/archive/weeks/week13/day4' },
            { text: '前端审批 UI', link: '/archive/weeks/week13/day5' },
            { text: '容错三道防线', link: '/archive/weeks/week13/day6' },
            { text: '阶段三里程碑验收', link: '/archive/weeks/week13/day7' }
          ]
        },
        {
          text: '记忆与上下文',
          collapsed: true,
          items: [
            { text: '记忆四分类', link: '/archive/weeks/week17/day1' },
            { text: '短期记忆', link: '/archive/weeks/week17/day2' },
            { text: '长期记忆', link: '/archive/weeks/week17/day3' },
            { text: '向量记忆', link: '/archive/weeks/week17/day4' },
            { text: 'System Prompt 设计', link: '/archive/weeks/week17/day5' },
            { text: '记忆整合到 LangGraph', link: '/archive/weeks/week17/day6' },
            { text: '周复盘', link: '/archive/weeks/week17/day7' }
          ]
        },
        {
          text: 'MCP',
          collapsed: true,
          items: [
            { text: 'MCP 协议全景', link: '/archive/weeks/week18/day1' },
            { text: '第一个 MCP Server', link: '/archive/weeks/week18/day2' },
            { text: 'MCP Client 集成', link: '/archive/weeks/week18/day3' },
            { text: 'MCP Resources', link: '/archive/weeks/week18/day4' },
            { text: 'MCP 安全护栏', link: '/archive/weeks/week18/day5' },
            { text: '工具审批 UI 升级', link: '/archive/weeks/week18/day6' },
            { text: '周复盘', link: '/archive/weeks/week18/day7' }
          ]
        }
      ]
  },
]
