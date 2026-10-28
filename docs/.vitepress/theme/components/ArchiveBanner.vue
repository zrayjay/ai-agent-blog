<script setup lang="ts">
import { computed } from 'vue'
import { useData, useRoute, withBase } from 'vitepress'

// 归档提示条：/archive/ 路径下的所有页面显示「历史课程」声明（方案 §8.3-3）。
// 只读路由前缀，不修改任何归档页正文——161 篇日课保持历史原貌。
const route = useRoute()
const { frontmatter } = useData()

const isArchive = computed(() => route.path.startsWith('/archive/'))
// 归档索引页自身已有完整声明，不重复显示
const isIndex = computed(() => route.path === '/archive/weeks/' || route.path === '/archive/weeks')
</script>

<template>
  <div v-if="isArchive && !isIndex" class="archive-banner">
    <span class="ab-icon" aria-hidden="true">📦</span>
    <span class="ab-text">
      历史课程归档（2026-09 版，不再更新）——主线学习请走
      <a :href="withBase('/start/roadmap')">学习路线图</a>；
      归档说明见
      <a :href="withBase('/archive/weeks/')">归档索引</a>
    </span>
  </div>
</template>

<style scoped>
.archive-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0 0;
  padding: 10px 16px;
  border: 1px solid var(--vp-c-yellow-2);
  border-radius: 8px;
  background: var(--vp-c-yellow-soft);
  font-size: 13px;
  line-height: 1.7;
}
.ab-text {
  color: var(--vp-c-text-2);
}
.ab-text a {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-underline-offset: 4px;
  font-weight: 500;
}
</style>
