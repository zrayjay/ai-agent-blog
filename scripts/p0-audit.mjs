import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  DIR,
  OUTPUT_PATHS,
  listTrackedMarkdown,
  readTrackedInputs,
  buildInventory,
  buildTracker,
  parseTrackerRows,
  parseTasks,
  formatDoc,
} from "./p0-audit-lib.mjs";

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const reportReadErrors = (errors) => {
  for (const e of errors) console.error(`读取失败 ${e.category}: ${e.path}`);
  fail(`存在 ${errors.length} 个读取失败的输入；全部输入验证通过才会写入任何输出`);
};

const writeOutputs = async (files) => {
  mkdirSync(DIR, { recursive: true });
  for (const [path, content] of files) writeFileSync(path, content);
};

const args = process.argv.slice(2);
try {
  if (args[0] === "--init") {
    const planPath = args[1];
    if (!planPath) fail("用法: node scripts/p0-audit.mjs --init <实施方案路径>（显式全量重建）| --update");
    const plan = readFileSync(planPath, "utf8");
    const tasks = parseTasks(plan);
    const paths = listTrackedMarkdown();
    const { contents, errors } = readTrackedInputs(paths);
    if (errors.length) reportReadErrors(errors);
    await writeOutputs([
      [`${DIR}/inventory.md`, await formatDoc(buildInventory(paths, contents))],
      [`${DIR}/implementation-tracker.md`, await formatDoc(buildTracker(plan, null))],
      [`${DIR}/implementation-plan.md`, await formatDoc(plan)],
    ]);
    console.log(`init OK: ${paths.length} 个 Markdown 行; ${tasks.length} 项任务`);
  } else if (args.length === 0 || args[0] === "--update") {
    const plan = readFileSync(`${DIR}/implementation-plan.md`, "utf8");
    parseTasks(plan);
    const trackerDisk = readFileSync(`${DIR}/implementation-tracker.md`, "utf8");
    const paths = listTrackedMarkdown();
    const { contents, errors } = readTrackedInputs(paths);
    if (errors.length) reportReadErrors(errors);
    await writeOutputs([
      [`${DIR}/inventory.md`, await formatDoc(buildInventory(paths, contents))],
      [
        `${DIR}/implementation-tracker.md`,
        await formatDoc(buildTracker(plan, parseTrackerRows(trackerDisk))),
      ],
    ]);
    console.log(`update OK: ${paths.length} 个 Markdown 行; 人工字段按 taskId 保留`);
  } else {
    fail("未知参数; 用法: node scripts/p0-audit.mjs --init <方案路径> | --update");
  }
} catch (e) {
  fail(e && e.message ? e.message : String(e));
}
