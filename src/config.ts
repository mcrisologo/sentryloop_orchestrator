import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OrchestratorConfig } from "./types.js";

/** Hard ceiling for fixer↔skeptic Block/Revise cycles (loop engineering gate). */
export const MAX_BLOCK_REVIEWS = 3;

const DEFAULT_PROJECT_CONTEXT = `
Project context is unset. Set PROJECT_CONTEXT or PROJECT_CONTEXT_PATH to describe
the target app (language, test command, lint command, architecture rules).
Keep controllers/handlers thin; put business logic in services. Minimal diff only.
`.trim();

/**
 * Env kill switch. Unset = **disabled** (safe public default).
 * Enable with: SENTRY_AUTO_FIX_ENABLED=1|true|on|yes
 */
export function isSentryAutoFixEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.SENTRY_AUTO_FIX_ENABLED?.trim().toLowerCase();
  if (raw == null || raw === "") return false;
  return ["1", "true", "on", "yes"].includes(raw);
}

export function loadProjectContext(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const inline = env.PROJECT_CONTEXT?.trim();
  if (inline) return inline;

  const path = env.PROJECT_CONTEXT_PATH?.trim();
  if (path) {
    const resolved = resolve(path);
    if (!existsSync(resolved)) {
      throw new Error(`PROJECT_CONTEXT_PATH not found: ${resolved}`);
    }
    return readFileSync(resolved, "utf8").trim();
  }

  return DEFAULT_PROJECT_CONTEXT;
}

export function loadConfig(): OrchestratorConfig {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "CURSOR_API_KEY is required. Export it, or put it in the package .env (or TARGET_APP_ROOT env files).",
    );
  }

  const githubOwner = process.env.GITHUB_OWNER?.trim();
  const githubRepo = process.env.GITHUB_REPO?.trim();
  if (!githubOwner || !githubRepo) {
    throw new Error(
      "GITHUB_OWNER and GITHUB_REPO are required (no hardcoded defaults).",
    );
  }

  const requested = Number(process.env.MAX_FIX_ITERATIONS ?? MAX_BLOCK_REVIEWS);
  const maxFixIterations = clampBlockReviews(requested);
  const githubToken =
    process.env.GH_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    undefined;

  const requireDedupeToken =
    process.env.REQUIRE_DEDUPE_TOKEN === "1" ||
    process.env.REQUIRE_DEDUPE_TOKEN === "true" ||
    process.env.CI === "true";

  if (requireDedupeToken && !githubToken) {
    throw new Error(
      "GITHUB_TOKEN / GH_TOKEN required when CI=true or REQUIRE_DEDUPE_TOKEN=1.",
    );
  }

  return {
    apiKey,
    githubOwner,
    githubRepo,
    defaultBranch: process.env.DEFAULT_BRANCH?.trim() || "main",
    model: process.env.CURSOR_MODEL?.trim() || "composer-2.5",
    maxFixIterations,
    githubToken,
    dedupeForce:
      process.env.DEDUPE_FORCE === "1" || process.env.DEDUPE_FORCE === "true",
    enabled: isSentryAutoFixEnabled(),
    projectContext: loadProjectContext(),
    requireDedupeLock: Boolean(githubToken),
  };
}

export function clampBlockReviews(n: number): number {
  if (!Number.isFinite(n) || n < 1) return MAX_BLOCK_REVIEWS;
  return Math.min(Math.floor(n), MAX_BLOCK_REVIEWS);
}
