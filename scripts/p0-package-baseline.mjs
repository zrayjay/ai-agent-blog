import { readFileSync } from "node:fs";
const files = [
  "package.json",
  "agent-app/package.json",
  ...["api", "cli", "web"].map((x) => `agent-app/apps/${x}/package.json`),
  ...["engine", "shared"].map((x) => `agent-app/packages/${x}/package.json`),
];
for (const file of files) {
  const p = JSON.parse(readFileSync(file, "utf8"));
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
