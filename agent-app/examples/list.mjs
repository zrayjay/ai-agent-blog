// examples/list.mjs —— 示例清单与统一校验（P2-01 运行器）。
// 用法（agent-app 根）：pnpm examples:list / pnpm examples:check
// 规则（examples/README.md）：每个 NN-<slug>/ 必须含 README.md、src/main.ts、
// src/main.spec.ts；README 须含对应课链接（docs/learn/…）与离线路径声明。
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENTRIES = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^\d{2}-/.test(e.name))
  .map((e) => e.name)
  .sort();

function checkStructure(dir) {
  const problems = [];
  const dirPath = join(ROOT, dir);
  const readmePath = join(dirPath, "README.md");
  for (const f of ["README.md", join("src", "main.ts"), join("src", "main.spec.ts")]) {
    if (!existsSync(join(dirPath, f))) problems.push(`缺少 ${f}`);
  }
  if (!existsSync(readmePath)) return { problems, readme: "", lesson: "(缺少 README)" };

  const readme = readFileSync(readmePath, "utf8");
  const lessonLink = readme.match(/\]\(([^)#]*docs\/learn\/[^)#]+\.md)\)/)?.[1];
  if (!lessonLink) {
    problems.push("README 缺少对应课链接（…/docs/learn/….md）");
  } else if (!existsSync(resolve(dirPath, lessonLink))) {
    problems.push(`对应课链接目标不存在: ${lessonLink}`);
  }
  if (!/^## 前置$/m.test(readme)) problems.push("README 缺少「## 前置」章节");
  if (!/命令与预期输出/.test(readme)) problems.push("README 缺少命令与预期输出章节");
  if (!/对应源码/.test(readme)) problems.push("README 缺少对应源码说明");
  if (!/离线|offline/i.test(readme)) problems.push("README 未声明离线路径");
  return { problems, readme, lesson: lessonLink ?? "(未标注)" };
}

const list = ENTRIES.map((dir) => ({ dir, ...checkStructure(dir) }));

console.log(`共 ${ENTRIES.length} 个示例：`);
for (const { dir, problems, lesson } of list) {
  console.log(`  ${dir}  → ${lesson}${problems.length ? "  [结构问题: " + problems.join("; ") + "]" : ""}`);
}

if (process.argv[2] === "--check") {
  const failures = list.flatMap(({ dir, problems }) => problems.map((p) => `${dir}: ${p}`));
  if (failures.length) {
    for (const f of failures) console.error(`FAIL ${f}`);
    process.exit(1);
  }
  // spec 离线测试走本包 vitest（node_modules 上下文即本包，ai/test 与引擎测试同缝）
  try {
    execFileSync("pnpm", ["--filter", "@agent-app/examples", "test"], {
      stdio: "inherit",
      cwd: join(ROOT, ".."),
      // Windows 下 pnpm 是 .cmd，spawnSync 默认不走 PATHEXT 解析
      shell: process.platform === "win32",
    });
    console.log(`PASS: ${ENTRIES.length} 个示例结构完整，spec 全部通过`);
  } catch {
    process.exit(1);
  }
}
