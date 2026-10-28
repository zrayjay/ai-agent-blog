import { defineConfig } from 'vitepress'
import { mainSidebar } from './sidebar/main.mts'
import { archiveWeeksSidebar } from './sidebar/archive-weeks.mts'
import { archiveASidebar } from './sidebar/archive-a.mts'
import { archiveBSidebar } from './sidebar/archive-b.mts'

export default defineConfig({
  lang: 'zh-CN',
  // 自定义域名根路径部署（rayjay.is-a.dev，2026-10-15 起；此前 GitHub Pages 子路径 /ai-agent-blog/）
  base: '/',
  title: 'AI Agent 全栈工程师',
  description:
    '以 TypeScript 为主线的 AI Agent 工程教程：从模型调用、工具循环、记忆与 RAG，到安全、评估、多 Agent 编排与全栈交付。',

  head: [['link', { rel: 'icon', type: 'image/png', href: '/logo.png' }]],

  markdown: {
    lineNumbers: true,
    config: (md) => {
      const escapeHtml = md.utils.escapeHtml
      md.renderer.rules.code_inline = (tokens, idx) =>
        `<code v-pre>${escapeHtml(tokens[idx].content)}</code>`
    }
  },

  ignoreDeadLinks: [/^https?:\/\/localhost/],

  themeConfig: {
    logo: '/logo.png',

    nav: [
      { text: '首页', link: '/' },
      { text: '学习路线', link: '/#learning-path' },
      { text: '模块参考', link: '/reference/README' },
      { text: '进阶专题', link: '/advanced/' }
    ],

    // 顶部 GitHub 仓库入口：默认主题会同时渲染桌面顶栏图标与移动端菜单入口。
    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/zrayjay/ai-agent-blog',
        ariaLabel: 'GitHub 仓库'
      }
    ],

    outline: { level: [2, 3], label: '本页目录' },

    docFooter: { prev: '上一篇', next: '下一篇' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '目录',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',

    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
              modal: {
                noResultsText: '没有结果',
                resetButtonTitle: '重置搜索',
                footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
              }
            }
          }
        }
      }
    },

    sidebar: [
      ...mainSidebar,
      ...archiveWeeksSidebar,
      ...archiveASidebar,
      ...archiveBSidebar,
    ]
  }
})
