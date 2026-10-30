// p5-05-site-check.mjs —— 站点构建产物回归检查（P5-05）。
// 用法（仓库根）：先 pnpm docs:build，再 node scripts/p5-05-site-check.mjs
// 方案 P5-05：「检查站点页面的桌面/移动端导航、搜索、深链接、样式不回归」。
// 口径：基于 dist 构建产物离线检查（零浏览器依赖；桌面/移动端交互属运行时行为，
// 离线口径=响应式基础件在位：viewport meta + 主题 CSS + 侧边栏导航数据完整；
// 真机浏览验证归 P6-04 人工审阅）：
//  R1 页面完整性：docs/**.md 的每个页面在 dist 有对应 html（含 index 回退）
//  R2 深链接：sidebar 配置的每个 link 在 dist 解析到 html（导航可达性，双端共用数据）
//  R3 搜索：local search 索引工件在位（hashmap.json + 搜索 chunk）
//  R4 样式/资源：html 引用的 assets/css/js 相对路径存在 + viewport meta 在位（响应式基础件）
//  R5 404 兜底页在位
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DIST = join(REPO_ROOT, "docs", ".vitepress", "dist");
const DOCS = join(REPO_ROOT, "docs");
const SIDEBAR_DIR = join(DOCS, ".vitepress", "sidebar");
const failures = [];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let isDir;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walk(p, out);
    else out.push(p);
  }
  return out;
}

function walkMd(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let isDir;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walkMd(p, out);
    else if (/\.md$/i.test(e)) out.push(p);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error("FAIL dist/ 不存在——先跑 pnpm docs:build");
  process.exit(1);
}
const all = walk(DIST);
const htmlSet = new Set(all.filter((f) => f.endsWith(".html")));
const fileSet = new Set(all);

// ── R1：每 md → dist html ──
const mdFiles = walkMd(DOCS).filter((p) => !p.includes(join(".vitepress")));
let r1Count = 0;
for (const md of mdFiles) {
  const relToDocs = relative(DOCS, md).replace(/\\/g, "/").replace(/\.md$/i, "");
  const distBase = join(DIST, relToDocs);
  const ok =
    existsSync(distBase + ".html") ||
    existsSync(join(distBase, "index.html")) ||
    (relToDocs === "index" && existsSync(join(DIST, "index.html")));
  r1Count++;
  if (!ok) failures.push(`R1 ${relToDocs}.md → dist 无对应 html`);
}

// ── R2：sidebar link → dist html（导航可达性）──
const sidebarFiles = readdirSync(SIDEBAR_DIR).filter((e) => /\.mts$/.test(e));
let navCount = 0;
function distHasPage(link) {
  const clean = link.replace(/\/$/, "").replace(/^\//, "");
  if (!clean) return htmlSet.has(join(DIST, "index.html"));
  return htmlSet.has(join(DIST, clean + ".html")) || htmlSet.has(join(DIST, clean, "index.html"));
}
for (const sf of sidebarFiles) {
  const body = readFileSync(join(SIDEBAR_DIR, sf), "utf8");
  for (const m of body.matchAll(/link: '([^']+)'/g)) {
    navCount++;
    const link = m[1];
    if (/^(https?:|mailto:)/.test(link)) continue;
    if (!distHasPage(link)) failures.push(`R2 导航断页 → ${link}（sidebar/${sf}）`);
  }
}

// ── R3：搜索工件 ──
const hasHashmap = fileSet.has(join(DIST, "hashmap.json"));
const searchChunks = all.filter((f) => /@localSearchIndex|search/i.test(f.split(/[\\/]/).pop()));
if (!hasHashmap) failures.push("R3 local search 索引 hashmap.json 缺失");
if (searchChunks.length === 0) failures.push("R3 搜索 chunk 缺失（localSearchIndex）");

// ── R4：样式/资源引用 + viewport（响应式基础件）──
const htmls = all.filter((f) => f.endsWith(".html"));
let cssTotal = 0,
  viewportOk = 0,
  assetChecked = 0;
for (const html of htmls) {
  const body = readFileSync(html, "utf8");
  if (body.includes('name="viewport"')) viewportOk++;
  // 抽样校验资源引用（每页的 css/js 相对链接）
  for (const m of body.matchAll(/(?:src|href)="([^"]+\.(?:css|js))"/g)) {
    const href = m[1];
    if (/^https?:/.test(href)) continue;
    assetChecked++;
    const target = href.startsWith("/")
      ? join(DIST, decodeURIComponent(href.slice(1)).split("#")[0])
      : resolve(dirname(html), decodeURIComponent(href.split("#")[0]));
    if (!fileSet.has(target)) {
      failures.push(`R4 资源缺失 ${relative(DIST, html)} → ${href}`);
      if (failures.length > 20) break;
    }
  }
  cssTotal++;
  if (failures.length > 20) break;
}
const themeCss = all.filter((f) => f.endsWith(".css") && f.includes("assets"));
if (themeCss.length === 0) failures.push("R4 主题 CSS 缺失（样式回归基础件）");
const viewportRatio = htmls.length ? viewportOk / htmls.length : 0;
if (viewportRatio < 1) failures.push(`R4 viewport meta 覆盖不全：${viewportOk}/${htmls.length}`);

// ── R5：404 兜底 ──
if (!htmlSet.has(join(DIST, "404.html"))) failures.push("R5 404.html 缺失");

if (failures.length) {
  for (const f of failures.slice(0, 25)) console.error(`FAIL ${f}`);
  console.error(`共 ${failures.length} 项失败；退出码 1`);
  process.exit(1);
}
console.log(
  `PASS: ${r1Count} md→html 全对应、${navCount} 条导航链接可达、搜索工件在位（hashmap+${searchChunks.length} chunk）、` +
    `${cssTotal} 页 viewport/资源引用全通过（抽样 ${assetChecked} 条）、404 兜底在位`,
);
