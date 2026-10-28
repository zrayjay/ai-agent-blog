import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const files = ["docs/maintainers/inventory.md", "docs/maintainers/implementation-tracker.md"];
const hashes = () => files.map((f) => createHash("sha256").update(readFileSync(f)).digest("hex"));
const before = hashes();
execFileSync(process.execPath, ["scripts/p0-audit.mjs"]);
if (JSON.stringify(before) !== JSON.stringify(hashes())) throw new Error("Generator is not deterministic");
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((p) => /\.md$/i.test(p));
const inventory = readFileSync(files[0], "utf8");
const outputs = [
  "docs/maintainers/inventory.md",
  "docs/maintainers/implementation-tracker.md",
  "docs/maintainers/baseline.md",
  "docs/maintainers/implementation-plan.md",
];
const expected = [...new Set([...tracked, ...outputs])];
const missing = expected.filter((p) => !inventory.includes(`| ${p} |`));
if (missing.length) throw new Error(`Missing paths: ${missing.join(", ")}`);
const rows = inventory
  .split("\n")
  .filter((s) => s.startsWith("| ") && !s.startsWith("| 路径") && !s.startsWith("| ---"));
if (rows.length !== expected.length) throw new Error(`Expected ${expected.length} rows, got ${rows.length}`);
console.log(`PASS: deterministic; ${tracked.length} tracked Markdown covered; ${rows.length} rows`);
