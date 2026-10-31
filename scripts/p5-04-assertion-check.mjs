// p5-04-assertion-check.mjs —— 已实现/已验证断言的证据缺失检测（P5-04）。
// 用法（仓库根）：node scripts/p5-04-assertion-check.mjs
// 方案 P5-04：「检测已实现/已验证断言的证据缺失；实现状态无法证实的页面自动失败或警示」。
// 口径（摸底实测后收敛）：
//  A1 站点正文（learn/advanced/reference/start/guide-compat/products→cases 迁移面，
//     archive/ 已随二期清理整体下线）
//     中含「已实现/已验证/✅」能力断言的**段落**，须满足其一：
//     ① 段落内含反引号证据路径（src/test/spec 路径）——路径存在性实测（审查 MINOR-③：
//        引用不存在的路径不算证据）
//     ② 段落内含 status/frontmatter 标注或 capability-matrix 背书引用
//     ③ 段落含站内深读/课程链接（断言 → 对应课或参考库走读可复验）
//     ④ 断言为历史/规划语义（「已归档/规划中/待写/设计讨论/原 X」）
//     ⑤ 紧邻段落证据：列举式引导段（断言句）与其证据段常相邻成对（前后各看一段）
//  A2 learn implemented 页 frontmatter 由 P5-01 C2 把关（本脚本不重复）。
//  警示 vs 失败：页面聚合 ≥3 条无证据断言=FAIL（系统性缺失）；1-2 条=警示列出不阻断。
//  代码块内不检（与 P5-01 同口径）。
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DOCS_ROOT = join(REPO_ROOT, "docs");
// 检查范围：站点正文目录（archive 等旧区域已随二期清理删除）
const SCAN_DIRS = ["learn", "advanced", "reference", "start", "cases", "index.md"];
const ASSERT_RE = /已实现|已验证|✅/;
const EVIDENCE_RE =
  /`[^`]*(?:src|test|spec|examples|samples|\.ts|\.mjs|\.json)[^`]*`|spec\.ts|test\/|agent-app\/|engine\/src|apps\/(api|cli|web)|capability-matrix|examples\/\d{2}|source:\s|tests:\s/;
// 站内深读/课程链接同样是证据形态（断言 → 对应课或参考库走读可复验）；`pnpm cmd` 可运行命令声明
const EVIDENCE_LINK_RE = /\]\((?:\/learn|\/reference|\/advanced|\/start)[^)]*\)|`pnpm [a-z]/;
const HISTORICAL_RE =
  /已归档|规划中|待写|待补|设计讨论|历史|原 (?:guide|products|how-to)|迁移|占位|兼容页|不再更新|保持历史|暂无（|尚未|status: partial|status: planned/;
// 证据路径判定：后缀形或仓内前缀形
const PATH_SUFFIX_RE = /\.(ts|mjs|json|md)$/i;
const PATH_PREFIX_RE = /^(agent-app|docs|scripts)\//;
function hasRealPath(s) {
  const base = s.split("#")[0];
  return PATH_SUFFIX_RE.test(base) || PATH_PREFIX_RE.test(base);
}

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
    if (isDir) {
      if (e === "dist" || e === "cache" || e === "node_modules" || e === "archive") continue;
      walk(p, out);
    } else if (/\.md$/i.test(e)) out.push(p);
  }
  return out;
}

const targets = [];
for (const d of SCAN_DIRS) {
  const p = join(DOCS_ROOT, d);
  if (existsSync(p)) {
    if (statSync(p).isDirectory()) targets.push(...walk(p));
    else targets.push(p);
  }
}

const failures = [];
const warnings = [];
let assertionParas = 0,
  evidenced = 0,
  historical = 0;

for (const p of targets) {
  const rel = p.slice(REPO_ROOT.length + 1);
  const body = readFileSync(p, "utf8");
  // 拆 frontmatter 与正文；正文按段落（空行分隔）切，代码块剥离
  const fmEnd = body.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[0]?.length ?? 0;
  const content = body.slice(fmEnd);
  // 剥代码块
  const prose = content.replace(
    /(?:^|\r?\n)```(?:[A-Za-z]+)?[ \t]*\r?\n[\s\S]*?\r?\n```(?=\r?\n|$)/g,
    "\n\n",
  );
  const paras = prose.split(/\r?\n\s*\r?\n/);
  for (let i = 0; i < paras.length; i++) {
    const para = paras[i];
    if (!ASSERT_RE.test(para)) continue;
    assertionParas++;
    if (HISTORICAL_RE.test(para)) {
      historical++;
      continue;
    }
    if (EVIDENCE_RE.test(para) || EVIDENCE_LINK_RE.test(para)) {
      // 证据路径存在性（审查 MINOR-③）：形态匹配后验真实——引用不存在的路径不算证据
      const backtickPaths = [...para.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter(hasRealPath);
      if (
        backtickPaths.length === 0 ||
        backtickPaths.every((s) => existsSync(resolve(REPO_ROOT, s.split("#")[0])))
      ) {
        evidenced++;
        continue;
      }
      // 引用不存在的路径 → 按无证据计入（落向警示/FAIL 聚合）
    }
    // 紧邻段落证据（审查 MINOR-④）：列举式引导段（断言句）与其证据段常相邻成对
    // （如 evolution.md「① 编排器已实现」→ 下一段即 orchestrator/ 展开）——前后各看一段
    const prev = paras[i - 1] ?? "";
    const next = paras[i + 1] ?? "";
    if (
      EVIDENCE_RE.test(prev) ||
      EVIDENCE_LINK_RE.test(prev) ||
      EVIDENCE_RE.test(next) ||
      EVIDENCE_LINK_RE.test(next)
    ) {
      evidenced++;
      continue;
    }
    // 无证据能力断言 → 警示级（页面级聚合后决定 FAIL 与否）
    const firstLine = para.trim().split("\n")[0].slice(0, 70);
    warnings.push(`${rel}: 断言无证据路径 → ${firstLine}`);
  }
}

// 页面聚合：同一文件 ≥3 条无证据断言 = FAIL（系统性缺失），1-2 条 = 警示列出
const byFile = new Map();
for (const w of warnings) {
  const f = w.split(":")[0];
  byFile.set(f, (byFile.get(f) ?? 0) + 1);
}
const failedFiles = [...byFile.entries()].filter(([, n]) => n >= 3);
for (const [f, n] of failedFiles) failures.push(`A1 ${f}: ${n} 条能力断言无证据路径（页面级系统性缺失）`);

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  for (const w of warnings) console.error(`WARN ${w}`);
  console.error(`共 ${failures.length} 项失败、${warnings.length} 条警示；退出码 1`);
  process.exit(1);
}
console.log(
  `PASS: ${targets.length} 个站点页面 · ${assertionParas} 个断言段落（${evidenced} 有证据、${historical} 历史语义豁免、${warnings.length} 条单点警示列出）`,
);
for (const w of warnings) console.log(`  warn ${w}`);
