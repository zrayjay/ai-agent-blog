// p2-05-matrix.mjs —— 课程→示例→源码→测试 映射矩阵生成与校验（P2-05）。
// 用法（agent-app 根）：pnpm matrix:check
// 校验规则（任一失败即 exit 1，逐条报告）：
//  R1 lessons：docs/learn/**/ 非 index 课的 frontmatter 必含 lessonId 与合法 status
//  R2 lessonId 全站唯一
//  R3 frontmatter example 路径必须存在
//  R4 frontmatter source/tests 路径必须存在（目录或文件，尾斜杠归一）
//  R5 examples：NN-slug/README 必含对应课链接且目标存在（复用 list.mjs 结构语义）
//  R6 examples README 引用的课文件名必须 ∈ R1 lessonId 集合（learn 文件名 = lessonId）
//  R7 lastVerifiedCommit 可解析且为 origin/main 祖先
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const AGENT_ROOT = join(REPO_ROOT, "agent-app");
const DOCS_LEARN = join(REPO_ROOT, "docs", "learn");

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
    if (st.isDirectory()) walk(p, out);
    else if (/\.md$/i.test(e) && e !== "index.md") out.push(p);
  }
  return out;
}

const failures = [];

// ── R1/R2/R3/R4/R7：lessons frontmatter ──
const lessons = walk(DOCS_LEARN).map((p) => ({
  p,
  fm: readFileSync(p, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "",
}));
const lessonIds = new Map();
for (const { p, fm } of lessons) {
  const rel = p.slice(REPO_ROOT.length + 1);
  const lessonId = fm.match(/^lessonId: (.+)$/m)?.[1];
  if (!lessonId || !fm.match(/^status: (implemented|partial|planned)$/m)) {
    failures.push(`R1 ${rel}: frontmatter 缺 lessonId 或合法 status`);
    continue;
  }
  if (lessonIds.has(lessonId))
    failures.push(`R2 lessonId 重复: ${lessonId}（${rel} 与 ${lessonIds.get(lessonId)}）`);
  else lessonIds.set(lessonId, rel);

  const example = fm.match(/^example: (.+)$/m)?.[1];
  if (example && !existsSync(resolve(REPO_ROOT, example)))
    failures.push(`R3 ${rel}: example 不存在 ${example}`);

  for (const key of ["source", "tests"]) {
    const block = fm.match(new RegExp(`^${key}:\\r?\\n((?:  - .+\\r?\\n?)+)`, "m"))?.[1] ?? "";
    for (const m of block.matchAll(/- (.+)/g)) {
      const path = m[1].trim().replace(/\/$/, "");
      if (!existsSync(resolve(REPO_ROOT, path))) failures.push(`R4 ${rel}: ${key} 不存在 ${path}`);
    }
  }
  const lvc = fm.match(/^lastVerifiedCommit: (.+)$/m)?.[1];
  if (lvc) {
    try {
      execFileSync("git", ["cat-file", "-t", lvc], { cwd: REPO_ROOT, stdio: "pipe" });
      execFileSync("git", ["merge-base", "--is-ancestor", lvc, "origin/main"], {
        cwd: REPO_ROOT,
        stdio: "pipe",
      });
    } catch {
      failures.push(`R7 ${rel}: lastVerifiedCommit 无法解析或不在 main 历史 ${lvc}`);
    }
  }
}

// ── R5/R6：examples 结构与课映射 ──
const EX = join(AGENT_ROOT, "examples");
const exampleDirs = (() => {
  try {
    return readdirSync(EX)
      .filter((e) => /^\d{2}-/.test(e) && statSync(join(EX, e)).isDirectory())
      .sort();
  } catch {
    return [];
  }
})();
for (const dir of exampleDirs) {
  const readmePath = join(EX, dir, "README.md");
  if (!existsSync(readmePath)) {
    failures.push(`R5 ${dir}: 缺 README.md`);
    continue;
  }
  const readme = readFileSync(readmePath, "utf8");
  const lessonLink = readme.match(/\]\(([^)#]*docs\/learn\/[^)#]+\.md)\)/)?.[1];
  if (!lessonLink) {
    failures.push(`R5 ${dir}: 缺对应课链接（…/docs/learn/….md）`);
    continue;
  }
  if (!existsSync(resolve(EX, dir, lessonLink)))
    failures.push(`R5 ${dir}: 对应课链接目标不存在 ${lessonLink}`);

  const target = basename(lessonLink).replace(/\.md$/, "");
  if (!lessonIds.has(target)) failures.push(`R6 ${dir}: 引用的课不在 lessonId 集合 ${target}`);
}

function basename(p) {
  const parts = p.split("/");
  return parts[parts.length - 1].replace(/\.md$/, "");
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`共 ${failures.length} 项失败；退出码 1`);
  process.exit(1);
}
console.log(
  `PASS: ${lessons.length} 课 frontmatter 合规（lessonId 唯一、example/source/tests 存在、commit 在 main）、` +
    `${exampleDirs.length} 示例结构与映射一致`,
);
