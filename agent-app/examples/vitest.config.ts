// vitest.config.ts —— examples 离线测试配置：include 限定各示例 src 下的 spec。
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["*/src/*.spec.ts"],
  },
});
