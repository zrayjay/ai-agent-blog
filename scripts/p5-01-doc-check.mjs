// p5-01-doc-check.mjs —— 课程 metadata 校验 + 引用文件存在性 + 导航/内部链接检查（P5-01）。
// 用法（仓库根）：node scripts/p5-01-doc-check.mjs
// 与 p2-05-matrix.mjs 分工：matrix 管「课↔示例↔源码↔测试」映射与本仓引用存在性（R1-R7）；
// 本脚本补三块 matrix 未覆盖的：
//  C1 lesson 必填字段完整性（type/lessonId/stage/order/status/prerequisites/lastVerifiedCommit 语义）
//  C2 status-证据红线（implemented 缺 source/tests/lvc = FAIL；planned 正文含「已实现/跑起来」= FAIL）
//  C3 站内链接存在性（docs/**/*.md 的相对链接与绝对站内链接 /xxx → docs 树内 .md；导航 sidebar 配置 link → 同口径）
// 外部链接（http/https/mailto）跳过（P5-03 CI Job 口径一致）。
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, posix } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DOCS_ROOT = join(REPO_ROOT, "docs");
const SIDEBAR_DIR = join(DOCS_ROOT, ".vitepress", "sidebar");
const STAGES = new Set([
  "01-foundations",
  "02-runtime",
  "03-capabilities",
  "04-orchestration",
  "05-quality",
  "06-fullstack",
  "07-applications",
]);
const STATUSES = new Set(["implemented", "partial", "planned"]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (e === "dist" || e === "cache" || e === "node_modules") continue;
      walk(p, out);
    } else if (/\.md$/i.test(e)) out.push(p);
  }
  return out;
}

const failures = [];
const pendingPrereqs = []; // {rel, ref} —— 循环结束后对 lessonIds 校验（支持前向引用）
const mdFiles = walk(DOCS_ROOT);

// ── C1/C2：lesson frontmatter 完整性与状态-证据红线 ──
const lessonFiles = mdFiles.filter((p) => p.includes(join("docs", "learn")) && !p.endsWith("index.md"));
const lessonIds = new Map();
for (const p of lessonFiles) {
  const rel = p.slice(REPO_ROOT.length + 1);
  const body = readFileSync(p, "utf8");
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (!fm) {
    failures.push(`C1 ${rel}: 无 frontmatter（learn/ 非索引页必须为 lesson）`);
    continue;
  }
  const get = (k) => fm.match(new RegExp(`^${k}: (.+)$`, "m"))?.[1];
  const type = get("type");
  if (type === "stage-index") continue; // 索引页由 matrix/maintainers 管辖
  const lessonId = get("lessonId");
  const stage = get("stage");
  const status = get("status");
  const order = get("order");

  if (type !== "lesson") failures.push(`C1 ${rel}: type=${type ?? "缺失"}（learn/ 非索引页应为 lesson）`);
  if (!lessonId) failures.push(`C1 ${rel}: 缺 lessonId`);
  else if (lessonIds.has(lessonId))
    failures.push(`C1 ${rel}: lessonId 重复 ${lessonId}（他处 ${lessonIds.get(lessonId)}）`);
  else lessonIds.set(lessonId, rel);
  if (!stage || !STAGES.has(stage)) failures.push(`C1 ${rel}: stage 非法 ${stage}`);
  else if (!p.replace(/\\/g, "/").includes(`/learn/${stage}/`))
    failures.push(`C1 ${rel}: stage(${stage}) 与目录不一致`);
  if (!STATUSES.has(status ?? "")) failures.push(`C1 ${rel}: status 非法 ${status}`);
  if (!order || !/^\d+$/.test(order)) failures.push(`C1 ${rel}: order 缺失或非整数 ${order}`);

  // prerequisites 引用有效性：收集到 pendingPrereqs，lessonFiles 循环结束后二次校验
  // （单 pass 时 lessonIds 未填满，直接查会漏前向引用）
  const prereqBlock = fm.match(/^prerequisites:\r?\n((?:  - .+\r?\n?)+)/m)?.[1];
  if (prereqBlock) {
    for (const m of prereqBlock.matchAll(/- (.+)/g)) {
      const ref = m[1].trim();
      pendingPrereqs.push({ rel, ref });
    }
  } else if (!/^prerequisites: (\[\]|\[\s*\])\s*$/m.test(fm) && !/^prerequisites:/m.test(fm)) {
    failures.push(`C1 ${rel}: 缺 prerequisites（空列表写 prerequisites: []）`);
  }

  // C2 红线：implemented 缺证据；planned 出现可运行暗示
  const hasList = (k) => new RegExp(`^${k}:\\r?\\n((?:  - .+\\r?\\n?)+)`, "m").test(fm);
  const lvc = get("lastVerifiedCommit");
  if (status === "implemented") {
    if (!hasList("source")) failures.push(`C2 ${rel}: implemented 缺 source 列表`);
    if (!hasList("tests")) failures.push(`C2 ${rel}: implemented 缺 tests 列表`);
    if (!lvc) failures.push(`C2 ${rel}: implemented 缺 lastVerifiedCommit`);
  }
  if (status === "planned") {
    const content = body.slice(body.indexOf("---", 4));
    if (/跑起来|已实现|生产可用/.test(content))
      failures.push(`C2 ${rel}: planned 正文含「跑起来/已实现/生产可用」暗示（红线）`);
  }
}

// prerequisites 二次校验（lessonIds 已填满）
for (const { rel, ref } of pendingPrereqs) {
  if (!lessonIds.has(ref)) failures.push(`C1 ${rel}: prerequisites 引用不存在的 lessonId ${ref}`);
}

// ── C3：站内链接存在性 ──
// 站内 .md 相对链接（含锚点剥离）；绝对站内链接 /xxx 按 VitePress cleanUrl 规则映射 docs/xxx(.md|/index.md)
function decodeSafe(h) {
  try {
    return decodeURIComponent(h);
  } catch {
    return null; // 裸 % 等畸形编码 → 调用方按断链报告
  }
}

function targetExists(fromFile, href) {
  if (/^(https?:|mailto:|#)/.test(href)) return true; // 外部/锚点跳过
  let h = href.split("#")[0];
  if (!h) return true;
  const decoded = decodeSafe(h);
  if (decoded === null) return false;
  h = decoded;
  if (h.startsWith("/")) {
    // VitePress 站内绝对路径 → docs 树（目录 → index.md）
    const rel = h.replace(/^\//, "");
    return (
      existsSync(join(DOCS_ROOT, rel + ".md")) ||
      existsSync(join(DOCS_ROOT, rel, "index.md")) ||
      existsSync(join(DOCS_ROOT, rel))
    );
  }
  const abs = resolve(dirname(fromFile), h);
  if (existsSync(abs)) return true;
  // 相对链接省略 .md 的情形（VitePress 允许）
  return existsSync(abs + ".md") || existsSync(join(abs, "index.md"));
}

let linkCount = 0;
for (const p of mdFiles) {
  const body = readFileSync(p, "utf8");
  // 剥离代码块（``` 围栏）与行内代码（`…`）——避免把示例代码/正则字面量当链接（P0-02 已知误报口径）
  const prose = body.replace(/^```[\s\S]*?^```/gm, "").replace(/`[^`\n]*`/g, "");
  for (const m of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = m[1];
    linkCount++;
    if (!targetExists(p, href)) {
      failures.push(`C3 ${p.slice(REPO_ROOT.length + 1)}: 断链 → ${href}`);
    }
  }
}

// sidebar 配置的 link 同口径校验（.mts 内 link: '/xxx'；walk 只收 .md 故直接列目录）
const sidebarFiles = readdirSync(SIDEBAR_DIR)
  .filter((e) => /\.mts$/.test(e))
  .map((e) => join(SIDEBAR_DIR, e));
let navCount = 0;
for (const p of sidebarFiles) {
  const body = readFileSync(p, "utf8");
  for (const m of body.matchAll(/link: '([^']+)'/g)) {
    const href = m[1];
    navCount++;
    if (!targetExists(p, href)) {
      failures.push(`C3-nav ${p.slice(REPO_ROOT.length + 1)}: 导航断链 → ${href}`);
    }
  }
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`共 ${failures.length} 项失败；退出码 1`);
  process.exit(1);
}
console.log(
  `PASS: ${lessonFiles.length} 个 learn 页面 schema/红线合规、` +
    `${linkCount} 条正文站内链接 + ${navCount} 条导航链接全部可达`,
);
