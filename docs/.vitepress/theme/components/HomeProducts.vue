<script setup lang="ts">
import { withBase } from 'vitepress'
import { products } from './home-content'
</script>

<template>
  <section id="practice" class="jsec products-section" aria-labelledby="products-title">
    <header class="jsec-head">
      <p class="jsec-kicker">BUILD SOMETHING · 产品实践</p>
      <h2 id="products-title" class="jsec-title">带着一个业务问题，重新组装所学</h2>
      <p class="products-intro">主线打基础，产品专题讲组装。选择一个方向，把零件连成完整流程。</p>
    </header>
    <div class="products-grid">
      <a v-for="product in products" :key="product.no" class="product-card" :href="withBase(product.href)">
        <div class="product-meta">
          <span class="product-number">{{ product.no }}</span>
          <span>{{ product.label }}</span>
        </div>
        <h3 class="product-title">{{ product.title }}</h3>
        <p class="product-description">{{ product.description }}</p>
        <p class="product-prerequisite">{{ product.prerequisite }}</p>
        <span class="product-action">阅读组装专题 <span aria-hidden="true">↗</span></span>
      </a>
    </div>
  </section>
</template>

<style scoped>
.products-section {
  margin-top: 88px;
  scroll-margin-top: 96px;
}
.products-intro {
  margin-top: 16px;
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.9;
}
.products-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.product-card {
  display: flex;
  flex-direction: column;
  padding: 26px;
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  background: var(--vp-c-bg-elv);
  transition:
    border-color 0.2s,
    background-color 0.2s;
}
.product-card:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.product-card:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 4px;
}
.product-meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: var(--vp-c-text-2);
  font-size: 11px;
}
.product-number {
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-brand-1);
}
.product-title {
  margin: 28px 0 12px;
  font-size: 22px;
  font-weight: 700;
}
.product-description {
  flex-grow: 1;
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.9;
}
.product-prerequisite {
  margin-top: 24px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--vp-c-text-2);
}
.product-action {
  display: flex;
  justify-content: space-between;
  padding-top: 16px;
  margin-top: 18px;
  border-top: 1px solid var(--vp-c-divider);
  color: var(--vp-c-brand-1);
  font-size: 13px;
  font-weight: 600;
}
@media (max-width: 760px) {
  .products-grid {
    grid-template-columns: 1fr;
  }
  .product-title {
    margin-top: 18px;
  }
}
</style>
