import {
  escapeCodeSpan,
  escapeMarkdownText,
  singleLine,
} from "../format/markdown.js";
import type { OrchestratorConfig, SentryIssueContext } from "../types.js";
import { fingerprintBasis, issueFingerprint } from "./fingerprint.js";

export type DedupeDecision =
  | { action: "proceed"; fingerprint: string; basis: string }
  | {
      action: "skip";
      fingerprint: string;
      basis: string;
      reason: string;
      existingUrl?: string;
    };

export type SlotDecision =
  | { action: "proceed"; lockUrl?: string }
  | { action: "skip"; reason: string; existingUrl?: string };

export type GhRunner = (
  args: string[],
  token: string,
  options?: { allowFailure?: boolean },
) => Promise<string>;

interface GhPull {
  url: string;
  title: string;
  body: string;
  headRefName: string;
  labels: Array<{ name: string }>;
}

interface GhIssue {
  number: number;
  url: string;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
}

const LOCK_LABEL = "sentry-auto-fix-lock";
const LIST_LIMIT = "100";

/**
 * Fast pre-check: skip when the same fingerprint already has an open PR or an
 * active lock. Authoritative claiming happens in `acquireDedupeSlot`.
 */
export async function checkDedupe(
  issue: SentryIssueContext,
  config: OrchestratorConfig,
  options: { force?: boolean } = {},
): Promise<DedupeDecision> {
  const fingerprint = issueFingerprint(issue);
  const basis = fingerprintBasis(issue);

  if (options.force || config.dedupeForce) {
    return { action: "proceed", fingerprint, basis };
  }

  if (!config.githubToken) {
    console.warn(
      "[dedupe] GITHUB_TOKEN / GH_TOKEN unset — skipping GitHub uniqueness check (fingerprint still used for branch).",
    );
    return { action: "proceed", fingerprint, basis };
  }

  const repo = `${config.githubOwner}/${config.githubRepo}`;
  const marker = dedupeMarker(fingerprint);

  const openPr = await findOpenPr(repo, config.githubToken, fingerprint, marker);
  if (openPr) {
    return {
      action: "skip",
      fingerprint,
      basis,
      reason: `open PR already covers this fingerprint: ${openPr.url}`,
      existingUrl: openPr.url,
    };
  }

  const locks = await listOpenLocks(repo, config.githubToken, fingerprint, marker);
  if (locks.length > 0) {
    return {
      action: "skip",
      fingerprint,
      basis,
      reason: `another auto-fix run is in progress for this fingerprint: ${locks[0].url}`,
      existingUrl: locks[0].url,
    };
  }

  return { action: "proceed", fingerprint, basis };
}

export function dedupeMarker(fingerprint: string): string {
  return `sentry-dedupe:${fingerprint}`;
}

/**
 * Claim the fingerprint by creating a lock issue, then re-scanning to resolve
 * races (GitHub has no compare-and-swap on issue creation). If another lock with
 * a lower issue number — or an open PR — exists, we lost the race: close our
 * lock and skip. This makes duplicate concurrent runs converge on one winner.
 */
export async function acquireDedupeSlot(
  issue: SentryIssueContext,
  fingerprint: string,
  config: OrchestratorConfig,
  options: { force?: boolean; ghRunner?: GhRunner } = {},
): Promise<SlotDecision> {
  if (!config.githubToken) return { action: "proceed" };

  const runner = options.ghRunner ?? gh;
  const repo = `${config.githubOwner}/${config.githubRepo}`;
  const marker = dedupeMarker(fingerprint);
  const own = await createLock(
    repo,
    config.githubToken,
    issue,
    fingerprint,
    marker,
    runner,
  );

  if (!own) {
    if (config.requireDedupeLock) {
      return { action: "skip", reason: "could not create fingerprint lock issue" };
    }
    return { action: "proceed" };
  }

  if (options.force || config.dedupeForce) {
    return { action: "proceed", lockUrl: own.url };
  }

  try {
    const competitor = await findCompetingLock(
      repo,
      config.githubToken,
      fingerprint,
      marker,
      own.number,
      runner,
      false,
    );
    if (competitor) {
      await closeLock(
        repo,
        config.githubToken,
        own.number,
        `Superseded by earlier lock ${competitor.url}.`,
        runner,
      );
      return {
        action: "skip",
        reason: `another auto-fix run holds the lock for this fingerprint: ${competitor.url}`,
        existingUrl: competitor.url,
      };
    }

    const racedPr = await findOpenPr(
      repo,
      config.githubToken,
      fingerprint,
      marker,
      runner,
      false,
    );
    if (racedPr) {
      await closeLock(
        repo,
        config.githubToken,
        own.number,
        `Superseded by open PR ${racedPr.url}.`,
        runner,
      );
      return {
        action: "skip",
        reason: `open PR already covers this fingerprint: ${racedPr.url}`,
        existingUrl: racedPr.url,
      };
    }
  } catch (err) {
    await closeLock(
      repo,
      config.githubToken,
      own.number,
      "Lock released because the post-create dedupe scan failed.",
      runner,
    );
    return {
      action: "skip",
      reason: `could not verify fingerprint uniqueness after lock creation: ${
        err instanceof Error ? err.message : err
      }`,
    };
  }

  return { action: "proceed", lockUrl: own.url };
}

export async function releaseDedupeLock(
  lockUrl: string | undefined,
  config: OrchestratorConfig,
  comment: string,
): Promise<void> {
  if (!lockUrl || !config.githubToken) return;

  const number = lockUrl.match(/\/issues\/(\d+)/)?.[1];
  if (!number) return;

  const repo = `${config.githubOwner}/${config.githubRepo}`;
  await closeLock(repo, config.githubToken, Number(number), comment);
}

async function createLock(
  repo: string,
  token: string,
  issue: SentryIssueContext,
  fingerprint: string,
  marker: string,
  runner: GhRunner = gh,
): Promise<{ url: string; number: number } | undefined> {
  const title = `[sentry-auto-fix lock] ${fingerprint}`;
  const body = [
    `Active Sentry auto-fix lock.`,
    ``,
    `- Marker: \`${escapeCodeSpan(marker)}\``,
    `- Sentry: ${issue.issueUrl}`,
    `- Issue ID: \`${escapeCodeSpan(singleLine(issue.issueId, 80))}\``,
    `- Title: ${escapeMarkdownText(singleLine(issue.title, 200))}`,
    `- Basis: ${escapeMarkdownText(singleLine(fingerprintBasis(issue), 400))}`,
    ``,
    `_Other events/issues with the same fingerprint are skipped until this lock closes._`,
  ].join("\n");

  // Labeled create only — unlabeled locks are invisible to listOpenLocks
  // (which filters by LOCK_LABEL), so a fallback would break race detection.
  const created = await ghJson<{ url: string; number: number }>(
    [
      "issue",
      "create",
      "--repo",
      repo,
      "--title",
      title,
      "--body",
      body,
      "--label",
      LOCK_LABEL,
      "--json",
      "url,number",
    ],
    token,
    { allowFailure: true },
    runner,
  );

  if (created?.url && typeof created.number === "number") {
    return { url: created.url, number: created.number };
  }
  console.warn(
    `[dedupe] labeled lock create failed (ensure label '${LOCK_LABEL}' exists on the repo)`,
  );
  return undefined;
}

async function closeLock(
  repo: string,
  token: string,
  number: number,
  comment: string,
  runner: GhRunner = gh,
): Promise<void> {
  try {
    await runner(
      ["issue", "comment", String(number), "--repo", repo, "--body", comment],
      token,
    );
    await runner(
      ["issue", "close", String(number), "--repo", repo, "--reason", "completed"],
      token,
    );
  } catch (err) {
    console.warn(
      `[dedupe] could not close lock #${number}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

async function findOpenPr(
  repo: string,
  token: string,
  fingerprint: string,
  marker: string,
  runner: GhRunner = gh,
  allowFailure = true,
): Promise<GhPull | undefined> {
  const prs = await ghJson<GhPull[]>(
    [
      "pr",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--limit",
      LIST_LIMIT,
      "--json",
      "url,title,body,headRefName,labels",
    ],
    token,
    { allowFailure },
    runner,
  );

  if (!Array.isArray(prs)) return undefined;

  return prs.find((pr) => {
    const bodyHit = (pr.body || "").includes(marker);
    const branchHit = pr.headRefName?.includes(`fix/sentry-${fingerprint}`);
    return bodyHit || branchHit;
  });
}

async function listOpenLocks(
  repo: string,
  token: string,
  fingerprint: string,
  marker: string,
  runner: GhRunner = gh,
  allowFailure = true,
): Promise<GhIssue[]> {
  const issues = await ghJson<GhIssue[]>(
    [
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--limit",
      LIST_LIMIT,
      "--label",
      LOCK_LABEL,
      "--search",
      `sentry-auto-fix lock ${fingerprint} in:title`,
      "--json",
      "number,url,title,body,labels",
    ],
    token,
    { allowFailure },
    runner,
  );

  if (!Array.isArray(issues)) return [];

  return issues.filter(
    (issue) =>
      issue.title.includes(fingerprint) || (issue.body || "").includes(marker),
  );
}

async function findCompetingLock(
  repo: string,
  token: string,
  fingerprint: string,
  marker: string,
  ownNumber: number,
  runner: GhRunner = gh,
  allowFailure = true,
): Promise<GhIssue | undefined> {
  const locks = await listOpenLocks(
    repo,
    token,
    fingerprint,
    marker,
    runner,
    allowFailure,
  );
  // Deterministic winner: the lowest open issue number for this fingerprint.
  return locks
    .filter((l) => l.number < ownNumber)
    .sort((a, b) => a.number - b.number)[0];
}

async function gh(
  args: string[],
  token: string,
  options: { allowFailure?: boolean } = {},
): Promise<string> {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
  });
  if (result.status !== 0) {
    if (options.allowFailure) return result.stdout ?? "";
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "gh failed");
  }
  return result.stdout ?? "";
}

async function ghJson<T>(
  args: string[],
  token: string,
  options: { allowFailure?: boolean } = {},
  runner: GhRunner = gh,
): Promise<T | undefined> {
  try {
    const out = await runner(args, token, options);
    if (!out.trim()) return undefined;
    return JSON.parse(out) as T;
  } catch (err) {
    if (options.allowFailure) return undefined;
    throw err;
  }
}
