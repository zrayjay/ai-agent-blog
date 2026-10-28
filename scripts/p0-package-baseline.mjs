import { readFileSync } from "node:fs";
const files = [
  "package.json",
  "agent-app/package.json",
  ...["api", "cli", "web"].map((x) => `agent-app/apps/${x}/package.json`),
  ...["engine", "shared"].map((x) => `agent-app/packages/${x}/package.json`),
];
for (const file of files) {
  let p;
  try {
    p = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`SKIP ${file}: ${e && e.code ? e.code : e && e.message ? e.message : String(e)}`);
    continue;
  }
  console.log(
    JSON.stringify(
      {
        file,
        name: p.name,
        version: p.version,
        packageManager: p.packageManager,
        scripts: p.scripts,
        exports: p.exports,
        dependencies: p.dependencies,
        devDependencies: p.devDependencies,
        peerDependencies: p.peerDependencies,
      },
      null,
      2,
    ),
  );
}
