import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");

/** Only these keys may be imported from env files (avoid sucking in DB secrets). */
const ALLOWED_KEYS = new Set([
  "CURSOR_API_KEY",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GITHUB_OWNER",
  "GITHUB_REPO",
  "DEFAULT_BRANCH",
  "CURSOR_MODEL",
  "MAX_FIX_ITERATIONS",
  "SENTRY_AUTO_FIX_ENABLED",
  "DEDUPE_FORCE",
  "RESULT_PATH",
  "PROJECT_CONTEXT",
  "PROJECT_CONTEXT_PATH",
  "REQUIRE_DEDUPE_TOKEN",
  "TARGET_APP_ROOT",
  "SENTRY_ALLOWED_HOSTS",
  "RESULT_FULL",
]);

/**
 * Load allowlisted env keys for local runs.
 * Does not override vars already set in the process environment.
 *
 * Search order:
 * 1. package `.env`
 * 2. `$TARGET_APP_ROOT` env files (if set)
 */
export function loadLocalEnvFiles(): string[] {
  const targetAppRoot = process.env.TARGET_APP_ROOT?.trim();
  const candidates = [
    resolve(packageRoot, ".env"),
    ...(targetAppRoot
      ? [
          resolve(targetAppRoot, ".env.development.local"),
          resolve(targetAppRoot, ".env.local"),
          resolve(targetAppRoot, ".env"),
        ]
      : []),
  ];

  const loaded: string[] = [];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    applyEnvFile(path);
    loaded.push(path);
  }
  return loaded;
}

function applyEnvFile(path: string): void {
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
    );
    if (!match) continue;

    const key = match[1];
    if (!ALLOWED_KEYS.has(key)) continue;
    if (process.env[key] != null && process.env[key] !== "") continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
