#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { MAX_BLOCK_REVIEWS } from "./config.js";
import { loadLocalEnvFiles } from "./load-env.js";
import { readPayloadFromArgs } from "./sentry/parse-payload.js";
import { runOrchestrator } from "./orchestrator.js";
import { buildFailureReport } from "./pr/failure-report.js";
import { issueFingerprint } from "./dedupe/fingerprint.js";

loadLocalEnvFiles();

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage:
  sentry-fix-orchestrator --issue-url <url> [--title "..."] [--stacktrace "..."]
  sentry-fix-orchestrator --payload-file path/to/sentry.json
  cat sentry.json | sentry-fix-orchestrator

  --force                 Bypass fingerprint dedupe (re-run same bug)
  --fingerprint-only      Print fingerprint JSON and exit (no agents)

Environment:
  CURSOR_API_KEY          Required (unless --fingerprint-only)
  GITHUB_OWNER            Required (no default)
  GITHUB_REPO             Required (no default)
  DEFAULT_BRANCH          Default: main
  CURSOR_MODEL            Default: composer-2.5
  MAX_FIX_ITERATIONS      Default/hard max: ${MAX_BLOCK_REVIEWS} (block/review cycles)
  SENTRY_AUTO_FIX_ENABLED Required to run agents (default off). Set 1|true|on|yes
  PROJECT_CONTEXT         Optional inline project instructions for agents
  PROJECT_CONTEXT_PATH    Optional path to a project-context markdown file
  GH_TOKEN / GITHUB_TOKEN Enables open-PR + lock dedupe (required in CI)
  REQUIRE_DEDUPE_TOKEN=1  Fail if GitHub token missing (CI sets this via CI=true)
  DEDUPE_FORCE=1          Same as --force
  RESULT_PATH             Optional JSON result file path (summary-only by default)
`);
    process.exit(0);
  }

  if (args.includes("--force")) {
    process.env.DEDUPE_FORCE = "1";
  }

  const issue = await readPayloadFromArgs(args);

  if (args.includes("--fingerprint-only")) {
    const { fingerprintBasis } = await import("./dedupe/fingerprint.js");
    console.log(
      JSON.stringify(
        {
          fingerprint: issueFingerprint(issue),
          basis: fingerprintBasis(issue),
          issueId: issue.issueId,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const result = await runOrchestrator(issue);

  const summary = {
    issueId: result.issue.issueId,
    issueUrl: result.issue.issueUrl,
    title: result.issue.title,
    fingerprint: result.fingerprint ?? null,
    agreed: result.agreed,
    branch: result.branchName,
    prUrl: result.prUrl ?? null,
    iterations: result.iterations.length,
    maxBlockReviews: result.maxBlockReviews,
    stopReason: result.stopReason,
    dedupeSkipped: result.dedupeSkipped ?? false,
    dedupeReason: result.dedupeReason ?? null,
    existingUrl: result.existingUrl ?? null,
    finalVerdict: result.iterations.at(-1)?.skepticReport.verdict ?? "none",
    iterationSummaries: result.iterations.map((it) => ({
      iteration: it.iteration,
      verdict: it.skepticReport.verdict,
      testsPassed: it.testsPassed,
      regressionSpecPath: it.regressionSpecPath ?? null,
      blockingFindings: it.skepticReport.blockingFindings,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));

  const resultPath = process.env.RESULT_PATH?.trim();
  if (resultPath) {
    // Summary only by default — avoid persisting full agent transcripts (PII).
    const full = process.env.RESULT_FULL === "1" || process.env.RESULT_FULL === "true";
    const payload = full ? { summary, result } : { summary };
    await writeFile(resultPath, JSON.stringify(payload, null, 2));
    console.log(`[orchestrator] wrote result to ${resultPath}`);
  }

  if (result.stopReason === "disabled") {
    const note = [
      `## Sentry auto-fix disabled (kill switch)`,
      ``,
      `- Set \`SENTRY_AUTO_FIX_ENABLED=false\` (or \`0\` / \`off\` / \`no\`)`,
      `- No cloud agents were started`,
    ].join("\n");
    console.log(note);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await writeFile(process.env.GITHUB_STEP_SUMMARY, note, { flag: "a" });
    }
    process.exit(0);
  }

  if (
    result.stopReason === "deduped" ||
    result.stopReason === "dedupe_lock_failed"
  ) {
    const note = [
      `## Sentry auto-fix skipped (${result.stopReason})`,
      ``,
      `- Fingerprint: \`${result.fingerprint}\``,
      `- Reason: ${result.dedupeReason}`,
      result.existingUrl ? `- Existing: ${result.existingUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    console.log(note);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await writeFile(process.env.GITHUB_STEP_SUMMARY, note, { flag: "a" });
    }
    process.exit(0);
  }

  if (!result.agreed || !result.prUrl) {
    const report = buildFailureReport(result);
    console.error(report);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await writeFile(process.env.GITHUB_STEP_SUMMARY, report, { flag: "a" });
    }
  }

  if (!result.agreed) {
    process.exit(2);
  }
  if (!result.prUrl) {
    console.error("Agreement reached but PR URL was not returned.");
    process.exit(3);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
