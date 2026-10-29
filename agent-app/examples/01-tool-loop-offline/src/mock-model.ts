// mock-model.ts —— 确定性假模型：按剧本逐轮返回（与引擎测试的 ai/test 接缝同款）。
// 离线示例的"模型"：类型与真实模型完全同构，返回完全可预期——教学用。
// 响应形状从 MockLanguageModelV2 的 doGenerate 返回类型反推，避免手写长类型漂移
// （同引擎测试做法；不直接依赖 @ai-sdk/provider，示例依赖面保持最小）。
import { MockLanguageModelV2 } from "ai/test";

type ScriptedResponse = Awaited<ReturnType<InstanceType<typeof MockLanguageModelV2>["doGenerate"]>>;

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

function toolCallResponse(id: number, toolName: string, input: Record<string, unknown>): ScriptedResponse {
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: `mock-call-${id}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: "tool-calls",
    usage: ZERO_USAGE,
    warnings: [],
  };
}

function textResponse(text: string): ScriptedResponse {
  return {
    content: [{ type: "text", text }],
    finishReason: "stop",
    usage: ZERO_USAGE,
    warnings: [],
  };
}

/**
 * 天气查询剧本：查北京 → 查上海 → 汇总作答。
 * 剧本按调用次数推进，超出剧本的最后兜底返回文本（防意外死循环）。
 */
export function scriptedWeatherModel(): InstanceType<typeof MockLanguageModelV2> {
  let step = 0;
  const script: ScriptedResponse[] = [
    toolCallResponse(1, "getWeather", { city: "北京" }),
    toolCallResponse(2, "getWeather", { city: "上海" }),
    textResponse("上海今天更热：28°C 对 23°C。"),
  ];
  return new MockLanguageModelV2({
    doGenerate: async () => script[Math.min(step++, script.length - 1)],
  });
}
