<script setup lang="ts">
import { learningStages, lessonCount, products } from './home-content'

const stats = [
  { n: learningStages.length, unit: '个阶段', label: '从内核到交付' },
  { n: lessonCount, unit: '个学习单元', label: '01–13 + 09b 编排专题' },
  { n: products.length, unit: '个实践方向', label: '知识库 · 客服 · 文档智能' },
  { n: 'TS', unit: '主线', label: '引擎 + CLI / API / Web' }
]
</script>

<template>
  <div class="jstats" aria-label="课程概览">
    <div v-for="stat in stats" :key="stat.label" class="jstats-cell">
      <div class="jstats-num">
        <span class="jstats-n">{{ stat.n }}</span>
        <span class="jstats-unit">{{ stat.unit }}</span>
      </div>
      <div class="jstats-label">{{ stat.label }}</div>
    </div>
  </div>
</template>

<style scoped>
.jstats {
  width: calc(100% - 48px);
}
@media (max-width: 480px) {
  .jstats {
    padding: 0 8px;
  }
  .jstats-cell {
    padding: 22px 8px;
  }
  .jstats-unit {
    font-size: 12px;
  }
}
</style>
