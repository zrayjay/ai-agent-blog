// verification/registry.ts —— 验证器注册表：id → 工厂 的简单映射（Phase 1）。
//
// ── 为什么是「工厂」而不是验证器实例 ──────────────────────────────────────
// 内建验证器都带配置（schema / 期望工具名 / 产物清单），同一个 id（如 "schema"）
// 可以按不同配置创建多份实例。注册表存工厂，create 时才把配置烙进实例——
// 注册的是「验证器的做法」，创建的是「验证器的一份配置」。
//
// ── 刻意保持简单 ──────────────────────────────────────────────────────────
// 这不是插件系统：没有生命周期、没有优先级、没有异步加载。register 重复注册
// 直接抛错（同 id 两种做法 = 配置事故，静默覆盖会把排查变成考古）。

import type { Verifier } from "./types.js";

/** 验证器工厂：调用即产出一份按配置装配好的验证器 */
export type VerifierFactory = () => Verifier;

/** 注册表操作面：register（登记）/ get（查询）/ create（按 id 装配实例） */
export interface VerifierRegistry {
  /** 登记工厂；重复 id 抛错（不静默覆盖） */
  register(id: string, factory: VerifierFactory): void;
  /** 查询工厂（未登记返回 undefined，调用方自行决定是否兜底） */
  get(id: string): VerifierFactory | undefined;
  /** 按 id 装配一份验证器实例；未登记的 id 抛中文错误（附修复指引） */
  create(id: string): Verifier;
  /** 已登记的 id 列表（诊断/展示用） */
  ids(): string[];
}

export function createVerifierRegistry(): VerifierRegistry {
  const factories = new Map<string, VerifierFactory>();
  return {
    register(id, factory) {
      if (factories.has(id)) {
        throw new Error(`验证器 id 重复注册：${id}（同 id 只允许一种做法，请换 id 或先删除旧注册）`);
      }
      factories.set(id, factory);
    },
    get(id) {
      return factories.get(id);
    },
    create(id) {
      const factory = factories.get(id);
      if (factory === undefined) {
        throw new Error(
          `未注册的验证器 id：${id}（已注册：${[...factories.keys()].join("、") || "（空）"}）。` +
            "请先 register 再 create。",
        );
      }
      return factory();
    },
    ids() {
      return [...factories.keys()];
    },
  };
}
