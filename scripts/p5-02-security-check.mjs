// p5-02-security-check.mjs —— 敏感信息扫描 + 命令有效性抽样（P5-02）。
// 用法（仓库根）：node scripts/p5-02-security-check.mjs
// 与 P5-01 docs:check 分工：docs:check 管文档结构与链接；本脚本管：
//  S1 密钥样式扫描（仓库全部 git 跟踪文本文件，排除已知脱敏测试夹具白名单）
//  S2 命令有效性抽样（docs/learn 课程代码块中的 pnpm 命令：脚本名必须存在于
//     根 package.json 或 agent-app/package.json 的 scripts——P3-02「pnpm team
//     失实命令」教训的机械化守护）
// 示例可运行性由既有 examples:check 覆盖（7 示例 22 spec 离线全跑），不重复建设。
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const failures = [];

// ── S1：密钥样式扫描 ──
const trackedFiles = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1e8 })
  .split("\n")
  .filter((f) => f && /\.(ts|tsx|mjs|mts|js|json|md|yml|yaml|env|txt|toml)$/i.test(f));

// 白名单：脱敏测试夹具（测试「sink 不泄漏」行为本身的假密钥）与文档占位符。
// 新增夹具须同步此表并在夹具处注释指向（见 security-chain.spec.ts SECRET）。
const SECRET_ALLOWLIST = new Set([
  "agent-app/packages/engine/test/security-chain.spec.ts",
  // telemetry.spec 的 sk-proj-… 同为脱敏测试夹具（测 redactEvent 对现代
  // sk-proj 格式的脱敏），非泄漏。新增强化模式后命中，纳入同一白名单口径。
  "agent-app/packages/engine/test/telemetry.spec.ts",
]);

const SECRET_PATTERNS = [
  // sk- 后字符类含 _-：2024 起主流 sk-proj-/sk-svcacct- 格式含连字符，
  // 旧式 [A-Za-z0-9]{20,} 在 "proj" 后即断、整串漏报（审查复现）。
  [/sk-[A-Za-z0-9][A-Za-z0-9_-]{19,}/, "OpenAI 风格密钥"],
  [/ghp_[A-Za-z0-9]{30,}/, "GitHub PAT"],
  [/github_pat_[A-Za-z0-9_]{50,}/, "GitHub fine-grained PAT"],
  [/AKIA[0-9A-Z]{16}/, "AWS Access Key"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "私钥块"],
];

let scanned = 0;
for (const f of trackedFiles) {
  if (SECRET_ALLOWLIST.has(f.replace(/\\/g, "/"))) continue;
  let body;
  try {
    body = readFileSync(join(REPO_ROOT, f), "utf8");
  } catch {
    continue; // 二进制/编码异常跳过
  }
  scanned++;
  for (const [re, label] of SECRET_PATTERNS) {
    const m = body.match(re);
    if (m) failures.push(`S1 ${f}: 疑似${label} ${m[0].slice(0, 12)}…`);
  }
}

// ── S2：命令有效性抽样（docs/learn 课程代码块中的 pnpm 命令）──
const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
const agentPkg = JSON.parse(readFileSync(join(REPO_ROOT, "agent-app", "package.json"), "utf8"));
const validScripts = new Set([
  ...Object.keys(rootPkg.scripts ?? {}),
  ...Object.keys(agentPkg.scripts ?? {}),
  // pnpm 内建与包管理器直呼（非 scripts 但永远有效）。
  // 不收 dev/lint/test：两根 package.json 均无同名 script，bare 调用跑不通——
  // 放行即失实命令（P3-02 同类问题），课程若用需先在 package.json 加 script。
  "pnpm",
  "npm",
  "npx",
  "node",
  "install",
  "add",
  "remove",
  "exec",
  "dlx",
  "-C",
  "--dir",
  "--filter",
  "build",
  "typecheck",
]);

const LEARN = join(REPO_ROOT, "docs", "learn");
// workspace 包名 → 包 scripts 集（--filter <pkg> <script> 校验用）
const workspaceScripts = new Map();
for (const pkgPath of [
  "apps/web",
  "apps/api",
  "apps/cli",
  "packages/engine",
  "packages/shared",
  "examples",
]) {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "agent-app", pkgPath, "package.json"), "utf8"));
    workspaceScripts.set(pkg.name ?? pkgPath, new Set(Object.keys(pkg.scripts ?? {})));
  } catch {
    // 包不存在跳过
  }
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
    else if (/\.md$/i.test(e) && !e.endsWith("index.md")) out.push(p);
  }
  return out;
}

const lessonFiles = walkMd(LEARN);
let cmdTotal = 0,
  cmdSampled = 0;
for (const p of lessonFiles) {
  const rel = p.slice(REPO_ROOT.length + 1);
  const body = readFileSync(p, "utf8");
  // 围栏必须行首锚定：``` 同时是围栏开/闭与行内代码字符，无锚定的懒惰匹配会把
  // 「上一块的闭合」当成「下一块的开启」（CRLF 语料实测吞块，powershell 命令块丢失）。
  // 开启端 (^|\n)```[lang]，闭合端 (\n)```(+行尾前瞻)。
  const blocks = [...body.matchAll(/(?:^|\r?\n)```(?:[A-Za-z]+)?[ \t]*\r?\n([\s\S]*?)\r?\n```(?=\r?\n|$)/g)];
  for (const [, block] of blocks) {
    for (const line of block.split("\n")) {
      const trimmed = line
        .trim()
        .replace(/^PS>\s*/, "")
        .replace(/^\$\s*/, "");
      if (!trimmed.startsWith("pnpm ")) continue;
      cmdTotal++;
      // 抽样口径：以 pnpm 开头的命令行,首 token 为脚本名或内建
      const rest = trimmed.slice(5).trim();
      const firstTok = rest.split(/\s+/)[0];
      if (!firstTok) continue;
      cmdSampled++;
      // pnpm <script> / pnpm -C x <script> / pnpm --filter y <script> / pnpm cli ...
      let scriptTok = firstTok;
      // --filter <pkg> <script>：走 workspace 包 scripts 校验（独立分支，不落入 -C 泛化）。
      // bypass 表仅收真正的 pnpm 内建子命令（install/add/remove/exec/run）；dev/test 等
      // 包级 script 不豁免——对包 scripts 精确校验（审查 NOTE-1：包存在性检查不得被短路）。
      if (scriptTok === "--filter") {
        const toks = rest.split(/\s+/);
        const pkgTok = toks[1];
        const sub = toks[2];
        if (!sub || ["install", "add", "remove", "exec", "run"].includes(sub)) continue;
        const pkgScripts = workspaceScripts.get(pkgTok);
        if (!pkgScripts) {
          failures.push(`S2 ${rel}: --filter 目标包不存在 ${pkgTok}`);
        } else if (!pkgScripts.has(sub)) {
          failures.push(`S2 ${rel}: 包 ${pkgTok} 无 script「${sub}」`);
        }
        continue;
      }
      if (scriptTok === "-C" || scriptTok === "--dir") {
        // 跳过参数值取下一个 token
        const toks = rest.split(/\s+/);
        const idx = toks.findIndex(
          (t, i) =>
            i > 0 &&
            !t.startsWith("-") &&
            toks[i - 1] !== "-C" &&
            toks[i - 1] !== "--dir" &&
            toks[i - 1] !== "--filter",
        );
        scriptTok = toks[idx] ?? "";
      }
      if (!scriptTok) continue;
      if (scriptTok === "run") {
        // pnpm run <script>：<script> 与直呼同口径校验（不豁免，防 run 绕过）
        const after = rest.split(/\s+/)[1];
        if (after && !validScripts.has(after)) {
          failures.push(`S2 ${rel}: 未知 pnpm 命令「pnpm run ${after}」（不在根/agent-app scripts）`);
        }
        continue;
      }
      if (!validScripts.has(scriptTok)) {
        failures.push(
          `S2 ${rel}: 未知 pnpm 命令「pnpm ${rest.split(/\s+/).slice(0, 3).join(" ")}」（不在根/agent-app scripts）`,
        );
      }
    }
  }
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`共 ${failures.length} 项失败；退出码 1`);
  process.exit(1);
}
console.log(
  `PASS: ${scanned} 个跟踪文件无密钥样式泄漏（白名单 ${SECRET_ALLOWLIST.size} 项脱敏夹具）、` +
    `learn ${lessonFiles.length} 课代码块抽样 ${cmdSampled}/${cmdTotal} 条 pnpm 命令全部有效`,
);
