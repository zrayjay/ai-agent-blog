<script setup lang="ts">
import { withBase } from 'vitepress'

const resources = [
  {
    title: '模块参考库',
    description: '十篇模块深讲：核心概念、源码走读、设计取舍与自测题。',
    href: '/reference/README',
    label: '按模块查实现'
  },
  {
    title: '扩展指南',
    description: '加一个工具、替换存储实现或切换模型网关，从现有接口接入。',
    href: '/how-to/EXTENDING',
    label: '动手改造项目'
  },
  {
    title: '成熟度矩阵',
    description: '对照已有实现、演示边界与生产缺口，判断下一步该补什么。',
    href: '/how-to/MATURITY',
    label: '检查交付边界'
  }
]
</script>

<template>
  <section class="jsec resources-section" aria-labelledby="resources-title">
    <header class="jsec-head">
      <p class="jsec-kicker">GO DEEPER · 深入查阅</p>
      <h2 id="resources-title" class="jsec-title">学过之后，随时回来查</h2>
    </header>
    <div class="resource-list">
      <a
        v-for="resource in resources"
        :key="resource.href"
        class="resource-link"
        :href="withBase(resource.href)"
      >
        <h3 class="resource-title">{{ resource.title }}</h3>
        <p class="resource-description">{{ resource.description }}</p>
        <span class="resource-action">{{ resource.label }} <span aria-hidden="true">↗</span></span>
      </a>
    </div>
    <aside class="archive-note" aria-label="旧版课程入口">
      <p class="archive-title">还在跟着 23 周课程学习？</p>
      <p class="archive-description">
        按周教程已归档，可继续按原有节奏阅读，也可用来补齐 TypeScript、全栈与 Python 基础。
      </p>
      <div class="archive-links">
        <a :href="withBase('/archive/weeks/week01/')">按周索引 →</a>
        <a :href="withBase('/roadmap')">旧版路线图 →</a>
        <a :href="withBase('/guide/')">双轨学习指南 →</a>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.resources-section {
  margin-top: 88px;
}
.resource-list {
  border-top: 1px solid var(--vp-c-divider);
}
.resource-link {
  display: grid;
  grid-template-columns: 140px 1fr auto;
  align-items: center;
  gap: 24px;
  padding: 24px 12px;
  border-bottom: 1px solid var(--vp-c-divider);
  transition: background-color 0.2s;
}
.resource-link:hover {
  background: var(--vp-c-brand-soft);
}
.resource-link:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 3px;
}
.resource-title {
  font-size: 17px;
  font-weight: 600;
}
.resource-description {
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.9;
}
.resource-action {
  color: var(--vp-c-brand-1);
  font-size: 12px;
  white-space: nowrap;
}
.archive-note {
  margin-top: 32px;
  padding: 22px 24px;
  border-left: 2px solid var(--vp-c-border);
  background: var(--jerry-wash);
}
.archive-title {
  font-size: 14px;
  font-weight: 600;
}
.archive-description {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.9;
  color: var(--vp-c-text-2);
}
.archive-links {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  margin-top: 14px;
  font-size: 13px;
  color: var(--vp-c-brand-1);
}
.archive-links a:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}
@media (max-width: 760px) {
  .resource-link {
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 22px 4px;
  }
}
</style>
