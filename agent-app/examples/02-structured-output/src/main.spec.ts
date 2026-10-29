// main.spec.ts —— 02 示例的离线确定性测试（CI 必跑，零密钥）。
// 断言可靠性排序的三条工程事实：
// 1) 严格 JSON.parse 对跑偏文本必炸；2) extractJson 能从围栏+废话中抠出 JSON；
// 3) zod 校验拒绝形状不对的数据（哪怕 JSON 合法）。
import { describe, expect, it } from "vitest";
import { generateText } from "ai";
import { z } from "zod";
import { driftyModel, chattyModel } from "./mock-model.js";
import { extractJson } from "@agent-app/engine/json-utils";

const verdictSchema = z.object({
  city: z.string().min(1),
  hotter: z.boolean(),
});

async function ask(model: Parameters<typeof generateText>[0]["model"], prompt: string): Promise<string> {
  const { text } = await generateText({ model, prompt });
  return text;
}

describe("02-structured-output", () => {
  it("严格 JSON.parse 对跑偏文本必炸（裸 JSON 指令的失败模式）", async () => {
    const raw = await ask(driftyModel(), "比较北京和上海");
    expect(raw).toContain("```json"); // 弱模型确实「部分守约」——围栏里有 JSON
    expect(() => JSON.parse(raw)).toThrow();
  });

  it("extractJson 从围栏+废话中抠出第一个完整 JSON 值", async () => {
    const raw = await ask(driftyModel(), "比较北京和上海");
    const extracted = extractJson(raw);
    expect(extracted).toEqual({ city: "上海", hotter: true });
    expect(verdictSchema.parse(extracted)).toEqual({ city: "上海", hotter: true });
  });

  it("zod 校验拒绝形状不对的数据：合法 JSON ≠ 合法业务对象", () => {
    expect(() => verdictSchema.parse({ city: 123, hotter: "yes" })).toThrow();
  });

  it("纯闲聊无 JSON：extractJson 抛带原文摘录的中文错误", async () => {
    const raw = await ask(chattyModel(), "比较北京和上海");
    expect(() => extractJson(raw)).toThrow(/模型未按 JSON 约定回复/);
    expect(() => extractJson(raw)).toThrow(raw.slice(0, 10)); // 错误带原文摘录
  });
});
