#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = join(here, "..", "dist", "index.js");
const srcEntry = join(here, "..", "src", "index.ts");

const useDist = existsSync(distEntry);
const command = useDist ? process.execPath : "npx";
const args = useDist
  ? [distEntry, ...process.argv.slice(2)]
  : ["tsx", srcEntry, ...process.argv.slice(2)];

const child = spawn(command, args, {
  stdio: "inherit",
  shell: !useDist && process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 1));
