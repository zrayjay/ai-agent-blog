<script setup lang="ts">
import { withBase } from 'vitepress'
</script>

<template>
  <section class="jsec jsec-cta" aria-labelledby="cta-title">
    <div class="jc-band">
      <div class="jc-left">
        <p class="jc-kicker">READ → BUILD → VERIFY</p>
        <h2 id="cta-title" class="jc-title">先跑通一次，再理解每一层。</h2>
        <p class="jc-sub">从一次模型调用开始，把学习落在代码、结果和你的解释上。</p>
      </div>
      <div class="jc-right">
        <a class="jc-btn" :href="withBase('/guide/01-llm-basics')">
          <span>开始第 01 章</span>
          <span class="jc-btn-arr" aria-hidden="true">→</span>
        </a>
        <p class="jc-note">LLM API 与结构化输出</p>
      </div>
    </div>
  </section>
</template>
