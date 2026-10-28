import { existsSync, readFileSync } from "node:fs";
import {
  DIR,
  OUTPUT_PATHS,
  cell,
  listTrackedMarkdown,
  readTrackedInputs,
  buildInventory,
  buildTracker,
  parseTrackerRows,
  parseTasks,
  formatDoc,
} from "./p0-audit-lib.mjs";

const norm = (s) => s.replace(/\r\n/g, "\n");
const squeezeLines = (s) =>
  norm(s)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim());

// 只读校验：不写任何文件；先聚合全部失败类别，再统一非零退出。
const failures = [];

// 1. 维护文档存在性
for (const p of OUTPUT_PATHS) {
  if (!existsSync(p)) failures.push(`缺少维护文档: ${p}`);
}

// 2. 方案与任务清单
let plan = null;
let tasks = [];
if (existsSync(`${DIR}/implementation-plan.md`)) {
  try {
    plan = readFileSync(`${DIR}/implementation-plan.md`, "utf8");
    tasks = parseTasks(plan);
  } catch (e) {
    failures.push(`实施方案任务解析失败: ${e && e.message ? e.message : String(e)}`);
    plan = null;
  }
}

// 3. tracked 输入读取
const paths = listTrackedMarkdown();
const { contents, errors } = readTrackedInputs(paths);
for (const e of errors) failures.push(`读取失败 ${e.category}: ${e.path}`);

// 4. 清单内容与格式一致性
let inventoryDisk = null;
if (!errors.length && existsSync(`${DIR}/inventory.md`)) {
  try {
    const expectedInventory = norm(await formatDoc(buildInventory(paths, contents)));
    inventoryDisk = norm(readFileSync(`${DIR}/inventory.md`, "utf8"));
    if (inventoryDisk !== expectedInventory)
      failures.push("inventory.md 与生成器输出不一致；请运行 node scripts/p0-audit.mjs --update");
  } catch (e) {
    failures.push(`清单生成校验异常: ${e && e.message ? e.message : String(e)}`);
  }
}

// 5. 追踪表内容与 taskId 合并一致性
let trackerDisk = null;
if (plan && existsSync(`${DIR}/implementation-tracker.md`)) {
  try {
    const trackerDiskRaw = readFileSync(`${DIR}/implementation-tracker.md`, "utf8");
    const expectedTracker = norm(await formatDoc(buildTracker(plan, parseTrackerRows(trackerDiskRaw))));
    trackerDisk = norm(trackerDiskRaw);
    if (trackerDisk !== expectedTracker)
      failures.push(
        "implementation-tracker.md 与 taskId 合并结果不一致；请运行 node scripts/p0-audit.mjs --update",
      );
  } catch (e) {
    failures.push(`追踪表合并校验异常: ${e && e.message ? e.message : String(e)}`);
  }
}

// 6. 覆盖与行数（不依赖具体表格行格式，空白不敏感）
if (inventoryDisk) {
  const invLines = squeezeLines(inventoryDisk);
  const missing = paths.filter((p) => !invLines.some((l) => l.startsWith(`| ${cell(p)} `)));
  if (missing.length) failures.push(`清单缺少路径: ${missing.join(", ")}`);
  const rowCount = invLines.filter(
    (l) => l.startsWith("| ") && !l.startsWith("| 路径") && !/^\| -+ /.test(l),
  ).length;
  if (rowCount !== paths.length) failures.push(`清单期望 ${paths.length} 行，实际 ${rowCount} 行`);
}

// 7. 任务行覆盖
if (trackerDisk && tasks.length) {
  const trackerLines = squeezeLines(trackerDisk);
  const missingTasks = tasks.filter((t) => !trackerLines.some((l) => l.startsWith(`| ${t.id} `)));
  if (missingTasks.length) failures.push(`追踪表缺少任务: ${missingTasks.map((t) => t.id).join(", ")}`);
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`共 ${failures.length} 类失败；退出码 1`);
  process.exit(1);
}

console.log(
  `PASS: 只读校验; ${paths.length} 个 Markdown 全覆盖; ${tasks.length} 项任务; tracker 人工字段合并一致; 无文件写入`,
);
