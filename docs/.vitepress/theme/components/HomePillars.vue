<script setup lang="ts">
import { withBase } from 'vitepress'

const entries = [
  {
    no: '01',
    title: '第一次学 Agent',
    description: '从 LLM API 起步，按主线逐章阅读、运行示例，再对照通关标准验证。',
    href: '/guide/01-llm-basics',
    action: '从第 01 章开始'
  },
  {
    no: '02',
    title: '已经会调模型',
    description: '从手写工具循环切入，弄清工具结果如何回填、循环何时停止。',
    href: '/guide/02-agent-loop',
    action: '理解 Agent 内核'
  },
  {
    no: '03',
    title: '带着具体问题来',
    description: '按模块查源码、接口和设计取舍，需要改造时再进入扩展指南。',
    href: '/reference/README',
    action: '打开模块参考库'
  },
  {
    no: '04',
    title: '准备面试与复盘',
    description: '用知识题和场景题检查掌握程度，沿每题的项目证据回到实现。',
    href: '/guide/13-interview',
    action: '带着问题自检'
  }
]
</script>

<template>
  <section class="jsec jsec-pillars" aria-labelledby="entry-title">
    <header class="jsec-head">
      <p class="jsec-kicker">START HERE · 学习起点</p>
      <h2 id="entry-title" class="jsec-title">从你现在的位置出发</h2>
    </header>
    <div class="jp-grid">
      <a v-for="entry in entries" :key="entry.no" class="jp-item" :href="withBase(entry.href)">
        <span class="jp-no" aria-hidden="true">{{ entry.no }}</span>
        <div class="jp-body">
          <h3 class="jp-title">{{ entry.title }}</h3>
          <p class="jp-desc">{{ entry.description }}</p>
          <span class="entry-action">{{ entry.action }} <span aria-hidden="true">↗</span></span>
        </div>
      </a>
    </div>
  </section>
</template>

<style scoped>
.entry-action {
  display: inline-block;
  margin-top: 14px;
  color: var(--vp-c-brand-1);
  font-size: 13px;
  font-weight: 600;
}
.jp-item:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 4px;
}
</style>
