<script setup lang="ts">
import { withBase } from 'vitepress'
</script>

<template>
  <div class="jhi">
    <p class="jhi-eyebrow">
      <span class="jhi-eyebrow-dot" aria-hidden="true"></span>
      JERRY’S WORKSHOP · AGENT 工程实践
    </p>
    <h1 class="jhi-title">
      从模型调用，<br />
      到 <span class="jhi-grad">Agent 工程</span>
    </h1>
    <p class="jhi-tagline">
      沿着 TypeScript 主线，手写工具循环，接上记忆与 RAG， 补齐安全、评估和多 Agent
      编排，最后交付可交互的全栈应用。 每一步都回到代码与验证。
    </p>
    <div class="jhi-actions">
      <a class="jbtn jbtn-primary" :href="withBase('/start/')">
        从这里开始 <span aria-hidden="true">→</span>
      </a>
      <a class="jbtn jbtn-ghost" href="#learning-path">查看学习路线</a>
    </div>
    <p class="jhi-status">
      面向有 JavaScript / TypeScript 基础的开发者
      <a :href="withBase('/start/environment')">环境与前置 →</a>
    </p>
  </div>
</template>

<style scoped>
.jhi-status {
  display: block;
  line-height: 1.9;
}
.jhi-status a {
  display: inline-block;
  margin-left: 8px;
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-underline-offset: 4px;
}
</style>
