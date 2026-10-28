import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as prettier from "prettier";

export const DIR = "docs/maintainers";

export const OUTPUT_PATHS = [
  `${DIR}/inventory.md`,
  `${DIR}/implementation-tracker.md`,
  `${DIR}/baseline.md`,
  `${DIR}/implementation-plan.md`,
];

// 生成器自有产物行使用固定描述，避免自引用读取；baseline.md 为人工维护文档。
export const FIXED_OUTPUT_DOCS = {
  [`${DIR}/inventory.md`]: {
    title: "Markdown 内容清单",
    summary: "基线文档清单，记录全部 Markdown；由生成器维护，请通过 scripts/p0-audit.mjs 更新。",
  },
  [`${DIR}/implementation-tracker.md`]: {
    title: "实施任务追踪",
    summary: "记录 P0 至 P6 的原子任务；更新模式按 taskId 保留人工字段。",
  },
  [`${DIR}/baseline.md`]: {
    title: "P0-01 基线记录",
    summary: "记录仓库结构、脚本、CI 和基线验证。",
  },
  [`${DIR}/implementation-plan.md`]: {
    title: "AI Agent Blog 教学体系与 Agent App 系统重构实施方案",
    summary: "实施方案归档副本，作为任务清单来源。",
  },
};

export function listTrackedMarkdown() {
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  return [...new Set([...tracked.filter((p) => /\.md$/i.test(p)), ...OUTPUT_PATHS])].sort();
}

// 读取全部真实输入（生成器自有产物行不依赖读取）。任何读取失败都记录路径与错误类别。
export function readTrackedInputs(paths) {
  const contents = new Map();
  const errors = [];
  for (const p of paths) {
    if (FIXED_OUTPUT_DOCS[p]) continue;
    try {
      contents.set(p, readFileSync(p, "utf8"));
    } catch (e) {
      errors.push({ path: p, category: e.code || "UNKNOWN" });
    }
  }
  return { contents, errors };
}

function typeOf(p) {
  if (p.startsWith("docs/archive/")) return "历史课程";
  if (p.startsWith("docs/guide/")) return "Guide";
  if (p.startsWith("docs/reference/")) return "Reference";
  if (p.startsWith("docs/products/")) return "Products";
  if (p.startsWith("docs/how-to/")) return "How-to";
  if (p.startsWith("agent-app/docs/personal-agent/")) return "内部个人代理规划";
  if (p.startsWith("agent-app/.agent-skills/")) return "内部技能";
  if (p.startsWith("agent-app/")) return "工程内部文档";
  if (p.startsWith("docs/maintainers/")) return "维护文档";
  if (p.startsWith("docs/")) return "站点文档";
  return "仓库文档";
}

const escapeCell = (s) =>
  String(s)
    .replace(/\r?\n/g, " ")
    .trim()
    .replace(/[&<>\[\]()*_`|{}]/g, (c) => `&#${c.charCodeAt(0)};`);
export const cell = escapeCell;

// 提取标题：frontmatter title 优先，其次正文一级标题，否则如实标注未标注。
export function describe(path, contents) {
  const fixed = FIXED_OUTPUT_DOCS[path];
  const text = fixed ? `# ${fixed.title}\n\n${fixed.summary}` : contents.get(path);
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  const fm = match ? match[1] : null;
  const body = match ? text.slice(match[0].length) : text;
  const fmTitle = fm
    ?.match(/^title:[ \t]*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^["'](.*)["']$/, "$1");
  const h1 = body.match(/^#[ \t]+(.+)$/m)?.[1]?.trim();
  const title = fmTitle || h1 || "(未标注标题)";
  const summary =
    body
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(
        (s) =>
          s &&
          !/^(#|>|\||```|[-*][ \t]|<|---$|flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|pie|mindmap)/.test(
            s,
          ),
      ) || "(无普通正文段落)";
  return { fm, title, summary };
}

export function buildInventory(paths, contents) {
  let out = "# Markdown 内容清单\n\n";
  out +=
    "基线 `8c8c0fc4789988973e16c8ed565223321634bd9c`。生成命令：`node scripts/p0-audit.mjs --init <实施方案路径>` 为显式全量重建；`--update` 重新生成清单并按 taskId 保留追踪表人工字段；`node scripts/p0-check.mjs` 只读校验，不写任何文件。分类仅按路径，不代表内容现状。摘要为原文首个正文段落摘录；frontmatter 为原文，不推断实现状态。全部重复/过时、迁移目标和旧 URL 处置待 P0-02 核实。包含本任务新增文档。\n\n";
  out += "| 路径 | 标题 | 类型 | frontmatter | 内容摘录 | 迁移/重复/旧 URL |\n";
  out += "| --- | --- | --- | --- | --- | --- |\n";
  for (const p of paths) {
    const d = describe(p, contents);
    out += `| ${cell(p)} | ${cell(d.title)} | ${typeOf(p)} | ${d.fm ? cell(d.fm) : "无"} | ${cell(d.summary.slice(0, 180))} | 待 P0-02 |\n`;
  }
  return out;
}

export function parseTasks(plan) {
  const tasks = [...plan.matchAll(/^- (P[0-6]-\d\d) (.+)$/gm)].map((m) => ({
    id: m[1],
    desc: m[2].trim(),
  }));
  if (tasks.length !== 35) throw new Error(`Expected 35 tasks, got ${tasks.length}`);
  return tasks;
}

const rowLine = (cells) => `| ${cells.join(" | ")} |\n`;

// 解析现有追踪表数据行（taskId 为第一列）；保留原单元格内容以保住人工字段。
// 单元格切分须识别 `\|` 转义（buildTracker 的 esc 会写入转义管道符），否则 round-trip 错列。
export function splitUnescaped(line, sep) {
  const cells = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === sep) {
      cur += line[++i];
      continue;
    }
    if (line[i] === sep) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += line[i];
  }
  cells.push(cur.trim());
  return cells;
}

export function parseTrackerRows(text) {
  const rows = new Map();
  const order = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trimStart().startsWith("|")) continue;
    const line = raw.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells = splitUnescaped(line, "|");
    const id = cells[0];
    if (!/^P[0-6]-\d\d$/.test(id)) continue;
    if (!rows.has(id)) order.push(id);
    // 约定与旧实现一致：存含 taskId 的完整单元格（首个为 id），buildTracker 直接 rowLine。
    rows.set(id, cells);
  }
  return { rows, order };
}

// existing 为 null 时输出全新模板（仅限显式 init 入口）；否则保留已有行原样，仅追加缺失任务。
export function buildTracker(plan, existing) {
  const tasks = parseTasks(plan);
  const esc = (s) => String(s).replace(/\|/g, "\\|");
  let out = "# 实施任务追踪\n\n";
  out +=
    "来源：`implementation-plan.md` §5–6。模板初始化（`--init`）与后续更新（`--update`）分离：更新按 taskId 保留人工字段，仅追加缺失任务行；`node scripts/p0-check.mjs` 只读校验，绝不写文件。依赖为顺序调度约束：前一任务须 verified；P4 可按 ADR 不拆包。状态以实际证据更新；已验证/implemented 断言须有证据。\n\n";
  out +=
    "| taskId | state | scope / 验收 | 依赖 | baseSHA | branch | commits | PR | checks | review | rollback | docs | evidence |\n";
  out += "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n";
  const rows = existing?.rows ?? new Map();
  const order = existing?.order ?? [];
  const emitted = new Set();
  for (const id of order) {
    if (!tasks.some((t) => t.id === id)) continue;
    out += rowLine(rows.get(id));
    emitted.add(id);
  }
  tasks.forEach((t, i) => {
    if (emitted.has(t.id)) return;
    const phase = t.id.slice(0, 2);
    const section = plan.match(new RegExp(`### ${phase}｜[\\s\\S]*?(?=\\n### P[0-6]｜|\\n---)`))?.[0] || "";
    const acceptance = section.match(/\*\*验收：\*\* ([^\n]+)/)?.[1] || "见实施方案对应阶段验收";
    out += rowLine([
      t.id,
      "todo",
      `${esc(t.desc)}；阶段验收：${esc(acceptance)}`,
      i ? `${tasks[i - 1].id} verified` : "无",
      "待记录",
      "待创建",
      "待记录",
      "待创建",
      "待验证",
      "待独立审查",
      "revert 本任务合并提交",
      "待记录",
      "待记录",
    ]);
  });
  return out;
}

// 与仓库 .prettierrc 一致的规范格式，保证提交钩子 Prettier 后内容不变。
export async function formatDoc(text) {
  const config = (await prettier.resolveConfig()) || {};
  return prettier.format(text, { ...config, parser: "markdown" });
}
