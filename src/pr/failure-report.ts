import {
  escapeCodeSpan,
  escapeMarkdownText,
  singleLine,
} from "../format/markdown.js";
import type { OrchestratorResult } from "../types.js";

export function buildFailureReport(result: OrchestratorResult): string {
  const title = escapeCodeSpan(singleLine(result.issue.title, 200));
  const lines = [
    `## Sentry auto-fix did not open a PR`,
    ``,
    `- **Issue:** \`${title}\``,
    `- **URL:** ${result.issue.issueUrl}`,
    `- **ID:** \`${escapeCodeSpan(result.issue.issueId)}\``,
    `- **Branch:** \`${result.branchName ?? "n/a"}\``,
    `- **Stop reason:** \`${result.stopReason}\``,
    `- **Block/review rounds used:** ${result.iterations.length} / ${result.maxBlockReviews}`,
    ``,
    `### Round history`,
    ``,
  ];

  if (result.iterations.length === 0) {
    lines.push("_No fix/skeptic rounds completed._");
  } else {
    for (const it of result.iterations) {
      lines.push(
        `- Round ${it.iteration}: verdict=**${it.skepticReport.verdict}**, tests=${it.testsPassed ? "pass" : "fail"}, spec=\`${escapeCodeSpan(singleLine(it.regressionSpecPath ?? "missing", 200))}\``,
      );
      for (const finding of it.skepticReport.blockingFindings.slice(0, 5)) {
        lines.push(`  - ${escapeMarkdownText(singleLine(finding, 300))}`);
      }
    }
  }

  if (result.investigation.rootCause) {
    lines.push(``, `### Investigation root cause (excerpt)`, ``);
    const excerpt = result.investigation.rootCause
      .replace(/```/g, "'''")
      .slice(0, 1200);
    lines.push("```text", excerpt, "```");
  }

  lines.push(
    ``,
    `_Max block/review cap is ${result.maxBlockReviews}. Human follow-up required._`,
  );

  return lines.join("\n");
}
