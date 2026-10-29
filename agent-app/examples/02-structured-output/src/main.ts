// main.ts —— 02 示例：结构化输出可靠性排序的四场景（全部离线）。
// 场景 1：裸 JSON 指令 + 严格 JSON.parse —— 弱模型跑偏直接炸（排序第 3 档）
// 场景 2：同文本 + extractJson 宽松抽取 —— 工程兜底（排序第 2 档）
// 场景 3：zod 校验把关 —— 最后一道闸
// 场景 4：纯闲聊无 JSON —— 抽取也救不了，抛中文错误由上层重试
// REAL MODEL 路径：把 driftyModel()/chattyModel() 换成 getModel()（@agent-app/engine/llm）。
import { z } from "zod";
import { extractJson } from "@agent-app/engine/json-utils";
import { driftyModel, chattyModel } from "./mock-model.js";
import { generateText } from "ai";

const verdictSchema = z.object({
  city: z.string().min(1),
  hotter: z.boolean(),
});

async function ask(model: Parameters<typeof generateText>[0]["model"], prompt: string): Promise<string> {
  const { text } = await generateText({ model, prompt });
  return text;
}

// 场景 1：裸 JSON 指令 + 严格 parse
let strictError: unknown;
try {
  const raw = await ask(driftyModel(), '比较北京和上海，只输出 JSON：{"city":…,"hotter":…}');
  JSON.parse(raw);
} catch (e) {
  strictError = e;
}
console.log("[场景 1] 裸 JSON 指令 + 严格 parse —— 模型跑偏（输出散文），直接抛错");

// 场景 2：同样的跑偏文本 + extractJson 宽松抽取
const driftedText = await ask(driftyModel(), "同上");
const extracted = extractJson(driftedText);
console.log(`[场景 2] 同样的跑偏文本 + extractJson 宽松抽取 —— 成功抠出 ${JSON.stringify(extracted)}`);

// 场景 3：zod 校验把关
const verdict = verdictSchema.parse(extracted);
console.log(`[场景 3] zod 校验把关 —— 通过 ${JSON.stringify(verdict)}`);

// 场景 4：纯闲聊——抽取也救不了
try {
  const chatty = await ask(chattyModel(), "比较北京和上海");
  extractJson(chatty);
} catch (e) {
  console.log("[场景 4] 抽取也救不了（纯闲聊无 JSON）—— 抛中文错误，上层决定重试");
}
