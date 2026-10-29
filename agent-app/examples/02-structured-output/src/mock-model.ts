// mock-model.ts —— 确定性假模型：模拟「弱模型跑偏」的真实故障。
// 场景原型：glm-4-flash 被要求输出 JSON 却回了散文——课内可靠性排序的实证来源。
// 响应形状从 MockLanguageModelV2 的 doGenerate 返回类型反推（同引擎测试做法）。
import { MockLanguageModelV2 } from "ai/test";

type ScriptedResponse = Awaited<ReturnType<InstanceType<typeof MockLanguageModelV2>["doGenerate"]>>;

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

function textResponse(text: string): ScriptedResponse {
  return {
    content: [{ type: "text", text }],
    finishReason: "stop",
    usage: ZERO_USAGE,
    warnings: [],
  };
}

/** 跑偏模型：被求 JSON 却输出了「废话 + 围栏 JSON + 尾巴」——弱模型真实形态 */
export function driftyModel(): InstanceType<typeof MockLanguageModelV2> {
  return new MockLanguageModelV2({
    doGenerate: async () =>
      textResponse(
        "好的，我来比较一下这两座城市的气温！\n" +
          '```json\n{"city":"上海","hotter":true}\n```\n' +
          "希望这个回答对你有帮助～",
      ),
  });
}

/** 纯闲聊模型：输出里一个 JSON 都没有——extractJson 也救不了的最坏情况 */
export function chattyModel(): InstanceType<typeof MockLanguageModelV2> {
  return new MockLanguageModelV2({
    doGenerate: async () => textResponse("这个问题真有意思，不过我想先聊聊天气。"),
  });
}
