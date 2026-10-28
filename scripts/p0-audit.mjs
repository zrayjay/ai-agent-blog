import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// Run from repository root. The plan argument is required on initial generation;
// subsequent runs use the archived copy. Only tracked files plus our outputs are read.
const dir = "docs/maintainers";
const planPath = process.argv[2] || `${dir}/implementation-plan.md`;
const plan = readFileSync(planPath, "utf8");
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/implementation-plan.md`, plan);
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const outputs = [
  `${dir}/inventory.md`,
  `${dir}/implementation-tracker.md`,
  `${dir}/baseline.md`,
  `${dir}/implementation-plan.md`,
];
const paths = [...new Set([...tracked.filter((p) => /\.md$/i.test(p)), ...outputs])].sort();
const cell = (s) =>
  String(s)
    .replace(/\r?\n/g, " ")
    .trim()
    .replace(/[&<>\[\]()*_`|{}]/g, (c) => `&#${c.charCodeAt(0)};`);
const type = (p) =>
  p.startsWith("docs/archive/")
    ? "历史课程"
    : p.startsWith("docs/guide/")
      ? "Guide"
      : p.startsWith("docs/reference/")
        ? "Reference"
        : p.startsWith("docs/products/")
          ? "Products"
          : p.startsWith("docs/how-to/")
            ? "How-to"
            : p.startsWith("agent-app/docs/personal-agent/")
              ? "内部个人代理规划"
              : p.startsWith("agent-app/.agent-skills/")
                ? "内部技能"
                : p.startsWith("agent-app/")
                  ? "工程内部文档"
                  : p.startsWith("docs/maintainers/")
                    ? "维护文档"
                    : p.startsWith("docs/")
                      ? "站点文档"
                      : "仓库文档";
let inventory =
  "# Markdown 内容清单\n\n基线 `8c8c0fc4789988973e16c8ed565223321634bd9c`；由 `node scripts/p0-audit.mjs` 生成。分类仅按路径，不代表内容现状。摘要为原文首个正文段落摘录；frontmatter 为原文，不推断实现状态。全部重复/过时、迁移目标和旧 URL 处置待 P0-02 核实。包含本任务新增文档。\n\n| 路径 | 标题 | 类型 | frontmatter | 内容摘录 | 迁移/重复/旧 URL |\n| --- | --- | --- | --- | --- | --- |\n";
for (const p of paths) {
  let text;
  try {
    text = readFileSync(p, "utf8");
  } catch {
    text = "";
  }
  if (p === `${dir}/inventory.md`) text = "# Markdown 内容清单\n基线文档清单，记录全部 Markdown。";
  if (p === `${dir}/implementation-tracker.md`) text = "# 实施任务追踪\n记录 P0 至 P6 的原子任务。";
  if (p === `${dir}/baseline.md`) text = "# P0-01 基线记录\n记录仓库结构、脚本、CI 和基线验证。";
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  const body = match ? text.slice(match[0].length) : text;
  const title = body.match(/^#\s+(.+)$/m)?.[1] || "(无一级标题)";
  const summary =
    body
      .split(/\r?\n/)
      .map((x) => x.trim())
      .find((x) => x && !/^(#|>|[-*]|\||```|<|---)/.test(x)) || "(无普通正文段落)";
  inventory += `| ${cell(p)} | ${cell(title)} | ${type(p)} | ${match ? cell(match[1]) : "无"} | ${cell(summary.slice(0, 180))} | 待 P0-02 |\n`;
}
writeFileSync(`${dir}/inventory.md`, inventory);
const tasks = [...plan.matchAll(/^- (P[0-6]-\d\d) (.+)$/gm)];
if (tasks.length !== 35) throw new Error(`Expected 35 tasks, got ${tasks.length}`);
let tracker =
  "# 实施任务追踪\n\n来源：`implementation-plan.md` §5–6。依赖为顺序调度约束：前一任务须 verified；P4 可按 ADR 不拆包。验收引用各阶段计划中的验收，具体任务范围见本行。状态以实际证据更新；本次仅 P0-01 进行中。\n\n| taskId | state | scope / 验收 | 依赖 | baseSHA | branch | commits | PR | checks | review | rollback | docs | evidence |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n";
tasks.forEach(([_, id, description], i) => {
  const phase = id.slice(0, 2);
  const section = plan.match(new RegExp(`### ${phase}｜[\\s\\S]*?(?=\\n### P[0-6]｜|\\n---)`))?.[0] || "";
  const acceptance = section.match(/\*\*验收：\*\* ([^\n]+)/)?.[1] || "见实施方案对应阶段验收";
  tracker += `| ${id} | ${i ? "todo" : "in_progress"} | ${cell(description)}；阶段验收：${cell(acceptance)} | ${i ? tasks[i - 1][1] + " verified" : "无"} | ${i ? "待记录" : "8c8c0fc4789988973e16c8ed565223321634bd9c"} | ${i ? "待创建" : "refactor/p0-01-audit-baseline"} | 待记录 | 待创建 | 待验证 | 待独立审查 | revert 本任务合并提交 | ${i ? "待记录" : "docs/maintainers/"} | 待记录 |\n`;
});
writeFileSync(`${dir}/implementation-tracker.md`, tracker);
console.log(`Markdown inventory: ${paths.length}; tasks: ${tasks.length}`);
