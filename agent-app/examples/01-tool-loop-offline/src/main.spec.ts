// main.spec.ts —— 01 示例的离线确定性测试（CI 必跑，零密钥）。
// 断言三件事：循环出口（3 步终答）、onStep 事件序列（点名顺序）、工具真实执行。
import { describe, expect, it } from "vitest";
import { tool } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { z } from "zod";
import { runToolLoop } from "@agent-app/engine/agent-loop";
import { scriptedWeatherModel } from "./mock-model.js";

const getWeather = tool({
  description: "查询某城市当前天气（温度与天气状况）",
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => ({
    city,
    condition: "晴",
    temperatureC: city.includes("上海") ? 28 : 23,
  }),
});

describe("01-tool-loop-offline", () => {
  it("mock 剧本驱动循环：两查一答，出口与事件序列确定", async () => {
    const events: { step: number; toolName: string; city: unknown }[] = [];
    const result = await runToolLoop({
      model: scriptedWeatherModel(),
      messages: [{ role: "user", content: "北京和上海今天哪个更热？" }],
      tools: { getWeather },
      maxSteps: 5,
      onStep: (e) =>
        events.push({
          step: e.step,
          toolName: e.toolCall.toolName,
          city: (e.toolCall.input as { city: string }).city,
        }),
    });

    expect(result.steps).toBe(3);
    expect(result.text).toContain("上海今天更热");
    expect(events.map((e) => e.toolName)).toEqual(["getWeather", "getWeather"]);
    expect(events.map((e) => e.city)).toEqual(["北京", "上海"]);
  });

  it("maxSteps 保险丝：剧本永给工具调用时，循环在步数上限抛明确错误", async () => {
    let step = 0;
    // 永远返回工具调用的假模型：验证循环的步数保险丝（MockLanguageModelV2 同缝，规格合规）
    const endless = new MockLanguageModelV2({
      doGenerate: async () => ({
        content: [
          {
            type: "tool-call" as const,
            toolCallId: `endless-${step++}`,
            toolName: "getWeather",
            input: JSON.stringify({ city: "北京" }),
          },
        ],
        finishReason: "tool-calls",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        warnings: [],
      }),
    });

    await expect(
      runToolLoop({
        model: endless,
        messages: [{ role: "user", content: " loop" }],
        tools: { getWeather },
        maxSteps: 3,
      }),
    ).rejects.toThrow(/步数/);
  });
});
