#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = join(here, "..", "dist", "index.js");
const srcEntry = join(here, "..", "src", "index.ts");

const useDist = existsSync(distEntry);
const tsxCli = join(here, "..", "node_modules/tsx/dist/cli.mjs");
if (!useDist && !existsSync(tsxCli)) {
  console.error("Build the package (npm run build) or install devDependencies (tsx).");
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [useDist ? distEntry : tsxCli, ...(useDist ? [] : [srcEntry]), ...process.argv.slice(2)],
  { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
