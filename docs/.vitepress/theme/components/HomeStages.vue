<script setup lang="ts">
import { withBase } from 'vitepress'
import { learningStages } from './home-content'
</script>

<template>
  <section id="learning-path" class="jsec jsec-stages" aria-labelledby="path-title">
    <header class="jsec-head">
      <p class="jsec-kicker">LEARNING PATH · 能力主线</p>
      <h2 id="path-title" class="jsec-title">沿着一套引擎，逐步补齐工程能力</h2>
      <p class="path-intro">按顺序学习，按阶段验证。章节沿用 01–13 编号，09b 单列多 Agent 编排专题。</p>
    </header>
    <div class="path-stages">
      <article v-for="stage in learningStages" :key="stage.no" class="path-stage">
        <div class="path-overview">
          <span class="path-number" aria-hidden="true">{{ stage.no }}</span>
          <h3 class="path-title">{{ stage.title }}</h3>
          <p class="path-description">{{ stage.description }}</p>
          <p class="path-outcome">{{ stage.outcome }}</p>
        </div>
        <ol class="path-lessons">
          <li v-for="lesson in stage.lessons" :key="lesson.no">
            <a class="path-lesson" :href="withBase(lesson.href)">
              <span class="lesson-number">{{ lesson.no }}</span>
              <div class="lesson-body">
                <span class="lesson-title">{{ lesson.title }}</span>
                <span class="lesson-summary">{{ lesson.summary }}</span>
                <span v-if="lesson.note" class="lesson-note">{{ lesson.note }}</span>
              </div>
              <span class="lesson-arrow" aria-hidden="true">↗</span>
            </a>
          </li>
        </ol>
      </article>
    </div>
    <p class="path-footnote">
      每课配有可运行示例与离线测试；遇到实现细节再查模块参考。
    </p>
  </section>
</template>

<style scoped>
.jsec-stages {
  scroll-margin-top: 96px;
}
.path-intro,
.path-description,
.path-footnote {
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.9;
}
.path-intro {
  margin-top: 16px;
}
.path-stage {
  display: grid;
  grid-template-columns: 1fr 1.65fr;
  gap: 48px;
  padding: 32px 0;
  border-top: 1px solid var(--vp-c-divider);
}
.path-number {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--vp-c-brand-1);
}
.path-title {
  margin: 12px 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.5;
}
.path-outcome {
  margin-top: 22px;
  padding-left: 14px;
  border-left: 2px solid var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
  font-size: 13px;
  line-height: 1.9;
}
.path-lessons {
  list-style: none;
  margin: 0;
  padding: 0;
}
.path-lesson {
  display: grid;
  grid-template-columns: 36px 1fr 20px;
  gap: 16px;
  padding: 16px;
  border-radius: 8px;
  transition: background-color 0.2s;
}
.path-lesson:hover,
.path-lesson:focus-visible {
  background: var(--vp-c-bg-soft);
}
.path-lesson:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
.path-lessons li + li {
  border-top: 1px solid var(--vp-c-gutter);
}
.lesson-number {
  padding-top: 1px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--vp-c-brand-1);
}
.lesson-title {
  display: block;
  font-size: 16px;
  font-weight: 600;
}
.lesson-summary {
  display: block;
  margin-top: 4px;
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.8;
}
.lesson-note {
  display: inline-block;
  margin-top: 6px;
  color: var(--vp-c-text-2);
  font-size: 11px;
  padding: 0 7px;
  background: var(--vp-c-brand-soft);
  border-radius: 4px;
}
.lesson-arrow {
  color: var(--vp-c-brand-1);
}
.path-footnote {
  padding-top: 18px;
  border-top: 1px solid var(--vp-c-divider);
  font-size: 13px;
}
.path-footnote a {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-underline-offset: 3px;
}
@media (max-width: 700px) {
  .path-stage {
    grid-template-columns: 1fr;
    gap: 18px;
  }
  .path-outcome {
    margin-top: 14px;
  }
  .path-lesson {
    padding: 14px 4px;
    gap: 10px;
  }
}
</style>
