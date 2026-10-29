// main.ts —— 01 示例：工具循环的最小离线形态。
// 与引擎内置 examples/minimal-agent.ts 的差别：模型是 mock（零密钥），
// 机制完全相同——模型点名 → 引擎调度执行 → 结果回灌 → 直到模型给出终答。
// REAL MODEL 路径：把 scriptedWeatherModel() 换成 getModel()（@agent-app/engine/llm）。
import { tool } from "ai";
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

const events: string[] = [];

const result = await runToolLoop({
  model: scriptedWeatherModel(),
  messages: [{ role: "user", content: "北京和上海今天哪个更热？" }],
  tools: { getWeather },
  maxSteps: 5,
  onStep: (e) => {
    const line = `[step ${e.step}] 调用 ${e.toolCall.toolName}(${JSON.stringify(e.toolCall.input)})`;
    console.log(line);
    events.push(line);
  },
});

console.log(`\n最终回答（共 ${result.steps} 步）：\n${result.text}`);
