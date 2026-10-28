import { existsSync, readFileSync } from "node:fs";
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

const norm = (s) => s.replace(/\r\n/g, "\n");
const squeezeLines = (s) =>
  norm(s)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim());

// 只读校验：本脚本不写任何文件，也不调用生成器的写入口。
try {
  for (const p of OUTPUT_PATHS) {
    if (!existsSync(p)) fail(`缺少维护文档: ${p}`);
  }

  const plan = readFileSync(`${DIR}/implementation-plan.md`, "utf8");
  const tasks = parseTasks(plan);

  const paths = listTrackedMarkdown();
  const { contents, errors } = readTrackedInputs(paths);
  if (errors.length) {
    for (const e of errors) console.error(`读取失败 ${e.category}: ${e.path}`);
    fail(`存在 ${errors.length} 个读取失败的输入；不假报覆盖`);
  }

  const expectedInventory = norm(await formatDoc(buildInventory(paths, contents)));
  const trackerDiskRaw = readFileSync(`${DIR}/implementation-tracker.md`, "utf8");
  const expectedTracker = norm(await formatDoc(buildTracker(plan, parseTrackerRows(trackerDiskRaw))));

  const inventoryDisk = norm(readFileSync(`${DIR}/inventory.md`, "utf8"));
  const trackerDisk = norm(trackerDiskRaw);

  if (inventoryDisk !== expectedInventory)
    fail("inventory.md 与生成器输出不一致；请运行 node scripts/p0-audit.mjs --update");
  if (trackerDisk !== expectedTracker)
    fail("implementation-tracker.md 与 taskId 合并结果不一致；请运行 node scripts/p0-audit.mjs --update");

  const invLines = squeezeLines(inventoryDisk);
  const missing = paths.filter((p) => !invLines.some((l) => l.startsWith(`| ${p} |`)));
  if (missing.length) fail(`清单缺少路径: ${missing.join(", ")}`);

  const rowCount = invLines.filter(
    (l) => l.startsWith("| ") && !l.startsWith("| 路径") && !/^\| -+ /.test(l),
  ).length;
  if (rowCount !== paths.length) fail(`期望 ${paths.length} 行，实际 ${rowCount} 行`);

  const trackerLines = squeezeLines(trackerDisk);
  const missingTasks = tasks.filter((t) => !trackerLines.some((l) => l.startsWith(`| ${t.id} |`)));
  if (missingTasks.length) fail(`追踪表缺少任务: ${missingTasks.map((t) => t.id).join(", ")}`);

  console.log(
    `PASS: 只读校验; ${paths.length} 个 Markdown 全覆盖; ${tasks.length} 项任务; tracker 人工字段合并一致; 无文件写入`,
  );
} catch (e) {
  fail(e && e.message ? e.message : String(e));
}
