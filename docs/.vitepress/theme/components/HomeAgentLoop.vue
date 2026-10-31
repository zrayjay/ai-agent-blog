<script setup lang="ts">
import { withBase } from 'vitepress'

// 静态流程图直接参与预渲染，无需计时器或浏览器状态。
const steps = [
  { label: '输入', title: '用户提出目标', detail: '消息 + 会话上下文' },
  { label: '决策', title: '模型选择工具', detail: '工具名称 + 结构化参数' },
  { label: '执行', title: '代码调用工具', detail: '校验、审批与幂等按需装配' },
  { label: '回填', title: '工具结果交回模型', detail: '继续调用工具，或生成最终回答' }
]
</script>

<template>
  <div class="loop-sheet">
    <div class="loop-bar">
      <span>ENGINE / TOOL LOOP</span>
      <span class="loop-label">流程示意</span>
    </div>
    <p class="loop-heading">模型做决策，代码做执行。</p>
    <ol class="loop-steps">
      <li v-for="step in steps" :key="step.label" class="loop-step">
        <span class="loop-tag">{{ step.label }}</span>
        <div>
          <span class="loop-title">{{ step.title }}</span>
          <span class="loop-detail">{{ step.detail }}</span>
        </div>
      </li>
    </ol>
    <div class="loop-return"><span aria-hidden="true">↳</span> 需要更多信息？带着结果回到「决策」</div>
    <a class="loop-link" :href="withBase('/learn/02-runtime/agent-loop')"
      >02 · 看懂工具循环 <span aria-hidden="true">→</span></a
    >
  </div>
</template>

<style scoped>
.loop-sheet {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 440px;
  padding: 26px;
  text-align: left;
  background: linear-gradient(152deg, #102653 0%, #111e40 60%, #251947 100%);
  color: #ecf5ff;
  border: 1px solid #37538a;
  border-radius: 14px;
  box-shadow: 0 24px 60px -30px rgba(33, 80, 179, 0.42);
}
.loop-bar {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: #a5cafa;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
}
.loop-label {
  white-space: nowrap;
}
.loop-heading {
  margin: 24px 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.6;
}
.loop-steps {
  margin: 0;
  padding: 0;
  list-style: none;
}
.loop-step {
  position: relative;
  display: flex;
  gap: 18px;
  padding-bottom: 23px;
}
.loop-step:not(:last-child)::before {
  content: '';
  position: absolute;
  top: 29px;
  bottom: 3px;
  left: 20px;
  width: 1px;
  background: #385a92;
}
.loop-tag {
  flex: none;
  align-self: flex-start;
  padding: 3px 7px;
  border: 1px solid #4e74ad;
  border-radius: 4px;
  font-size: 12px;
  line-height: 20px;
  color: #b4eaf7;
}
.loop-title {
  display: block;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.8;
}
.loop-detail {
  display: block;
  color: #adc7e7;
  font-size: 12px;
  line-height: 1.8;
}
.loop-return {
  padding: 12px 0;
  border-top: 1px dashed #385a92;
  color: #b4eaf7;
  font-size: 12px;
  line-height: 1.8;
}
.loop-link {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  color: #b1effa;
  font-size: 13px;
}
.loop-link:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.loop-link:focus-visible {
  outline: 2px solid #b1effa;
  outline-offset: 5px;
}
@media (max-width: 480px) {
  .loop-sheet {
    padding: 20px;
  }
}
</style>
